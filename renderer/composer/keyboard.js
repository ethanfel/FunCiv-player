export function composerShortcut(event, view) {
  const action=event.code==='Space'||event.key===' '?'play':event.key?.toLowerCase()==='f'?'fullscreen':event.key?.toLowerCase()==='m'?'mute':event.key==='Escape'&&view.previewControls?.fullscreen?'fullscreen':null;
  if (!action || !view.visible || action==='play'&&!view.session || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
  const target=event.target,document=view.root.ownerDocument;
  const modal=document.querySelector('dialog[open]') || [...document.querySelectorAll('[role=dialog][aria-modal=true]')]
    .some(el=>!el.hidden&&el.getClientRects().length&&document.defaultView.getComputedStyle(el).visibility!=='hidden');
  if (modal ||
    target.closest?.('textarea, select, [contenteditable]:not([contenteditable=false])') ||
    target.tagName === 'INPUT' && target.type !== 'range' ||
    target.closest?.('[data-source-preview], [data-music-audition]') ||
    target !== document.body && target !== document.documentElement && !view.root.contains(target)) return;
  event.preventDefault();event.stopPropagation();
  if (!event.repeat) void view.action(action).catch(error=>view.message(error.message,true));
}
