import { matchesSection, sectionCategories } from '../../packages/composer-core/regions.mjs';
import { matchesFolders, withinFolder } from '../../packages/composer-core/folders.mjs';
import { folderReadiness } from './clip-readiness.js';
import { categoryGroups, folderTree } from './folder-model.js';
import { clipMetadataIndex } from '../../packages/composer-core/source-metadata.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key = folder => JSON.stringify([folder.source, folder.path]);

export function openFolderPicker(editor, id) {
  const v = editor.view, session = v.session, section = session?.sections.find(s => s.id === id);
  if (!section) throw new Error('Load a song and select a section.');
  v.selectSection(session.sections.indexOf(section));
  const catalog = {...v.catalog, clips:v.catalog.clips.filter(c => !c.retired)};
  const metadata=clipMetadataIndex(v.catalog.clips);
  const selected = new Set(sectionCategories(section));
  let folders = structuredClone(section.folders || []);
  const groups = categoryGroups(catalog.clips, [...selected]), tree = folderTree(catalog, folders);
  const dialog = editor.root.ownerDocument.createElement('dialog');
  dialog.className = 'fc-dialog fc-folder-dialog';
  dialog.setAttribute('aria-labelledby', 'fc-folder-title');
  dialog.innerHTML = `<form method="dialog">
    <header class="fc-folder-header"><h2 id="fc-folder-title">Clip pool for ${esc(section.label)}</h2>
      <p>Choose folders, then categories within them. A parent folder includes its subfolders.</p>
      <small>Session filters: ${v.minimumRating() ? v.minimumRating() + '★ or higher' : 'all ratings'} · drafts ${v.includeDrafts ? 'included' : 'excluded'}</small></header>
    <div class="fc-folder-browser">
      <section class="fc-folder-pane"><h3>Folders</h3><input name="folder-search" type="search" placeholder="Find a folder…" aria-label="Find a folder">
        <label class="fc-check fc-pool-all"><input name="all-folders" type="checkbox"> All folders</label>
        <div class="fc-folder-tree"></div></section>
      <section class="fc-category-pane"><h3>Categories</h3><input name="category-search" type="search" placeholder="Find a category…" aria-label="Find a category">
        <label class="fc-check fc-pool-all"><input name="any" type="checkbox"> All categories in these folders</label>
        <div class="fc-category-columns"><span>Category</span><span>Ready / videos</span></div>
        <div class="fc-folder-choices"></div></section>
    </div>
    <footer class="fc-folder-footer"><div class="fc-pool-summary" role="status" aria-live="polite"></div>
      <details class="fc-pool-reasons"><summary>Why some videos aren’t ready</summary><p></p></details>
      <details class="fc-folder-help"><summary>Local folders &amp; counts</summary><p>${catalog.roots?.length || 'No'} local folder${catalog.roots?.length === 1 ? '' : 's'} indexed. Nested indexed folders appear once in the tree.</p>
        <p>Local files and HF script variants of the same video count once. HF folders are the dataset’s published paths; local folders show your disk layout.</p>
        <button value="index">Index local folder…</button></details>
      <div class="fc-actions"><button type="button" name="clear">Clear choices</button><span class="fc-spacer"></span><button value="cancel">Cancel</button><button value="apply" class="fc-primary">Apply folders</button></div>
    </footer></form>`;
  const $ = selector => dialog.querySelector(selector);
  let openNodes = new Set();
  const nodes = new Map();
  function renderTree() {
    const query = $('[name=folder-search]').value.toLowerCase();
    const contains = node => node.path.toLowerCase().includes(query) || node.children.some(contains);
    const hasSelection = node => folders.some(f => f.source === node.source && withinFolder(f.path, node.path));
    function row(node, depth) {
      if (query && !contains(node)) return '';
      const id = key(node); nodes.set(id, node);
      const status = folderReadiness(catalog.clips.filter(c => matchesFolders(c, [node])), session, section, metadata);
      const label = `<label class="fc-check" style="--fc-depth:${depth}" title="${esc(node.path)}"><input name="folder" value="${esc(id)}" type="checkbox"><span>${esc(node.label)}</span><small>${status.total}</small></label>`;
      return node.children.length ? `<details data-folder-node="${esc(id)}" ${query || openNodes.has(id) || hasSelection(node) ? 'open' : ''}><summary>${label}</summary>${node.children.map(child => row(child, depth + 1)).join('')}</details>` : `<div class="fc-folder-leaf">${label}</div>`;
    }
    $('.fc-folder-tree').innerHTML = ['local','hf'].map(source => {
      const roots = tree.filter(n => n.source === source), body = roots.map(n => row(n, 0)).join('');
      return body ? `<div class="fc-folder-source"><h4>${source === 'local' ? 'Local folders' : 'HF folders'}</h4>${body}</div>` : '';
    }).join('') || '<p>No matching folders.</p>';
    for (const input of dialog.querySelectorAll('[name=folder]')) {
      const node = nodes.get(input.value);
      input.checked = folders.some(f => key(f) === input.value);
      input.indeterminate = !input.checked && hasSelection(node);
    }
    $('[name=all-folders]').checked = !folders.length;
  }
  // Open local roots initially; collections such as September remain collapsible.
  tree.filter(n => n.source === 'local').forEach(n => openNodes.add(key(n)));
  function renderCategories() {
    const scoped = catalog.clips.filter(c => matchesFolders(c, folders));
    const query = $('[name=category-search]').value.toLowerCase();
    const visible = groups.filter(g => g.label.toLowerCase().includes(query) &&
      (g.values.some(value => selected.has(value)) || scoped.some(c => c.categories?.some(value => g.values.includes(value)))));
    $('.fc-folder-choices').innerHTML = visible.map(group => {
      const matching = scoped.filter(c => c.categories?.some(value => group.values.includes(value)));
      const status = folderReadiness(matching, session, section, metadata), chosen = group.values.filter(value => selected.has(value));
      const detail = status.reasons.join(' · ');
      return `<label class="fc-check fc-category-choice ${chosen.length ? 'fc-pool-chosen' : ''}" title="${esc(detail || 'Ready for this section')}" data-category-label="${esc(group.label)}">
        <input name="category" value="${esc(group.label)}" type="checkbox"><span>${esc(group.label)}${chosen.length && chosen.length < group.values.length ? '<small>Some folders selected</small>' : ''}</span>
        <small class="fc-pool-count ${status.ready ? 'fc-ready' : ''}" aria-label="${status.ready} ready out of ${status.total} unique videos">${status.ready} / ${status.total}</small></label>`;
    }).join('') || '<p>No matching categories in these folders.</p>';
    for (const input of dialog.querySelectorAll('[name=category]')) {
      const values = groups.find(g => g.label === input.value).values, count = values.filter(value => selected.has(value)).length;
      input.checked = count === values.length; input.indeterminate = count > 0 && count < values.length;
    }
    $('[name=any]').checked = !selected.size;
    const choice = {...section, folders, categories:[...selected]};
    const status = folderReadiness(catalog.clips.filter(c => matchesSection(c, choice)), session, section, metadata);
    $('.fc-pool-summary').textContent = `${status.ready} ready / ${status.total} unique videos selected${status.variants > status.total ? ` · ${status.variants} catalog records grouped` : ''}`;
    $('.fc-pool-reasons').hidden = !status.reasons.length;
    $('.fc-pool-reasons p').textContent = status.reasons.join(' · ') + '. Ratings and draft settings are in Library → Filters; linked videos may need Get HF scripts.';
  }
  function rememberTree() { openNodes = new Set([...dialog.querySelectorAll('[data-folder-node][open]')].map(el => el.dataset.folderNode)); }
  dialog.addEventListener('keydown', event => {
    // Modal keyboard navigation must not trigger the song's Space shortcut.
    event.stopPropagation();
    if (event.key === 'Enter' && event.target.type === 'search') event.preventDefault();
  });
  dialog.addEventListener('input', event => {
    if (event.target.name === 'folder-search') { rememberTree(); renderTree(); }
    if (event.target.name === 'category-search') renderCategories();
  });
  dialog.addEventListener('change', event => {
    const input = event.target, name = input.name;
    if (name === 'any') selected.clear();
    if (name === 'category') for (const value of groups.find(g => g.label === input.value).values) input.checked ? selected.add(value) : selected.delete(value);
    if (name === 'all-folders') folders = [];
    if (name === 'folder') {
      const node = nodes.get(input.value);
      folders = folders.filter(f => key(f) !== input.value && (!input.checked || f.source !== node.source ||
        !withinFolder(f.path, node.path) && !withinFolder(node.path, f.path)));
      if (input.checked) folders.push({source:node.source, path:node.path});
    }
    if (['all-folders','folder'].includes(name)) { rememberTree(); renderTree(); }
    if (['any','category','all-folders','folder'].includes(name)) {
      renderCategories();
      [...dialog.querySelectorAll('input')].find(el => el.name === name && el.value === input.value)?.focus();
    }
  });
  $('[name=clear]').addEventListener('click', () => { selected.clear(); folders = []; renderTree(); renderCategories(); });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (dialog.returnValue === 'index') { void v.action('scan').catch(e => v.message(e.message, true)); return; }
    if (dialog.returnValue !== 'apply') return;
    try {
      if (v.session !== session) throw new Error('The session changed. Open its folder choices again.');
      editor.setCategories(id, [...selected].sort(), folders);
      v.message('Folder and category choices applied. Compatible clips and trims are kept; assemble to fill empty regions.');
    } catch (error) { v.message(error.message, true); }
  });
  renderTree(); renderCategories(); editor.root.append(dialog); dialog.showModal();
}
