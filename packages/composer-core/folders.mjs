// Folder scopes are independent of category labels. A parent includes its
// descendants; separators are normalized so saved Windows paths work too.
export const folderPath = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '') || '/';
export const withinFolder = (path, parent) => path === parent || path.startsWith(parent === '/' ? '/' : parent + '/');
export const folderName = path => folderPath(path).split('/').at(-1) || '/';
export function localFolder(clip) {
  if (!clip.path || clip.origin === 'dataset' && !clip.local_video_id && clip.video_source !== 'library') return null;
  const path = folderPath(clip.path), end = path.lastIndexOf('/');
  return end < 0 ? null : path.slice(0, end) || '/';
}
export function matchesFolders(clip, folders = []) {
  return !folders.length || folders.some(folder => folder.source === 'local'
    ? localFolder(clip) !== null && withinFolder(localFolder(clip), folder.path)
    : (clip.category_paths || []).some(path => withinFolder(folderPath(path), folder.path)));
}
export function validateFolders(folders) {
  if (folders === undefined) return;
  if (!Array.isArray(folders) || folders.length > 1000 || folders.some(f => !f || !['local', 'hf'].includes(f.source) ||
    typeof f.path !== 'string' || !f.path.trim() || f.path.length > 4096 || /[\x00-\x1f\x7f]/.test(f.path) || folderPath(f.path) !== f.path) ||
    new Set(folders.map(f => JSON.stringify([f.source, f.path]))).size !== folders.length)
    throw new Error('Choose valid, unique section folders.');
}
