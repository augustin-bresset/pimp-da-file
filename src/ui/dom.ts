type Child = Node | string | null | undefined;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      n.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'html') {
      n.innerHTML = String(v);
    } else if (v === true) {
      n.setAttribute(k, '');
    } else {
      n.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c == null) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

const S = (body: string, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  drop: S('<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/>', 22),
  plus: S('<path d="M12 5v14M5 12h14"/>', 15),
  trash: S('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', 15),
  up: S('<path d="M6 14l6-6 6 6"/>', 14),
  down: S('<path d="M6 10l6 6 6-6"/>', 14),
  left: S('<path d="M14 6l-6 6 6 6"/>', 15),
  right: S('<path d="M10 6l6 6-6 6"/>', 15),
  grip: S('<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>', 15),
  scissors: S('<circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><path d="M20 4L8.1 15.9M14.8 14.8L20 20M8.1 8.1L12 12"/>', 13),
  check: S('<path d="M5 12l5 5 9-10"/>', 11),
  text: S('<path d="M5 7V5h14v2M12 5v14M9 19h6"/>', 15),
  image: S('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 15l-5-4-9 8"/>', 15),
  mask: S('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 18L15 6" stroke-dasharray="2.5 2.5"/>', 15),
  download: S('<path d="M12 4v10"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/>', 15),
  close: S('<path d="M6 6l12 12M18 6L6 18"/>', 14),
  move: S('<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>', 12),
};

export function icon(name: keyof typeof icons): HTMLElement {
  return el('span', { style: 'display:inline-flex;line-height:0', html: icons[name] });
}

export function toast(msg: string, kind: 'ok' | 'err' = 'ok'): void {
  const host = document.getElementById('toasts')!;
  const t = el('div', { class: `toast ${kind === 'err' ? 'err' : ''}` }, msg);
  host.append(t);
  setTimeout(() => t.remove(), 4200);
}

export function fmtSize(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} Ko`;
  return `${(n / 1048576).toFixed(1).replace('.', ',')} Mo`;
}
