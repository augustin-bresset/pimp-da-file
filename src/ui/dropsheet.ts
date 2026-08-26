import { el, icon } from './dom';
import { isPdfFile } from '../lib/pdf';
import { toast } from './dom';

export interface DropSheetOptions {
  multiple: boolean;
  title: string;
  caption: string;
  onFiles: (files: File[]) => void;
}

export function dropSheet(opts: DropSheetOptions): HTMLElement {
  const input = el('input', {
    type: 'file',
    accept: 'application/pdf,.pdf',
    class: 'hidden-input',
    multiple: opts.multiple,
    onchange: () => {
      const files = [...(input.files ?? [])];
      input.value = '';
      handle(files);
    },
  });

  const sheet = el(
    'div',
    {
      class: 'sheet',
      role: 'button',
      tabindex: '0',
      'aria-label': opts.title,
      onclick: () => input.click(),
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
      },
    },
    el('div', { class: 'sheet-icon' }, icon('drop')),
    el('div', { class: 'sheet-title' }, opts.title),
    el('div', { class: 'sheet-sub' }, 'glissez-déposez, ou'),
    el('span', { class: 'sheet-browse' }, 'Parcourir…'),
  );

  const root = el(
    'div',
    { class: 'empty' },
    sheet,
    input,
    el('div', { class: 'empty-caption' }, opts.caption),
  );

  function handle(files: File[]) {
    const pdfs = files.filter(isPdfFile);
    if (pdfs.length === 0) {
      toast('Déposez un fichier PDF (.pdf).', 'err');
      return;
    }
    opts.onFiles(opts.multiple ? pdfs : pdfs.slice(0, 1));
  }

  for (const target of [root]) {
    target.addEventListener('dragover', (e) => {
      e.preventDefault();
      sheet.classList.add('dragover');
    });
    target.addEventListener('dragleave', (e) => {
      if (!root.contains(e.relatedTarget as Node)) sheet.classList.remove('dragover');
    });
    target.addEventListener('drop', (e) => {
      e.preventDefault();
      sheet.classList.remove('dragover');
      handle([...(e.dataTransfer?.files ?? [])]);
    });
  }

  return root;
}
