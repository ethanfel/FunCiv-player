import { folderPath, folderName, localFolder, withinFolder } from '../../packages/composer-core/folders.mjs';
import { sectionCategories } from '../../packages/composer-core/regions.mjs';

// Keep the original category keys in recipes. Only their presentation is grouped,
// so reopening an old selection does not silently broaden its matching pool.
export function categoryGroups(clips, selected = []) {
  const groups = new Map();
  for (const clip of clips) for (const value of clip.categories || []) {
    const label = clip.origin !== 'dataset' && !clip.manual_categories ? folderName(value) : value;
    if (!groups.has(label)) groups.set(label, new Set());
    groups.get(label).add(value);
  }
  for (const value of selected) if (![...groups.values()].some(values => values.has(value))) groups.set(value, new Set([value]));
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([label, values]) => ({ label, values: [...values].sort() }));
}

export function folderTree(catalog, selected = []) {
  const nodes = new Map(), key = (source, path) => JSON.stringify([source, path]);
  const roots = [...new Set((catalog.roots || []).map(folderPath))].filter(root =>
    !(catalog.roots || []).some(other => folderPath(other) !== root && withinFolder(root, folderPath(other))));
  function add(source, path, boundary) {
    path = folderPath(path);
    const id = key(source, path);
    if (nodes.has(id)) return nodes.get(id);
    const node = { source, path, label: folderName(path), children: [] };
    nodes.set(id, node);
    const slash = path.lastIndexOf('/'), parent = slash === 0 ? '/' : path.slice(0, slash);
    if (path !== boundary && slash >= 0 && parent !== path && parent) add(source, parent, boundary).children.push(node);
    else node.top = true;
    return node;
  }
  for (const root of roots) add('local', root, root);
  for (const clip of catalog.clips.filter(c => !c.retired)) {
    const directory = localFolder(clip);
    if (directory) add('local', directory, roots.find(root => withinFolder(directory, root)) || directory);
    for (const path of clip.category_paths || []) add('hf', path);
  }
  for (const folder of selected) add(folder.source, folder.path,
    folder.source === 'local' ? roots.find(root => withinFolder(folder.path, root)) || folder.path : undefined);
  const sort = rows => rows.sort((a, b) => a.label.localeCompare(b.label)).map(n => ({ ...n, children: sort(n.children) }));
  return sort([...nodes.values()].filter(n => n.top));
}

export function sectionPoolLabel(section) {
  const categories = [...new Set(sectionCategories(section).map(folderName))].join(', ');
  const folders = (section.folders || []).map(f => `${f.source === 'hf' ? 'HF: ' : ''}${folderName(f.path)}`).join(', ');
  return [folders, categories].filter(Boolean).join(' · ') || 'Any folder / category';
}
