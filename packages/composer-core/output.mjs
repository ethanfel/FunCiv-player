export const OUTPUT_PRESETS = Object.freeze([
  Object.freeze({id:'portrait-1080', label:'Portrait · 1080 × 1920', width:1080, height:1920}),
  Object.freeze({id:'landscape-720', label:'Landscape · 1280 × 720', width:1280, height:720}),
]);
export const DEFAULT_OUTPUT = Object.freeze({preset:'portrait-1080', fit:'cover'});

/** Recipes written before output settings retain their original landscape fit. */
export function outputSettings(session) {
  const value = session.output === undefined ? {preset:'landscape-720', fit:'contain'} : session.output;
  const preset = OUTPUT_PRESETS.find(p => p.id === value?.preset);
  if (!preset || !['cover','contain'].includes(value?.fit)) throw new Error('Choose a supported output format and scaling mode.');
  return {preset:preset.id, width:preset.width, height:preset.height, fit:value.fit, fps:30};
}
