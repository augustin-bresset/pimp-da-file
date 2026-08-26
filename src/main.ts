import './styles.css';
import { initMerge } from './tools/merge';
import { initSplit } from './tools/split';
import { initEdit } from './tools/edit';

const views: Record<string, HTMLElement> = {
  merge: document.getElementById('view-merge')!,
  split: document.getElementById('view-split')!,
  edit: document.getElementById('view-edit')!,
};

for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab')) {
  tab.addEventListener('click', () => {
    const tool = tab.dataset.tool!;
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('is-active', t === tab);
      t.setAttribute('aria-selected', String(t === tab));
    });
    Object.entries(views).forEach(([k, v]) => v.classList.toggle('is-active', k === tool));
  });
}

// un PDF lâché hors zone ne doit pas remplacer la page
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

initMerge(views.merge);
initSplit(views.split);
initEdit(views.edit);
