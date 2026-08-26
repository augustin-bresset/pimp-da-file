import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFOptionList,
  type PDFFont,
} from 'pdf-lib';
import type { PageViewport } from 'pdfjs-dist';
import { el, icon, toast, fmtSize } from '../ui/dom';
import { dropSheet } from '../ui/dropsheet';
import { openPdf, pdfFromBytes, renderPage, download, baseName, type LoadedPdf } from '../lib/pdf';
import { applyTextEdit } from '../lib/contentedit';

/* Les positions sont stockées en unités « viewport à l'échelle 1 » :
   1 unité = 1 point PDF (pour une page non pivotée). L'affichage multiplie
   par l'échelle courante ; l'export convertit via convertToPdfPoint. */

type ColorKey = 'noir' | 'outremer' | 'rouge' | 'blanc';
const COLORS: Record<ColorKey, { css: string; r: number; g: number; b: number }> = {
  noir: { css: '#17181A', r: 0.09, g: 0.094, b: 0.102 },
  outremer: { css: '#2740D6', r: 0.153, g: 0.251, b: 0.839 },
  rouge: { css: '#C0392B', r: 0.753, g: 0.224, b: 0.169 },
  blanc: { css: '#FFFFFF', r: 1, g: 1, b: 1 },
};

interface OvBase { id: number; page: number; vx: number; vy: number; }
interface OvText extends OvBase { kind: 'text'; text: string; size: number; color: ColorKey; }
interface OvImage extends OvBase { kind: 'image'; vw: number; vh: number; bytes: ArrayBuffer; isPng: boolean; url: string; ratio: number; }
interface OvRect extends OvBase { kind: 'rect'; vw: number; vh: number; }
type Ov = OvText | OvImage | OvRect;

interface FieldInfo {
  name: string;
  kind: 'text' | 'check' | 'choice';
  multiline?: boolean;
  options?: string[];
  value: string | boolean;
}

interface TLItem { str: string; transform: number[]; width: number; }
interface RunBox { x: number; y: number; w: number; h: number; fontH: number; }

type Arm = 'text' | 'image' | 'rect' | 'retouch' | null;

interface EditState {
  lp: LoadedPdf;
  working: ArrayBuffer; // état courant du PDF (retouches réelles incluses)
  history: ArrayBuffer[]; // états précédents, pour Annuler
  current: number;
  scale: number;
  zoom: number | 'fit';
  vpT: number[] | null; // matrice viewport de la page affichée
  ovs: Ov[];
  selected: number | null;
  arm: Arm;
  pendingImage: { bytes: ArrayBuffer; isPng: boolean; url: string; ratio: number } | null;
  fields: FieldInfo[];
  values: Map<string, string | boolean>;
  flatten: boolean;
}

let st: EditState | null = null;
let nextId = 1;
let root: HTMLElement;
let layer: HTMLElement | null = null;
let tlItems: TLItem[] = [];
let resizeTimer: number | undefined;

export function initEdit(rootEl: HTMLElement): void {
  root = rootEl;
  render();

  window.addEventListener('resize', () => {
    if (!st || !root.closest('.view')?.classList.contains('is-active')) return;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => void renderCurrentPage(), 200);
  });

  document.addEventListener('keydown', (e) => {
    if (!st || !root.closest('.view')?.classList.contains('is-active')) return;
    const a = document.activeElement as HTMLElement | null;
    const editing =
      a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement || !!a?.isContentEditable;
    if (e.key === 'Escape') {
      disarm();
      select(null);
      a?.blur?.();
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !editing && st.selected != null) {
      e.preventDefault();
      removeOv(st.selected);
    }
  });
}

async function loadFile(files: File[]): Promise<void> {
  try {
    const lp = await openPdf(files[0]);
    const fields = await probeFields(lp.bytes);
    st = {
      lp,
      working: lp.bytes,
      history: [],
      current: 1,
      scale: 1,
      zoom: 'fit',
      vpT: null,
      ovs: [],
      selected: null,
      arm: null,
      pendingImage: null,
      fields,
      values: new Map(fields.map((f) => [f.name, f.value])),
      flatten: false,
    };
    nextId = 1;
    render();
    await renderCurrentPage();
    if (fields.length > 0) toast(`${fields.length} champ${fields.length > 1 ? 's' : ''} de formulaire détecté${fields.length > 1 ? 's' : ''}.`);
  } catch {
    toast(`Impossible de lire « ${files[0].name} ».`, 'err');
  }
}

async function probeFields(bytes: ArrayBuffer): Promise<FieldInfo[]> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const form = doc.getForm();
    const out: FieldInfo[] = [];
    for (const f of form.getFields()) {
      try {
        const name = f.getName();
        if (f instanceof PDFTextField) {
          out.push({ name, kind: 'text', multiline: f.isMultiline(), value: f.getText() ?? '' });
        } else if (f instanceof PDFCheckBox) {
          out.push({ name, kind: 'check', value: f.isChecked() });
        } else if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
          out.push({ name, kind: 'choice', options: f.getOptions(), value: f.getSelected()[0] ?? '' });
        } else if (f instanceof PDFRadioGroup) {
          out.push({ name, kind: 'choice', options: f.getOptions(), value: f.getSelected() ?? '' });
        }
      } catch {
        /* champ illisible : ignoré */
      }
    }
    return out;
  } catch {
    return [];
  }
}

/* ── Construction de la vue ─────────────────────────────────────────── */

function render(): void {
  root.replaceChildren();
  layer = null;

  if (!st) {
    root.append(
      dropSheet({
        multiple: false,
        title: 'Déposez un PDF',
        caption:
          'Retouchez le texte existant, ajoutez du texte ou une image, masquez une zone, remplissez les champs de formulaire — puis téléchargez le résultat.',
        onFiles: (files) => void loadFile(files),
      }),
    );
    return;
  }

  const { lp } = st;

  const imgInput = el('input', {
    type: 'file',
    accept: 'image/png,image/jpeg',
    class: 'hidden-input',
    onchange: () => {
      const f = imgInput.files?.[0];
      imgInput.value = '';
      if (f) void pickImage(f);
    },
  });

  const pageInput = el('input', {
    type: 'number',
    min: '1',
    max: String(lp.pageCount),
    value: String(st.current),
    'aria-label': 'Page courante',
    onchange: () => {
      const p = Math.min(lp.pageCount, Math.max(1, Number(pageInput.value) || 1));
      goTo(p);
    },
  });

  const toolbar = el(
    'div',
    { class: 'toolbar' },
    el('button', { class: 'tool-btn', id: 'arm-retouch', title: 'Modifier le texte existant du PDF', onclick: () => arm('retouch') }, icon('ibeam'), 'Retoucher'),
    el('button', { class: 'tool-btn', id: 'arm-text', onclick: () => arm('text') }, icon('text'), 'Texte'),
    el('button', { class: 'tool-btn', onclick: () => imgInput.click() }, icon('image'), 'Image'),
    el('button', { class: 'tool-btn', id: 'arm-rect', onclick: () => arm('rect') }, icon('mask'), 'Masquer'),
    el('button', { class: 'tool-btn', id: 'undo-btn', style: 'display:none', title: 'Annuler la dernière retouche', onclick: () => void undoRetouch() }, icon('undo'), 'Annuler'),
    imgInput,
    el('div', { class: 'sep' }),
    ctxControls(),
    el('div', { class: 'spacer' }),
    el(
      'span',
      { class: 'pager' },
      el('button', { class: 'btn-icon', title: 'Zoom arrière', onclick: () => zoomBy(1 / 1.2) }, icon('zoomout')),
      el('span', { class: 'zoom-label', id: 'zoom-label' }, '—'),
      el('button', { class: 'btn-icon', title: 'Zoom avant', onclick: () => zoomBy(1.2) }, icon('zoomin')),
      el('button', { class: 'btn-icon', title: 'Ajuster à la fenêtre', onclick: () => { if (st) { st.zoom = 'fit'; void renderCurrentPage(); } } }, icon('fit')),
    ),
    el('div', { class: 'sep' }),
    el(
      'span',
      { class: 'pager' },
      el('button', { class: 'btn-icon', title: 'Page précédente', onclick: () => goTo(st!.current - 1) }, icon('left')),
      pageInput,
      el('span', {}, `/ ${lp.pageCount}`),
      el('button', { class: 'btn-icon', title: 'Page suivante', onclick: () => goTo(st!.current + 1) }, icon('right')),
    ),
  );

  const pageWrap = el('div', { class: 'page-wrap', id: 'page-wrap' });
  const canvasScroll = el('div', { class: 'canvas-scroll', id: 'canvas-scroll' }, pageWrap);

  const flatten = el('input', {
    type: 'checkbox',
    id: 'flatten',
    onchange: () => { if (st) st.flatten = flatten.checked; },
  });
  if (st.flatten) flatten.checked = true;

  const exportBtn = el(
    'button',
    { class: 'btn btn-primary', onclick: () => void doExport(exportBtn) },
    icon('download'),
    'Télécharger le PDF',
  );

  const main = el('div', { class: 'edit-main' }, toolbar, canvasScroll);
  const cols = el('div', { class: 'edit-cols' }, main);
  if (st.fields.length > 0) cols.append(formPanel());

  root.append(
    el(
      'div',
      { class: 'work' },
      el(
        'div',
        { class: 'work-head' },
        el('div', { class: 'work-title' }, 'Éditer'),
        el('div', { class: 'work-meta' }, `${lp.name} · ${lp.pageCount} pages · ${fmtSize(lp.size)}`),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn btn-ghost', onclick: () => { st = null; render(); } }, 'Changer de fichier'),
      ),
      cols,
      el(
        'div',
        { class: 'actionbar' },
        st.fields.length > 0
          ? el('label', { class: 'flatten-opt', for: 'flatten' }, flatten, 'Aplatir le formulaire (champs non modifiables ensuite)')
          : el('span', { class: 'work-meta' }, 'Retouches et ajouts sont fusionnés dans le PDF téléchargé.'),
        el('div', { class: 'spacer' }),
        exportBtn,
      ),
    ),
  );
  syncUndo();
}

function ctxControls(): HTMLElement {
  const sizeInput = el('input', {
    type: 'number',
    min: '6',
    max: '96',
    id: 'ctx-size',
    'aria-label': 'Taille du texte',
    onchange: () => {
      const ov = selectedOv();
      if (ov?.kind === 'text') {
        ov.size = Math.min(96, Math.max(6, Number(sizeInput.value) || 14));
        renderOverlays();
      }
    },
  });

  const swatches = (Object.keys(COLORS) as ColorKey[]).map((c) =>
    el('button', {
      class: 'swatch',
      'data-c': c,
      title: c,
      style: `background:${COLORS[c].css}`,
      onclick: () => {
        const ov = selectedOv();
        if (ov?.kind === 'text') {
          ov.color = c;
          renderOverlays();
          syncCtx();
        }
      },
    }),
  );

  return el(
    'span',
    { class: 'ctx', id: 'ctx' },
    sizeInput,
    ...swatches,
    el(
      'button',
      { class: 'btn-icon danger', title: 'Supprimer l’élément', onclick: () => { if (st?.selected != null) removeOv(st.selected); } },
      icon('trash'),
    ),
  );
}

function formPanel(): HTMLElement {
  const fieldsEl = el('div', { class: 'form-fields' });
  for (const fi of st!.fields) {
    if (fi.kind === 'text') {
      const input = fi.multiline
        ? el('textarea', { oninput: () => st!.values.set(fi.name, (input as HTMLTextAreaElement).value) })
        : el('input', { type: 'text', oninput: () => st!.values.set(fi.name, (input as HTMLInputElement).value) });
      (input as HTMLInputElement | HTMLTextAreaElement).value = String(st!.values.get(fi.name) ?? '');
      fieldsEl.append(el('div', { class: 'ff' }, el('label', {}, fi.name), input));
    } else if (fi.kind === 'check') {
      const cb = el('input', {
        type: 'checkbox',
        onchange: () => st!.values.set(fi.name, cb.checked),
      });
      cb.checked = Boolean(st!.values.get(fi.name));
      fieldsEl.append(el('div', { class: 'ff' }, el('label', { class: 'ff-check' }, cb, fi.name)));
    } else {
      const sel = el(
        'select',
        { onchange: () => st!.values.set(fi.name, sel.value) },
        el('option', { value: '' }, '—'),
        ...(fi.options ?? []).map((o) => el('option', { value: o }, o)),
      );
      sel.value = String(st!.values.get(fi.name) ?? '');
      fieldsEl.append(el('div', { class: 'ff' }, el('label', {}, fi.name), sel));
    }
  }
  return el(
    'aside',
    { class: 'form-panel' },
    el('h3', {}, 'Champs du formulaire', el('small', {}, String(st!.fields.length))),
    fieldsEl,
  );
}

/* ── Rendu de la page courante ──────────────────────────────────────── */

async function renderCurrentPage(): Promise<void> {
  if (!st) return;
  const wrap = document.getElementById('page-wrap');
  const scroll = document.getElementById('canvas-scroll');
  if (!wrap || !scroll) return;

  const page = await st.lp.doc.getPage(st.current);
  const vp1 = page.getViewport({ scale: 1 });
  if (st.zoom === 'fit') {
    const avail = Math.max(280, scroll.clientWidth - 24);
    st.scale = Math.min(1.75, avail / vp1.width);
  } else {
    st.scale = st.zoom;
  }

  const { canvas, viewport } = await renderPage(st.lp.doc, st.current, st.scale);
  st.vpT = viewport.transform as number[];

  layer = el('div', { class: 'ov-layer' });
  layer.addEventListener('pointerdown', (e) => {
    if (!st) return;
    if (st.arm && st.arm !== 'retouch') {
      e.preventDefault();
      placeAt(e);
      return;
    }
    if (e.target === layer) select(null);
  });

  wrap.replaceChildren(canvas, layer);
  const zl = document.getElementById('zoom-label');
  if (zl) zl.textContent = `${Math.round(st.scale * 100)} %`;
  renderOverlays();
  syncArmUi();
  if (st.arm === 'retouch') await buildTextLayer();
}

function zoomBy(f: number): void {
  if (!st) return;
  st.zoom = Math.min(3, Math.max(0.35, st.scale * f));
  void renderCurrentPage();
}

function goTo(p: number): void {
  if (!st) return;
  const clamped = Math.min(st.lp.pageCount, Math.max(1, p));
  if (clamped === st.current) return;
  st.current = clamped;
  select(null);
  render();
  void renderCurrentPage();
}

async function reloadWorking(): Promise<void> {
  if (!st) return;
  const old = st.lp.doc;
  const lp2 = await pdfFromBytes(st.working, st.lp.name);
  st.lp = lp2;
  void old.destroy();
  await renderCurrentPage();
}

/* ── Retoucher : édition du texte existant ──────────────────────────── */

function mul(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

async function buildTextLayer(): Promise<void> {
  if (!st || !layer || !st.vpT) return;
  const page = await st.lp.doc.getPage(st.current);
  const tc = await page.getTextContent({ disableNormalization: true });
  tlItems = (tc.items as Array<{ str?: string; transform?: number[]; width?: number }>)
    .filter((x): x is TLItem => typeof x.str === 'string' && Array.isArray(x.transform)) ;

  layer.querySelectorAll('.tl-run, .tl-input').forEach((n) => n.remove());
  tlItems.forEach((item, idx) => {
    if (!item.str.trim()) return;
    const m = mul(st!.vpT!, item.transform);
    const fontH = Math.hypot(m[2], m[3]);
    if (fontH <= 1) return;
    const w = Math.max(item.width * st!.scale, 6);
    const box: RunBox = { x: m[4], y: m[5] - fontH * 0.83, w, h: fontH * 1.05, fontH };
    const run = el('div', {
      class: 'tl-run',
      title: 'Cliquez pour modifier ce texte',
      style: `left:${box.x}px; top:${box.y}px; width:${box.w}px; height:${box.h}px`,
    });
    run.addEventListener('pointerdown', (e) => e.stopPropagation());
    run.addEventListener('click', (e) => {
      e.stopPropagation();
      openRunEditor(item, idx, box);
    });
    layer!.append(run);
  });
}

function openRunEditor(item: TLItem, idx: number, box: RunBox): void {
  if (!layer) return;
  layer.querySelectorAll('.tl-input').forEach((n) => n.remove());
  const inp = el('input', {
    type: 'text',
    class: 'tl-input',
    style: `left:${box.x - 4}px; top:${box.y - 5}px; width:${Math.max(box.w + 40, 160)}px; font-size:${Math.max(11, box.fontH * 0.92)}px`,
  });
  inp.value = item.str;
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const v = inp.value;
    inp.remove();
    if (v !== item.str) void commitRetouch(item, idx, v, box);
  };
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') { done = true; inp.remove(); }
  });
  inp.addEventListener('blur', commit);
  inp.addEventListener('pointerdown', (e) => e.stopPropagation());
  layer.append(inp);
  inp.focus();
  inp.select();
}

async function commitRetouch(item: TLItem, idx: number, value: string, box: RunBox): Promise<void> {
  if (!st) return;
  const occurrence = tlItems.slice(0, idx).filter((x) => x.str === item.str).length;
  const res = await applyTextEdit(st.working, {
    pageIndex: st.current - 1,
    oldText: item.str,
    occurrence,
    newText: value,
  });

  if (res.outcome === 'edited') {
    st.history.push(st.working);
    if (st.history.length > 6) st.history.shift();
    st.working = res.bytes.buffer.slice(res.bytes.byteOffset, res.bytes.byteOffset + res.bytes.byteLength) as ArrayBuffer;
    await reloadWorking();
    syncUndo();
    toast('Texte modifié directement dans le PDF.');
  } else {
    // repli : masque blanc + texte par-dessus, à la même position
    const s = st.scale;
    const pad = 1.5;
    st.ovs.push({
      id: nextId++, kind: 'rect', page: st.current,
      vx: box.x / s - pad, vy: box.y / s - pad,
      vw: box.w / s + 2 * pad, vh: box.h / s + 2 * pad,
    });
    st.ovs.push({
      id: nextId++, kind: 'text', page: st.current,
      vx: box.x / s, vy: box.y / s - (box.fontH / s) * 0.12,
      text: value, size: Math.max(6, Math.round(box.fontH / s)), color: 'noir',
    });
    renderOverlays();
    toast(`Édition directe impossible (${res.reason}) — remplacement visuel appliqué.`, 'err');
  }
}

async function undoRetouch(): Promise<void> {
  if (!st) return;
  const prev = st.history.pop();
  if (!prev) return;
  st.working = prev;
  await reloadWorking();
  syncUndo();
  toast('Retouche annulée.');
}

function syncUndo(): void {
  const b = document.getElementById('undo-btn');
  if (b) b.style.display = st && st.history.length > 0 ? '' : 'none';
}

/* ── Calques : création ─────────────────────────────────────────────── */

function arm(kind: 'text' | 'rect' | 'retouch'): void {
  if (!st) return;
  const on = st.arm !== kind;
  st.arm = on ? kind : null;
  st.pendingImage = null;
  syncArmUi();
  if (!on) {
    if (kind === 'retouch') layer?.querySelectorAll('.tl-run, .tl-input').forEach((n) => n.remove());
    return;
  }
  if (kind === 'retouch') {
    void buildTextLayer();
    toast('Cliquez un texte du document pour le modifier.');
  } else {
    layer?.querySelectorAll('.tl-run, .tl-input').forEach((n) => n.remove());
    toast(kind === 'text' ? 'Cliquez sur la page pour placer le texte.' : 'Cliquez sur la page pour placer le masque blanc.');
  }
}

function disarm(): void {
  if (!st) return;
  st.arm = null;
  st.pendingImage = null;
  layer?.querySelectorAll('.tl-run, .tl-input').forEach((n) => n.remove());
  syncArmUi();
}

function syncArmUi(): void {
  document.getElementById('arm-text')?.classList.toggle('armed', st?.arm === 'text');
  document.getElementById('arm-rect')?.classList.toggle('armed', st?.arm === 'rect');
  document.getElementById('arm-retouch')?.classList.toggle('armed', st?.arm === 'retouch');
  layer?.classList.toggle('placing', !!st?.arm && st?.arm !== 'retouch');
  layer?.classList.toggle('retouch', st?.arm === 'retouch');
}

async function pickImage(f: File): Promise<void> {
  if (!st) return;
  const bytes = await f.arrayBuffer();
  const head = new Uint8Array(bytes.slice(0, 4));
  const isPng = head[0] === 0x89 && head[1] === 0x50;
  if (!isPng && !(head[0] === 0xff && head[1] === 0xd8)) {
    toast('Formats acceptés : PNG ou JPEG.', 'err');
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes]));
  const ratio = await new Promise<number>((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im.naturalWidth / Math.max(1, im.naturalHeight));
    im.onerror = () => resolve(1);
    im.src = url;
  });
  st.pendingImage = { bytes, isPng, url, ratio };
  st.arm = 'image';
  syncArmUi();
  toast("Cliquez sur la page pour placer l'image.");
}

function placeAt(e: PointerEvent): void {
  if (!st || !layer) return;
  const rect = layer.getBoundingClientRect();
  const vx = (e.clientX - rect.left) / st.scale;
  const vy = (e.clientY - rect.top) / st.scale;
  const page = st.current;

  let ov: Ov;
  if (st.arm === 'text') {
    ov = { id: nextId++, kind: 'text', page, vx, vy, text: 'Votre texte', size: 14, color: 'noir' };
  } else if (st.arm === 'image' && st.pendingImage) {
    const vw = Math.max(40, layerWidthUnits() * 0.3);
    ov = { id: nextId++, kind: 'image', page, vx, vy, vw, vh: vw / st.pendingImage.ratio, ...st.pendingImage };
  } else if (st.arm === 'rect') {
    ov = { id: nextId++, kind: 'rect', page, vx, vy, vw: 160, vh: 36 };
  } else {
    disarm();
    return;
  }

  st.ovs.push(ov);
  disarm();
  select(ov.id);
  renderOverlays();

  if (ov.kind === 'text') {
    const node = layer.querySelector<HTMLElement>(`[data-ov="${ov.id}"] .ov-text`);
    if (node) {
      node.focus();
      const range = document.createRange();
      range.selectNodeContents(node);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }
  }
}

function layerWidthUnits(): number {
  return layer && st ? layer.clientWidth / st.scale : 400;
}

/* ── Calques : rendu & interactions ─────────────────────────────────── */

function selectedOv(): Ov | undefined {
  return st?.ovs.find((o) => o.id === st?.selected);
}

function select(id: number | null): void {
  if (!st) return;
  st.selected = id;
  layer?.querySelectorAll('.ov').forEach((n) => {
    n.classList.toggle('sel', (n as HTMLElement).dataset.ov === String(id));
  });
  syncCtx();
}

function syncCtx(): void {
  const ctx = document.getElementById('ctx');
  if (!ctx) return;
  const ov = selectedOv();
  ctx.classList.toggle('on', !!ov);
  const sizeInput = document.getElementById('ctx-size') as HTMLInputElement | null;
  if (sizeInput) {
    sizeInput.style.display = ov?.kind === 'text' ? '' : 'none';
    if (ov?.kind === 'text') sizeInput.value = String(ov.size);
  }
  ctx.querySelectorAll<HTMLElement>('.swatch').forEach((s) => {
    s.style.display = ov?.kind === 'text' ? '' : 'none';
    s.classList.toggle('on', ov?.kind === 'text' && s.dataset.c === ov.color);
  });
}

function removeOv(id: number): void {
  if (!st) return;
  const ov = st.ovs.find((o) => o.id === id);
  if (ov?.kind === 'image') URL.revokeObjectURL(ov.url);
  st.ovs = st.ovs.filter((o) => o.id !== id);
  select(null);
  renderOverlays();
}

function renderOverlays(): void {
  if (!st || !layer) return;
  layer.querySelectorAll('.ov').forEach((n) => n.remove());
  for (const ov of st.ovs.filter((o) => o.page === st!.current)) {
    layer.append(ovNode(ov));
  }
  syncCtx();
}

function applyGeom(node: HTMLElement, ov: Ov): void {
  const s = st!.scale;
  node.style.left = `${ov.vx * s}px`;
  node.style.top = `${ov.vy * s}px`;
  if (ov.kind === 'image' || ov.kind === 'rect') {
    node.style.width = `${ov.vw * s}px`;
    node.style.height = `${ov.vh * s}px`;
  }
  if (ov.kind === 'text') {
    const inner = node.querySelector<HTMLElement>('.ov-text');
    if (inner) {
      inner.style.fontSize = `${ov.size * s}px`;
      inner.style.color = COLORS[ov.color].css;
    }
  }
}

function ovNode(ov: Ov): HTMLElement {
  const grip = el('span', { class: 'ov-grip', title: 'Déplacer' }, icon('move'));
  grip.addEventListener('pointerdown', (e) => startDrag(e, ov, 'move'));

  let node: HTMLElement;

  if (ov.kind === 'text') {
    const inner = el('div', {
      class: 'ov-text',
      contenteditable: 'plaintext-only',
      spellcheck: 'false',
    });
    inner.textContent = ov.text;
    inner.addEventListener('focus', () => select(ov.id));
    inner.addEventListener('input', () => { ov.text = inner.innerText.replace(/\n$/, ''); });
    inner.addEventListener('pointerdown', (e) => e.stopPropagation());
    node = el('div', { class: 'ov', 'data-ov': String(ov.id) }, inner, grip);
  } else if (ov.kind === 'image') {
    const im = el('img', { src: ov.url, alt: '', draggable: 'false' });
    node = el('div', { class: 'ov ov-img', 'data-ov': String(ov.id) }, im, grip, resizeHandle(ov));
    node.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.ov-handle, .ov-grip')) return;
      select(ov.id);
      startDrag(e, ov, 'move');
    });
  } else {
    node = el('div', { class: 'ov ov-rect', 'data-ov': String(ov.id) }, grip, resizeHandle(ov));
    node.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.ov-handle, .ov-grip')) return;
      select(ov.id);
      startDrag(e, ov, 'move');
    });
  }

  node.classList.toggle('sel', st!.selected === ov.id);
  applyGeom(node, ov);
  return node;
}

function resizeHandle(ov: OvImage | OvRect): HTMLElement {
  const h = el('span', { class: 'ov-handle', title: 'Redimensionner' });
  h.addEventListener('pointerdown', (e) => startDrag(e, ov, 'resize'));
  return h;
}

function startDrag(e: PointerEvent, ov: Ov, mode: 'move' | 'resize'): void {
  if (!st || !layer) return;
  e.preventDefault();
  e.stopPropagation();
  select(ov.id);

  const s = st.scale;
  const startX = e.clientX;
  const startY = e.clientY;
  const ox = ov.vx;
  const oy = ov.vy;
  const ow = ov.kind !== 'text' ? ov.vw : 0;
  const oh = ov.kind !== 'text' ? ov.vh : 0;
  const maxX = layer.clientWidth / s;
  const maxY = layer.clientHeight / s;
  const node = layer.querySelector<HTMLElement>(`[data-ov="${ov.id}"]`);

  const onMove = (ev: PointerEvent) => {
    const dx = (ev.clientX - startX) / s;
    const dy = (ev.clientY - startY) / s;
    if (mode === 'move') {
      ov.vx = Math.min(maxX - 8, Math.max(-4, ox + dx));
      ov.vy = Math.min(maxY - 8, Math.max(-4, oy + dy));
    } else if (ov.kind === 'image') {
      ov.vw = Math.max(16, ow + dx);
      ov.vh = ov.vw / ov.ratio;
    } else if (ov.kind === 'rect') {
      ov.vw = Math.max(10, ow + dx);
      ov.vh = Math.max(8, oh + dy);
    }
    if (node) applyGeom(node, ov);
  };
  const onUp = () => window.removeEventListener('pointermove', onMove);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
}

/* ── Export ─────────────────────────────────────────────────────────── */

function sanitize(text: string, charset: Set<number>): string {
  return [...text].map((ch) => (charset.has(ch.codePointAt(0)!) ? ch : '·')).join('');
}

async function doExport(btn: HTMLButtonElement): Promise<void> {
  if (!st) return;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Génération…';
  try {
    const lib = await PDFDocument.load(st.working, { ignoreEncryption: true });
    const font: PDFFont = await lib.embedFont(StandardFonts.Helvetica);
    const charset = new Set(font.getCharacterSet());

    // conversion coordonnées : viewport (échelle 1) → espace PDF
    const vpCache = new Map<number, PageViewport>();
    const toPdf = async (pageNo: number, x: number, y: number): Promise<[number, number]> => {
      let vp = vpCache.get(pageNo);
      if (!vp) {
        const page = await st!.lp.doc.getPage(pageNo);
        vp = page.getViewport({ scale: 1 });
        vpCache.set(pageNo, vp);
      }
      const [px, py] = vp.convertToPdfPoint(x, y);
      return [px, py];
    };

    // d'abord les masques, puis images, puis textes (ordre d'empilement)
    const ordered = [...st.ovs].sort((a, b) => {
      const rank = (o: Ov) => (o.kind === 'rect' ? 0 : o.kind === 'image' ? 1 : 2);
      return rank(a) - rank(b) || a.id - b.id;
    });

    for (const ov of ordered) {
      const page = lib.getPage(ov.page - 1);
      if (ov.kind === 'rect') {
        const [x1, y1] = await toPdf(ov.page, ov.vx, ov.vy);
        const [x2, y2] = await toPdf(ov.page, ov.vx + ov.vw, ov.vy + ov.vh);
        page.drawRectangle({
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
          color: rgb(1, 1, 1),
        });
      } else if (ov.kind === 'image') {
        const img = ov.isPng ? await lib.embedPng(ov.bytes) : await lib.embedJpg(ov.bytes);
        const [x1, y1] = await toPdf(ov.page, ov.vx, ov.vy);
        const [x2, y2] = await toPdf(ov.page, ov.vx + ov.vw, ov.vy + ov.vh);
        page.drawImage(img, {
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
        });
      } else {
        const c = COLORS[ov.color];
        const lines = ov.text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          // ligne i : la base de référence CSS est ≈ 1,0 × taille depuis le haut
          const [x, y] = await toPdf(ov.page, ov.vx, ov.vy + ov.size + i * ov.size * 1.3);
          page.drawText(sanitize(lines[i], charset), {
            x,
            y,
            size: ov.size,
            font,
            color: rgb(c.r, c.g, c.b),
          });
        }
      }
    }

    if (st.fields.length > 0) {
      try {
        const form = lib.getForm();
        for (const fi of st.fields) {
          const v = st.values.get(fi.name);
          if (v === undefined || v === fi.value) continue;
          try {
            const f = form.getField(fi.name);
            if (f instanceof PDFTextField) f.setText(String(v));
            else if (f instanceof PDFCheckBox) (v ? f.check() : f.uncheck());
            else if (f instanceof PDFDropdown || f instanceof PDFOptionList) { if (v) f.select(String(v)); }
            else if (f instanceof PDFRadioGroup) { if (v) f.select(String(v)); }
          } catch {
            toast(`Le champ « ${fi.name} » n'a pas pu être rempli.`, 'err');
          }
        }
        try { form.updateFieldAppearances(font); } catch { /* apparence par défaut */ }
        if (st.flatten) {
          try { form.flatten(); } catch { toast("Impossible d'aplatir ce formulaire — champs conservés.", 'err'); }
        }
      } catch { /* pas de formulaire exploitable */ }
    }

    download(await lib.save(), `${baseName(st.lp.name)}-modifie.pdf`);
    toast('PDF téléchargé.');
  } catch {
    toast("L'export a échoué.", 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}
