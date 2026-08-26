import { PDFDocument } from 'pdf-lib';
import { el, icon, toast, fmtSize } from '../ui/dom';
import { dropSheet } from '../ui/dropsheet';
import { openPdf, renderThumb, download, type LoadedPdf } from '../lib/pdf';

interface MergeItem {
  id: number;
  lp: LoadedPdf;
  thumb: HTMLCanvasElement | null;
}

let items: MergeItem[] = [];
let nextId = 1;
let root: HTMLElement;
let addInput: HTMLInputElement;

export function initMerge(rootEl: HTMLElement): void {
  root = rootEl;
  addInput = el('input', {
    type: 'file',
    accept: 'application/pdf,.pdf',
    multiple: true,
    class: 'hidden-input',
    onchange: () => {
      const files = [...(addInput.files ?? [])];
      addInput.value = '';
      void addFiles(files);
    },
  });
  render();
}

async function addFiles(files: File[]): Promise<void> {
  for (const f of files) {
    try {
      const lp = await openPdf(f);
      const item: MergeItem = { id: nextId++, lp, thumb: null };
      items.push(item);
      item.thumb = await renderThumb(lp.doc, 1, 84);
    } catch {
      toast(`Impossible de lire « ${f.name} ».`, 'err');
    }
  }
  render();
}

function render(): void {
  root.replaceChildren();

  if (items.length === 0) {
    root.append(
      dropSheet({
        multiple: true,
        title: 'Déposez vos PDF',
        caption:
          'Ajoutez deux fichiers ou plus, ordonnez-les, puis fusionnez-les en un seul document.',
        onFiles: (files) => void addFiles(files),
      }),
    );
    return;
  }

  const totalPages = items.reduce((n, it) => n + it.lp.pageCount, 0);
  const list = el('div', { class: 'm-list' });

  items.forEach((it, i) => list.append(card(it, i)));

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = list.querySelector('.m-card.dragging');
    if (!dragging) return;
    const after = afterElement(list, e.clientY);
    if (after == null) list.append(dragging);
    else list.insertBefore(dragging, after);
  });

  const mergeBtn = el(
    'button',
    { class: 'btn btn-primary', disabled: items.length < 2, onclick: () => void doMerge(mergeBtn) },
    icon('download'),
    `Fusionner ${items.length} fichier${items.length > 1 ? 's' : ''}`,
  );

  root.append(
    el(
      'div',
      { class: 'work' },
      el(
        'div',
        { class: 'work-head' },
        el('div', { class: 'work-title' }, 'Fusionner'),
        el('div', { class: 'work-meta' }, `${items.length} fichiers · ${totalPages} pages au total`),
      ),
      list,
      addInput,
      el(
        'div',
        { class: 'actionbar' },
        el('button', { class: 'btn btn-secondary', onclick: () => addInput.click() }, icon('plus'), 'Ajouter des fichiers'),
        el('div', { class: 'spacer' }),
        mergeBtn,
      ),
    ),
  );
}

function card(it: MergeItem, index: number): HTMLElement {
  const c = el(
    'div',
    { class: 'm-card', draggable: 'true', 'data-id': String(it.id) },
    el('span', { class: 'grip', title: 'Glisser pour réordonner' }, icon('grip')),
    el('span', { class: 'm-index' }, String(index + 1).padStart(2, '0')),
    thumbEl(it),
    el(
      'div',
      { class: 'm-info' },
      el('div', { class: 'm-name', title: it.lp.name }, it.lp.name),
      el('div', { class: 'm-meta' }, `${it.lp.pageCount} page${it.lp.pageCount > 1 ? 's' : ''} · ${fmtSize(it.lp.size)}`),
    ),
    el(
      'div',
      { class: 'm-controls' },
      el('button', { class: 'btn-icon', title: 'Monter', disabled: index === 0, onclick: () => move(it.id, -1) }, icon('up')),
      el('button', { class: 'btn-icon', title: 'Descendre', disabled: index === items.length - 1, onclick: () => move(it.id, 1) }, icon('down')),
      el('button', { class: 'btn-icon danger', title: 'Retirer', onclick: () => remove(it.id) }, icon('close')),
    ),
  );

  c.addEventListener('dragstart', () => c.classList.add('dragging'));
  c.addEventListener('dragend', () => {
    c.classList.remove('dragging');
    const order = [...root.querySelectorAll<HTMLElement>('.m-card')].map((n) => Number(n.dataset.id));
    items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    render();
  });
  return c;
}

function thumbEl(it: MergeItem): HTMLElement {
  const wrap = el('span', { class: 'm-thumb', style: 'display:inline-flex;align-items:center;justify-content:center' });
  if (it.thumb) {
    it.thumb.style.maxWidth = '100%';
    it.thumb.style.maxHeight = '100%';
    wrap.append(it.thumb);
  }
  return wrap;
}

function afterElement(list: HTMLElement, y: number): Element | null {
  let closest: { offset: number; element: Element | null } = { offset: -Infinity, element: null };
  for (const child of list.querySelectorAll('.m-card:not(.dragging)')) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, element: child };
  }
  return closest.element;
}

function move(id: number, delta: number): void {
  const i = items.findIndex((x) => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  render();
}

function remove(id: number): void {
  items = items.filter((x) => x.id !== id);
  render();
}

async function doMerge(btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Fusion en cours…';
  try {
    const out = await PDFDocument.create();
    let skipped = 0;
    for (const it of items) {
      try {
        const src = await PDFDocument.load(it.lp.bytes, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      } catch {
        skipped++;
        toast(`« ${it.lp.name} » n'a pas pu être inclus.`, 'err');
      }
    }
    if (out.getPageCount() === 0) throw new Error('vide');
    download(await out.save(), 'fusion.pdf');
    toast(skipped ? `Fusion téléchargée (${skipped} fichier ignoré).` : 'Fusion téléchargée.');
  } catch {
    toast('La fusion a échoué.', 'err');
  } finally {
    btn.disabled = items.length < 2;
    btn.textContent = label;
  }
}
