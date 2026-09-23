// Offline diagnostic reproductions for docs/AUDIT-2026-09-22.md.
// Run: node scripts/audit-composer.mjs
// These report whether a bug is still present; they are not passing CI tests.
// All files live in a disposable temp directory. No real profile or network.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { ComposerService, hash } from '../electron/composer-service.cjs';
import { createSession, arrange, validateSession, validateCoverage } from '../packages/composer-core/index.mjs';
import { draftAssemblyProposal, acceptDraftAssembly } from '../packages/composer-core/draft-proposal.mjs';
import { ComposerView } from '../renderer/composer/composer-view.js';
import { RegionEditor } from '../renderer/composer/region-editor.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'funciv-audit-'));
const signal = new AbortController().signal;
const observations = [];
const record = (id, reproduced, observed) => observations.push({ id, reproduced, observed });
const errorOf = async fn => { try { await fn(); return null; } catch (e) { return e.message; } };
const song = duration_ms => ({ id: 'synthetic-song', name: 'Audit song', duration_ms });
const script = { actions: [{ at: 0, pos: 10 }, { at: 500, pos: 90 }, { at: 1000, pos: 10 }] };
const clip = (id, categories) => ({ id, name: id, duration_ms: 1000, available: true, script_ready: true, scripts: { L0: script }, categories });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const offlineService = async name => new ComposerService(path.join(root, name), {
  fetchImpl: async () => { throw new Error('Unexpected network request in offline audit'); },
}).init();

try {
  // A: use the real Save action with a delayed IPC snapshot response.
  {
    const entered = deferred(), reply = deferred();
    const view = {
      session: createSession(song(1000), 1), revisions: new Map(), dirty: true,
      timeline: { action: () => false }, regionEditor: { action: async () => false },
      save: ComposerView.prototype.save,
      ipc: async (method, { session }) => {
        assert.equal(method, 'save');
        const saved = { ...structuredClone(session), revision: session.revision + 1 };
        entered.resolve(); await reply.promise; return saved;
      },
      refresh: async () => {}, message: () => {},
    };
    const saving = ComposerView.prototype.action.call(view, 'save');
    await entered.promise;
    view.session = { ...structuredClone(view.session), name: 'Edit made while saving' };
    view.dirty = true;
    reply.resolve(); await saving;
    record('A-save-race', view.session.name !== 'Edit made while saving' && !view.dirty,
      { name: view.session.name, dirty: view.dirty });
  }

  // B: a valid unique assignment exists, but a greedy choice can starve Y.
  {
    const session = createSession(song(3000), 3);
    session.sections.forEach((s, i) => { s.categories = [i ? 'Y' : 'X']; });
    const clips = [clip('a', ['X']), clip('b', ['Y']), clip('z', ['X', 'Y'])];
    const witness = structuredClone(session);
    witness.placements = ['a', 'b', 'z'].map((id, i) => ({ id: `p${i}`, section_id: session.sections[i].id,
      clip_id: id, start_ms: i * 1000, end_ms: (i + 1) * 1000, source_in_ms: 0, rate: 1 }));
    validateSession(witness, clips); validateCoverage(witness);
    witness.placements.forEach((p, i) => assert.ok(clips.find(c => c.id === p.clip_id).categories.includes(session.sections[i].categories[0])));
    const error = await errorOf(() => arrange(session, clips));
    record('B-false-shortage', !!error, { error, validAssignment: ['a', 'b', 'z'] });
  }

  // C: the offered assignment is valid, but fetching only its assets changes
  // the candidate pool and the second arrangement loses that solution.
  {
    const session = createSession(song(4000), 4);
    session.sections.forEach((s, i) => { s.categories = [i < 2 ? 'X' : 'Y']; });
    const clips = [['X', 'Y'], ['X', 'Y'], ['X'], ['X', 'Y'], ['Y'], ['Y']].map((categories, i) => ({
      ...clip(String(i), categories), scripts: i === 0 ? { L0: script } : undefined,
      script_ready: i === 0, origin: 'dataset', review_status: i === 0 ? 'approved' : 'draft', remote_scripts: { L0: {} },
    }));
    const proposal = draftAssemblyProposal(session, clips);
    assert.ok(proposal, 'fixture must produce a draft proposal');
    const loaded = clips.map(c => proposal.fetchIds.includes(c.id) ? { ...c, script_ready: true, scripts: { L0: script } } : c);
    const error = await errorOf(() => acceptDraftAssembly(proposal, loaded));
    record('C-draft-acceptance', !!error, { offered: proposal.assembled.placements.map(p => p.clip_id), fetchIds: proposal.fetchIds, error });
  }

  // D: use real catalog parsing/checksums and real file stats. FFprobe is not
  // needed: this test exercises catalog revisions and asset bindings only.
  {
    let commit = 'a'.repeat(40);
    const key = hash('civitai:123'), variant = 'b'.repeat(64), body = JSON.stringify(script);
    const row = { civitai_id: '123', variant_id: variant, duration_ms: 1000, review_status: 'draft', quality: 5,
      categories: ['X'], scripts: { L0: { path: `scripts/${key.slice(0, 2)}/${key}/${variant}.funscript`, sha256: hash(body) } } };
    const service = await new ComposerService(path.join(root, 'hf-refresh'), { fetchImpl: async url => {
      const catalog = JSON.stringify(row) + '\n';
      if (url.includes('/api/datasets/')) return new Response(JSON.stringify({ sha: commit }));
      if (url.endsWith('manifest.json')) return new Response(JSON.stringify({ schema: 's3f-public-funscripts/1', files: { 'data/catalog.jsonl': hash(catalog) } }));
      if (url.endsWith('data/catalog.jsonl')) return new Response(catalog);
      throw new Error('Unexpected mock URL');
    } }).init();
    await service.refreshDataset(signal);
    const file = path.join(root, 'cached-video.mp4'); await fs.writeFile(file, 'stat fixture');
    const stat = await fs.stat(file), entry = service.catalog.clips[0], id = entry.id;
    Object.assign(entry, { path: file, size: stat.size, mtime: stat.mtimeMs, available: true, scripts: { L0: script } });
    const session = { ...createSession(song(1000), 1), include_drafts: true };
    const saved = await service.saveSession(arrange(session, service.state().clips));
    commit = 'c'.repeat(40); // Everything in the row stays identical.
    await service.refreshDataset(signal);
    const cachedReady = service.state().clips.find(c => c.id === id).script_ready;
    const commitError = await errorOf(() => service.clipsForSession(saved));
    row.variant_id = 'd'.repeat(64); // Emulate retiring the old variant.
    await service.refreshDataset(signal);
    const retained = service.catalog.clips.some(c => c.id === id);
    const retiredError = await errorOf(() => service.clipsForSession(saved));
    record('D-hf-refresh', !cachedReady && !!commitError && !retained && !!retiredError,
      { cachedReady, commitError, retiredVariantRetained: retained, retiredError });
  }

  // E: exercise the entire resolve fallback with mocked metadata/download,
  // real files and stat checks; decoding itself is outside this reproduction.
  {
    const service = await offlineService('fallback'), library = path.join(root, 'fallback-library');
    await fs.mkdir(library);
    const file = path.join(library, 'creator_civitai_123_original.mp4'); await fs.writeFile(file, 'video fixture');
    service.probe = async () => ({ duration_ms: 1000, video: true, width: 160, height: 90 });
    await service.scan(library, signal);
    const entry = { ...clip('hf-123-b', ['X']), origin: 'dataset', civitai_id: '123', variant_id: 'b'.repeat(64), commit: 'a'.repeat(40) };
    service.catalog.clips.push(entry); await service.linkLocalClips([entry], signal);
    assert.ok(entry.local_video_id); await fs.rm(file);
    service.fetchScripts = async () => ({ L0: script });
    service.bytes = async () => Buffer.from(JSON.stringify({ items: [{ id: 123, type: 'video', url: 'https://image.civitai.com/example/width=160/video.mp4' }] }));
    service.downloadMedia = async (_url, dest) => fs.writeFile(dest, 'downloaded fixture');
    await service.resolveClip(entry.id, 'civitai.com', signal);
    const availableAfterResolve = entry.available;
    await fs.access(entry.path); // A real new cached file now exists.
    await service.linkLocalClips([entry], signal);
    record('E-fallback-marked-missing', availableAfterResolve && !entry.available,
      { availableAfterResolve, availableAfterRelink: entry.available, staleLocalId: !!entry.local_video_id });
  }

  // F/G: index an actual folder, make that exact root disappear, then rescan.
  {
    const service = await offlineService('offline-root'), library = path.join(root, 'offline-library');
    await fs.mkdir(library); await fs.writeFile(path.join(library, 'clip.mp4'), 'video fixture');
    service.probe = async () => ({ duration_ms: 1000, video: true, width: 160, height: 90 });
    await service.scan(library, signal);
    const session = createSession(song(1000), 1); session.sections[0].motion = 'hold';
    const saved = await service.saveSession(arrange(session, service.state().clips));
    await fs.rename(library, library + '-offline');
    const rescanned = await service.rescan(signal), available = service.state().clips[0].available;
    const arrangeError = await errorOf(() => arrange(saved, service.state().clips));
    record('F-offline-root', available && !arrangeError && rescanned.warnings.length > 0,
      { available, arrangeError, scanWarnings: rescanned.warnings.length });
    const saveError = await errorOf(() => service.saveSession({ ...saved, name: 'Timeline edited while drive is offline' }));
    record('G-offline-save', !!saveError, { saveError });
  }

  // H: real RegionEditor event registration; emulate the actual inspector
  // rebuild removing the focused handle. JSDOM models DOM focus/bubbling,
  // not physical browser pointer capture.
  {
    const dom = new JSDOM('<main><div class="fc-source-rail"><button data-source-drag="p">Trim</button></div></main>');
    try {
      const document = dom.window.document, element = document.querySelector('main');
      const session = createSession(song(1000), 1);
      session.placements = [{ id: 'p', clip_id: 'a', section_id: session.sections[0].id, start_ms: 0, end_ms: 1000, source_in_ms: 0, rate: 1 }];
      element.setPointerCapture = () => {}; element.hasPointerCapture = () => false;
      const view = { root: element, session, dirty: false, sectionEditor: {}, catalog: { clips: [clip('a', ['X'])] },
        invalidate: () => {}, renderEditor: () => {}, renderInspector: () => { element.querySelector('button').remove(); } };
      const editor = new RegionEditor(view), button = element.querySelector('button'); button.focus();
      element.querySelector('.fc-source-rail').getBoundingClientRect = () => ({ width: 100 });
      editor.beginDrag({ target: button, button: 0, pointerId: 1, clientX: 0, preventDefault() {} });
      document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      record('H-source-drag-escape', !!editor.drag, { focus: document.activeElement.tagName, dragStillActive: !!editor.drag });
      editor.finishDrag(true);
    } finally { dom.window.close(); }
  }
  console.log(JSON.stringify({ observations }, null, 2));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
