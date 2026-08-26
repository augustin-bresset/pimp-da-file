import { PDFDocument } from 'pdf-lib';
import { zipSync } from 'fflate';
import { el, icon, toast, fmtSize } from '../ui/dom';
import { dropSheet } from '../ui/dropsheet';
import { openPdf, renderThumb, download, baseName, type LoadedPdf } from '../lib/pdf';

interface SplitState {
  lp: LoadedPdf;
  cuts: Set<number>; // une découpe après la page i (1 ≤ i < pageCount)
  sel: Set<number>; // pages sélectionnées pour extraction
}

let sp: SplitState | null = null;
let root: HTMLElement;

export function initSplit(rootEl: HTMLElement): void {
  root = rootEl;
  render();
}

async function loadFile(files: File[]): Promise<void> {
  try {
    const lp = await openPdf(files[0]);
    sp = { lp, cuts: new Set(), sel: new Set() };
    render();
    void renderThumbs();
  } catch {
    toast(`Impossible de lire « ${files[0].name} ».`, 'err');
  }
}

function segments(): Array<[number, number]> {
  if (!sp) return [];
  const bounds = [...sp.cuts].sort((a, b) => a - b);
  const out: Array<[number, number]> = [];
  let start = 1;
  for (const b of bounds) {
    out.push([start, b]);
    start = b + 1;
  }
  out.push([start, sp.lp.pageCount]);
  return out;
}

function render(): void {
  root.replaceChildren();

  if (!sp) {
    root.append(
      dropSheet({
        multiple: false,
        title: 'Déposez un PDF',
        caption:
          'Placez des découpes entre les pages pour obtenir plusieurs documents, ou sélectionnez des pages à extraire.',
        onFiles: (files) => void loadFile(files),
      }),
    );
    return;
  }

  const { lp, cuts, sel } = sp;

  const strip = el('div', { class: 'strip', id: 'split-strip' });
  for (let p = 1; p <= lp.pageCount; p++) {
    strip.append(pageCell(p));
    if (p < lp.pageCount) strip.append(gutter(p));
  }

  const chips = el('div', { class: 'chips' });
  if (cuts.size > 0) {
    segments().forEach(([a, b], i) => {
      chips.append(el('span', { class: 'chip' }, `Partie ${i + 1} · p. ${a}${a === b ? '' : `–${b}`}`));
    });
  } else {
    chips.append(
      el(
        'span',
        { class: 'chip neutral' },
        'Cliquez entre deux pages pour placer une découpe ✂ — cliquez une page pour la sélectionner.',
      ),
    );
  }

  const parts = cuts.size + 1;
  const extractBtn = el(
    'button',
    { class: 'btn btn-secondary', disabled: sel.size === 0, onclick: () => void doExtract() },
    icon('download'),
    sel.size > 0 ? `Extraire la sélection (${sel.size})` : 'Extraire la sélection',
  );
  const partsBtn = el(
    'button',
    { class: 'btn btn-primary', disabled: cuts.size === 0, onclick: () => void doParts(partsBtn) },
    icon('scissors'),
    cuts.size > 0 ? `Télécharger les ${parts} parties (.zip)` : 'Télécharger les parties',
  );

  root.append(
    el(
      'div',
      { class: 'work' },
      el(
        'div',
        { class: 'work-head' },
        el('div', { class: 'work-title' }, 'Diviser'),
        el('div', { class: 'work-meta' }, `${lp.name} · ${lp.pageCount} pages · ${fmtSize(lp.size)}`),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn btn-ghost', onclick: () => { sp = null; render(); } }, 'Changer de fichier'),
      ),
      strip,
      chips,
      el(
        'div',
        { class: 'actionbar' },
        el(
          'button',
          {
            class: 'btn btn-ghost',
            onclick: () => {
              if (!sp) return;
              sp.cuts = new Set(Array.from({ length: lp.pageCount - 1 }, (_, i) => i + 1));
              render();
              void renderThumbs();
            },
          },
          'Découper chaque page',
        ),
        el(
          'button',
          {
            class: 'btn btn-ghost',
            onclick: () => {
              if (!sp) return;
              sp.cuts.clear();
              sp.sel.clear();
              render();
              void renderThumbs();
            },
          },
          'Réinitialiser',
        ),
        el('div', { class: 'spacer' }),
        extractBtn,
        partsBtn,
      ),
    ),
  );
}

function pageCell(p: number): HTMLElement {
  const selected = sp!.sel.has(p);
  return el(
    'div',
    {
      class: `pg ${selected ? 'sel' : ''}`,
      'data-page': String(p),
      role: 'checkbox',
      'aria-checked': String(selected),
      tabindex: '0',
      onclick: () => togglePage(p),
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePage(p); }
      },
    },
    el('div', { class: 'pg-frame' }, el('div', { class: 'pg-check' }, icon('check'))),
    el('div', { class: 'pg-num' }, String(p)),
  );
}

function gutter(after: number): HTMLElement {
  const isCut = sp!.cuts.has(after);
  return el(
    'div',
    {
      class: `gut ${isCut ? 'cut' : ''}`,
      title: isCut ? 'Retirer la découpe' : `Découper entre les pages ${after} et ${after + 1}`,
      onclick: () => {
        if (!sp) return;
        if (sp.cuts.has(after)) sp.cuts.delete(after);
        else sp.cuts.add(after);
        render();
        void renderThumbs();
      },
    },
    el('span', { class: 'sc' }, icon('scissors')),
  );
}

function togglePage(p: number): void {
  if (!sp) return;
  if (sp.sel.has(p)) sp.sel.delete(p);
  else sp.sel.add(p);
  render();
  void renderThumbs();
}

const thumbCache = new Map<number, HTMLCanvasElement>();
let thumbDoc: unknown = null;

async function renderThumbs(): Promise<void> {
  if (!sp) return;
  if (thumbDoc !== sp.lp.doc) {
    thumbCache.clear();
    thumbDoc = sp.lp.doc;
  }
  const strip = document.getElementById('split-strip');
  if (!strip) return;
  for (let p = 1; p <= sp.lp.pageCount; p++) {
    if (!sp || sp.lp.doc !== thumbDoc) return; // fichier changé entre-temps
    let c = thumbCache.get(p);
    if (!c) {
      try {
        c = await renderThumb(sp.lp.doc, p, 110);
        thumbCache.set(p, c);
      } catch {
        continue;
      }
    }
    const frame = strip.querySelector(`.pg[data-page="${p}"] .pg-frame`);
    if (frame && !frame.querySelector('canvas')) frame.prepend(c);
  }
}

async function extractPages(indices: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(sp!.lp.bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

function rangeLabel(pages: number[]): string {
  const parts: string[] = [];
  let a = pages[0];
  let b = pages[0];
  for (const p of pages.slice(1)) {
    if (p === b + 1) { b = p; continue; }
    parts.push(a === b ? `${a}` : `${a}-${b}`);
    a = b = p;
  }
  parts.push(a === b ? `${a}` : `${a}-${b}`);
  const label = parts.join(',');
  return label.length > 18 ? `${pages.length}p` : label;
}

async function doExtract(): Promise<void> {
  if (!sp || sp.sel.size === 0) return;
  const pages = [...sp.sel].sort((a, b) => a - b);
  try {
    const bytes = await extractPages(pages.map((p) => p - 1));
    download(bytes, `${baseName(sp.lp.name)}-p${rangeLabel(pages)}.pdf`);
    toast(`${pages.length} page${pages.length > 1 ? 's' : ''} extraite${pages.length > 1 ? 's' : ''}.`);
  } catch {
    toast("L'extraction a échoué.", 'err');
  }
}

async function doParts(btn: HTMLButtonElement): Promise<void> {
  if (!sp || sp.cuts.size === 0) return;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Découpe en cours…';
  try {
    const segs = segments();
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < segs.length; i++) {
      const [a, b] = segs[i];
      const indices = Array.from({ length: b - a + 1 }, (_, k) => a - 1 + k);
      files[`partie-${String(i + 1).padStart(2, '0')}_p${a}-${b}.pdf`] = await extractPages(indices);
    }
    const zip = zipSync(files, { level: 0 });
    download(zip, `${baseName(sp.lp.name)}-parties.zip`);
    toast(`${segs.length} parties téléchargées (.zip).`);
  } catch {
    toast('La découpe a échoué.', 'err');
  } finally {
    btn.disabled = sp.cuts.size === 0;
    btn.textContent = label;
  }
}
