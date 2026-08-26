/* Édition réelle du texte d'un PDF : on décompresse le flux de contenu de la
   page, on repère les opérateurs d'affichage (Tj, TJ, ', "), on décode leurs
   chaînes avec l'encodage de la police, puis on réécrit les octets et on
   remplace le flux. Ne fonctionne qu'avec les polices « simples » à encodage
   inversible — sinon l'appelant bascule sur un remplacement visuel. */

import {
  PDFDocument,
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from 'pdf-lib';
import { WIN_ANSI, glyphToChar } from './encodings';

export interface TextEditRequest {
  pageIndex: number; // 0-based
  oldText: string; // texte de l'élément pdf.js (non normalisé)
  occurrence: number; // n-ième occurrence exacte sur la page (0-based)
  newText: string;
}

export type EditResult =
  | { outcome: 'edited'; bytes: Uint8Array }
  | { outcome: 'unsupported'; reason: string };

interface FontCodec {
  table: (string | undefined)[]; // code → caractère
  encode: Map<string, number>; // caractère → code sûr (glyphe présent)
}

interface StrSpan { start: number; end: number; hex: boolean; }
interface ShowOp {
  font: string | null;
  strs: StrSpan[];
  arraySpan: { start: number; end: number } | null; // pour TJ
  decoded: string | null; // null = police non décodable
}

const norm = (s: string) => s.replace(/ /g, ' ');

export async function applyTextEdit(bytes: ArrayBuffer, req: TextEditRequest): Promise<EditResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    return { outcome: 'unsupported', reason: 'document illisible' };
  }
  const page = doc.getPage(req.pageIndex);

  // 1. flux de contenu fusionné
  const contents = page.node.Contents();
  if (!contents) return { outcome: 'unsupported', reason: 'page sans contenu' };
  const parts: Uint8Array[] = [];
  const items = contents instanceof PDFArray ? contents.asArray() : [contents];
  for (const item of items) {
    const s = item instanceof PDFRef ? doc.context.lookup(item) : item;
    if (!(s instanceof PDFRawStream)) return { outcome: 'unsupported', reason: 'flux de contenu non standard' };
    try {
      parts.push(decodePDFRawStream(s).decode());
    } catch {
      return { outcome: 'unsupported', reason: 'flux de contenu non décodable' };
    }
  }
  const merged = joinStreams(parts);

  // 2. polices de la page
  const codecs = buildCodecs(page.node.Resources(), doc);

  // 3. repérage des opérateurs de texte
  let ops: ShowOp[];
  try {
    ops = tokenize(merged, codecs);
  } catch (e) {
    return { outcome: 'unsupported', reason: e instanceof Error ? e.message : 'flux non analysable' };
  }

  // 4. correspondance avec le texte cliqué
  const target = norm(req.oldText);
  const matches = findMatches(ops, target);
  const match = matches[req.occurrence];
  if (!match) {
    return { outcome: 'unsupported', reason: 'texte introuvable dans le flux de la page' };
  }

  // 5. ré-encodage du nouveau texte avec la police du premier opérateur
  const first = ops[match.from];
  const codec = first.font ? codecs.get(first.font) : undefined;
  if (!codec) return { outcome: 'unsupported', reason: 'police non identifiable' };
  const full = match.prefix + norm(req.newText) + match.suffix;
  const encoded: number[] = [];
  for (const ch of full) {
    const code = codec.encode.get(ch) ?? (ch === ' ' ? codec.encode.get(' ') : undefined);
    if (code === undefined) {
      return { outcome: 'unsupported', reason: `caractère « ${ch} » absent de la police` };
    }
    encoded.push(code);
  }

  // 6. réécriture des octets
  const lit = literalString(encoded);
  const repl: Array<{ start: number; end: number; text: string }> = [];
  for (let k = match.from; k <= match.to; k++) {
    const op = ops[k];
    if (k === match.from) {
      if (op.arraySpan) repl.push({ ...op.arraySpan, text: `[${lit}]` });
      else repl.push({ ...op.strs[0], text: lit });
    } else if (op.arraySpan) {
      repl.push({ ...op.arraySpan, text: '[]' });
    } else {
      for (const s of op.strs) repl.push({ ...s, text: '()' });
    }
  }
  repl.sort((a, b) => b.start - a.start);
  let out = merged;
  const enc = new TextEncoder();
  for (const r of repl) {
    const ins = enc.encode(r.text);
    const next = new Uint8Array(out.length - (r.end - r.start) + ins.length);
    next.set(out.subarray(0, r.start), 0);
    next.set(ins, r.start);
    next.set(out.subarray(r.end), r.start + ins.length);
    out = next;
  }

  // 7. remplacement du flux de la page
  const stream = doc.context.flateStream(out);
  const ref = doc.context.register(stream);
  page.node.set(PDFName.of('Contents'), ref);
  return { outcome: 'edited', bytes: await doc.save() };
}

/* ── correspondance ─────────────────────────────────────────────────── */

interface Match { from: number; to: number; prefix: string; suffix: string; }

function findMatches(ops: ShowOp[], target: string): Match[] {
  const out: Match[] = [];
  if (!target) return out;
  for (let i = 0; i < ops.length; i++) {
    const di = ops[i].decoded;
    if (di == null) continue;
    // cas 1 : contenu dans un seul opérateur
    let idx = di.indexOf(target);
    while (idx !== -1) {
      out.push({ from: i, to: i, prefix: di.slice(0, idx), suffix: di.slice(idx + target.length) });
      idx = di.indexOf(target, idx + Math.max(1, target.length));
    }
    // cas 2 : concaténation exacte d'opérateurs consécutifs i..j
    if (di !== '' && target.startsWith(di) && di.length < target.length) {
      let acc = di;
      for (let j = i + 1; j < ops.length; j++) {
        const dj = ops[j].decoded;
        if (dj == null) break;
        acc += dj;
        if (acc === target) {
          out.push({ from: i, to: j, prefix: '', suffix: '' });
          break;
        }
        if (!target.startsWith(acc)) break;
      }
    }
  }
  return out;
}

/* ── polices ────────────────────────────────────────────────────────── */

function buildCodecs(resources: PDFDict | undefined, doc: PDFDocument): Map<string, FontCodec> {
  const out = new Map<string, FontCodec>();
  const fontDict = resources?.lookup(PDFName.of('Font'));
  if (!(fontDict instanceof PDFDict)) return out;

  for (const [key, value] of fontDict.entries()) {
    const fd = value instanceof PDFRef ? doc.context.lookup(value) : value;
    if (!(fd instanceof PDFDict)) continue;
    const name = key.toString().slice(1); // retire le « / »

    const subtype = fd.lookup(PDFName.of('Subtype'));
    if (subtype === PDFName.of('Type0') || subtype === PDFName.of('Type3')) continue;

    // encodage de base
    const encoding = fd.lookup(PDFName.of('Encoding'));
    let table: (string | undefined)[] | null = null;
    let diffs: PDFArray | null = null;

    if (encoding === undefined) {
      // pas d'encodage déclaré : WinAnsi si la police n'est pas symbolique
      table = isSymbolic(fd, doc) ? null : WIN_ANSI.slice();
    } else if (encoding === PDFName.of('WinAnsiEncoding')) {
      table = WIN_ANSI.slice();
    } else if (encoding instanceof PDFDict) {
      const base = encoding.lookup(PDFName.of('BaseEncoding'));
      if (base === undefined || base === PDFName.of('WinAnsiEncoding')) table = WIN_ANSI.slice();
      const d = encoding.lookup(PDFName.of('Differences'));
      if (d instanceof PDFArray) diffs = d;
    }
    if (!table) continue; // MacRoman, symbolique… : non pris en charge

    if (diffs) {
      let code = 0;
      for (const obj of diffs.asArray()) {
        if (obj instanceof PDFNumber) code = obj.asNumber();
        else if (obj instanceof PDFName) {
          table[code] = glyphToChar(obj.toString().slice(1));
          code++;
        }
      }
    }

    // codes « sûrs » : restreints aux glyphes dont la chasse est déclarée
    const allowed = allowedCodes(fd, doc);
    const encode = new Map<string, number>();
    for (let c = 0; c < 256; c++) {
      const ch = table[c];
      if (ch === undefined) continue;
      if (allowed && !allowed.has(c)) continue;
      if (!encode.has(ch)) encode.set(ch, c);
    }
    out.set(name, { table, encode });
  }
  return out;
}

function isSymbolic(fd: PDFDict, doc: PDFDocument): boolean {
  const descRef = fd.lookup(PDFName.of('FontDescriptor'));
  const desc = descRef instanceof PDFRef ? doc.context.lookup(descRef) : descRef;
  if (!(desc instanceof PDFDict)) return false;
  const flags = desc.lookup(PDFName.of('Flags'));
  return flags instanceof PDFNumber && (flags.asNumber() & 4) !== 0;
}

function allowedCodes(fd: PDFDict, doc: PDFDocument): Set<number> | null {
  const first = fd.lookup(PDFName.of('FirstChar'));
  const widthsRef = fd.lookup(PDFName.of('Widths'));
  const widths = widthsRef instanceof PDFRef ? doc.context.lookup(widthsRef) : widthsRef;
  if (!(first instanceof PDFNumber) || !(widths instanceof PDFArray)) return null; // police standard : tout est permis
  const fc = first.asNumber();
  const set = new Set<number>();
  widths.asArray().forEach((w, i) => {
    const width = w instanceof PDFNumber ? w.asNumber() : 0;
    if (width > 0) set.add(fc + i);
  });
  set.add(32); // l'espace peut légitimement avoir une chasse nulle déclarée
  return set;
}

/* ── analyse lexicale du flux ───────────────────────────────────────── */

const isWS = (b: number) => b === 0 || b === 9 || b === 10 || b === 12 || b === 13 || b === 32;
const isDelim = (b: number) =>
  b === 0x28 || b === 0x29 || b === 0x3c || b === 0x3e || b === 0x5b || b === 0x5d ||
  b === 0x7b || b === 0x7d || b === 0x2f || b === 0x25;

function tokenize(buf: Uint8Array, codecs: Map<string, FontCodec>): ShowOp[] {
  const ops: ShowOp[] = [];
  let i = 0;
  let currentFont: string | null = null;
  let lastName: string | null = null;
  let lastStr: StrSpan | null = null;
  let arr: { start: number; strs: StrSpan[] } | null = null;
  let lastArr: { start: number; end: number; strs: StrSpan[] } | null = null;

  const pushShow = (spans: StrSpan[], arraySpan: { start: number; end: number } | null) => {
    const codec = currentFont ? codecs.get(currentFont) : undefined;
    let decoded: string | null = null;
    if (codec) {
      decoded = '';
      for (const s of spans) {
        for (const code of spanBytes(buf, s)) {
          const ch = codec.table[code];
          if (ch === undefined) { decoded = null; break; }
          decoded += ch;
        }
        if (decoded === null) break;
      }
      if (decoded !== null) decoded = norm(decoded);
    }
    ops.push({ font: currentFont, strs: spans, arraySpan, decoded });
  };

  while (i < buf.length) {
    const b = buf[i];
    if (isWS(b)) { i++; continue; }

    if (b === 0x25) { // % commentaire
      while (i < buf.length && buf[i] !== 10 && buf[i] !== 13) i++;
      continue;
    }

    if (b === 0x28) { // ( chaîne littérale
      const start = i;
      let depth = 1;
      i++;
      while (i < buf.length && depth > 0) {
        const c = buf[i];
        if (c === 0x5c) i += 2; // échappement
        else { if (c === 0x28) depth++; else if (c === 0x29) depth--; i++; }
      }
      lastStr = { start, end: i, hex: false };
      if (arr) arr.strs.push(lastStr);
      continue;
    }

    if (b === 0x3c && buf[i + 1] === 0x3c) { i += 2; continue; } // << : ponctuation
    if (b === 0x3e && buf[i + 1] === 0x3e) { i += 2; continue; } // >>

    if (b === 0x3c) { // < chaîne hexadécimale
      const start = i;
      i++;
      while (i < buf.length && buf[i] !== 0x3e) i++;
      i++;
      lastStr = { start, end: i, hex: true };
      if (arr) arr.strs.push(lastStr);
      continue;
    }

    if (b === 0x5b) { arr = { start: i, strs: [] }; i++; continue; } // [
    if (b === 0x5d) { // ]
      i++;
      if (arr) { lastArr = { start: arr.start, end: i, strs: arr.strs }; arr = null; }
      continue;
    }
    if (b === 0x7b || b === 0x7d) { i++; continue; } // { }

    if (b === 0x2f) { // / nom
      const start = ++i;
      while (i < buf.length && !isWS(buf[i]) && !isDelim(buf[i])) i++;
      lastName = new TextDecoder('latin1').decode(buf.subarray(start, i));
      continue;
    }

    if (b === 0x27 || b === 0x22) { // opérateurs ' et "
      i++;
      if (lastStr) pushShow([lastStr], null);
      lastStr = null;
      continue;
    }

    // jeton régulier : nombre ou opérateur
    const start = i;
    while (i < buf.length && !isWS(buf[i]) && !isDelim(buf[i])) i++;
    const tok = new TextDecoder('latin1').decode(buf.subarray(start, i));
    if (/^[A-Za-z*01]+$/.test(tok)) {
      if (tok === 'BI') throw new Error('image en ligne dans le flux');
      if (tok === 'Tf') currentFont = lastName;
      else if (tok === 'Tj') { if (lastStr) pushShow([lastStr], null); }
      else if (tok === 'TJ') { if (lastArr) pushShow(lastArr.strs, { start: lastArr.start, end: lastArr.end }); }
      lastStr = null;
      lastArr = null;
    }
  }
  return ops;
}

/* octets d'une chaîne (littérale déséchappée ou hex) */
function spanBytes(buf: Uint8Array, s: StrSpan): number[] {
  const out: number[] = [];
  if (s.hex) {
    let hi = -1;
    for (let i = s.start + 1; i < s.end - 1; i++) {
      const c = buf[i];
      const v = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
      if (v < 0) continue;
      if (hi < 0) hi = v;
      else { out.push(hi * 16 + v); hi = -1; }
    }
    if (hi >= 0) out.push(hi * 16);
    return out;
  }
  for (let i = s.start + 1; i < s.end - 1; i++) {
    const c = buf[i];
    if (c !== 0x5c) { out.push(c === 13 ? 10 : c); continue; }
    const n = buf[++i];
    if (n === undefined) break;
    if (n === 0x6e) out.push(10);
    else if (n === 0x72) out.push(13);
    else if (n === 0x74) out.push(9);
    else if (n === 0x62) out.push(8);
    else if (n === 0x66) out.push(12);
    else if (n === 10) { /* continuation de ligne */ }
    else if (n === 13) { if (buf[i + 1] === 10) i++; }
    else if (n >= 48 && n <= 55) {
      let oct = n - 48;
      for (let k = 0; k < 2 && buf[i + 1] >= 48 && buf[i + 1] <= 55; k++) oct = oct * 8 + (buf[++i] - 48);
      out.push(oct & 0xff);
    } else out.push(n);
  }
  return out;
}

function literalString(codes: number[]): string {
  let s = '(';
  for (const c of codes) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) s += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) s += '\\' + c.toString(8).padStart(3, '0');
    else s += String.fromCharCode(c);
  }
  return s + ')';
}

function joinStreams(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length + 1, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
    out[o++] = 10;
  }
  return out;
}
