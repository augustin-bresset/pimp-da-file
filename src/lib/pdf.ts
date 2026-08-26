import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface LoadedPdf {
  name: string;
  size: number;
  bytes: ArrayBuffer;
  doc: PDFDocumentProxy;
  pageCount: number;
}

export function isPdfFile(f: File): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
}

export async function openPdf(file: File): Promise<LoadedPdf> {
  const bytes = await file.arrayBuffer();
  return pdfFromBytes(bytes, file.name);
}

export async function pdfFromBytes(bytes: ArrayBuffer, name: string): Promise<LoadedPdf> {
  // pdf.js transfère le buffer vers son worker : on lui donne une copie,
  // l'original reste intact pour pdf-lib.
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  return { name, size: bytes.byteLength, bytes, doc, pageCount: doc.numPages };
}

export async function renderPage(
  doc: PDFDocumentProxy,
  pageNo: number,
  scale: number,
): Promise<{ canvas: HTMLCanvasElement; viewport: PageViewport }> {
  const page = await doc.getPage(pageNo);
  const viewport = page.getViewport({ scale });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const ctx = canvas.getContext('2d')!;
  await page.render({
    canvasContext: ctx,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  }).promise;
  return { canvas, viewport };
}

export async function renderThumb(
  doc: PDFDocumentProxy,
  pageNo: number,
  width: number,
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const { canvas } = await renderPage(doc, pageNo, width / base.width);
  return canvas;
}

export function download(bytes: Uint8Array | ArrayBuffer, name: string): void {
  const blob = new Blob([bytes as BlobPart], { type: name.endsWith('.zip') ? 'application/zip' : 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function baseName(name: string): string {
  return name.replace(/\.pdf$/i, '');
}
