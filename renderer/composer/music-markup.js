import { BEAT_CATALOG, BEAT_SOUNDS } from '../../vendor/motion-studio/audio-patterns.mjs';
const choices=items=>items.map(([value,label])=>`<option value="${value}">${label}</option>`).join('');
const select=(key,label,items)=>`<label>${label}<select data-music-setting="${key}">${choices(items)}</select></label>`;
const number=(key,label,min,max,step=1)=>`<label>${label}<input data-music-setting="${key}" type="number" min="${min}" max="${max}" step="${step}"></label>`;
const check=(key,label)=>`<label class="fc-music-check"><input type="checkbox" data-music-setting="${key}">${label}</label>`;
export const MUSIC_MARKUP=`<section class="fc-music-editor" id="fc-music-panel" role="tabpanel" aria-labelledby="fc-music-tab" hidden>
  <div class="fc-music-heading"><div><span class="fc-eyebrow">MUSIC &amp; BEATS</span><h2>Shape the rhythm of your song.</h2><p>Drums set the timing. The main song can guide shape and energy. Generate a preview, then Apply to arrangement. Saved blocks drive Audio sync clips and Follow song sections.</p></div><div class="fc-actions"><button data-music-action="undo">↶ Undo</button><button data-music-action="redo">↷ Redo</button></div></div>
  <div class="fc-music-sources">
    <div><span class="fc-music-dot fc-music-main-dot"></span><div><strong>Main song · playback &amp; energy</strong><span data-music-main>No song loaded</span><small data-music-main-status>Load and analyze a song to begin.</small></div><button data-music-action="analyze-main">Analyze main song</button></div>
    <div><span class="fc-music-dot fc-music-beat-dot"></span><div><strong>Drums / beat track · timing</strong><span data-music-source>Using the main song</span><small data-music-source-status>An isolated drums stem gives clearer timing.</small></div><button data-music-action="import" class="fc-primary">＋ Import drums / beats</button></div>
    <div class="fc-music-source-tools"><label>Beat source<select data-music-source-select aria-label="Beat source"><option value="">Main song</option></select></label><label>Beat audio starts at (ms)<input data-music-offset type="number" step="1" value="0" aria-label="Beat audio offset"></label><button data-music-action="analyze">Analyze beat source</button><small>Positive offset delays the beats; negative offset advances them. Main-song playback stays in place.</small></div>
  </div>
  <div class="fc-music-generate"><button class="fc-primary" data-music-action="generate">Generate preview</button><button data-music-action="variation">Another variation</button><button class="fc-primary" data-music-action="apply" disabled>Apply to arrangement</button><button data-music-action="discard" disabled>Discard preview</button><button data-music-action="remove" disabled>Remove saved range</button><button data-music-action="arrangement">Open Video arrangement →</button></div>
  <p class="fc-music-status" role="status">Choose a range and generate a preview. Pink is unsaved; purple is the saved script.</p>
  <div class="fc-music-toolbar"><button data-music-action="zoom-out" aria-label="Zoom music out">−</button><output data-music-zoom>1×</output><button data-music-action="zoom-in" aria-label="Zoom music in">＋</button><button data-music-action="fit">Fit song</button><button data-music-action="fit-range">Fit selection</button><span class="fc-spacer"></span><small>Click to seek · Shift-drag to select · Drag range edges · Ctrl/⌘ + wheel to zoom</small></div>
  <div class="fc-music-scroll"><div class="fc-music-track"><canvas class="fc-music-canvas" height="360" aria-label="Music timeline: main waveform, drums, saved blocks and script curve" tabindex="0"></canvas><div class="fc-music-range"><button data-music-edge="start" aria-label="Music selection start" title="Drag selection start; arrow keys adjust timing"></button><button data-music-edge="end" aria-label="Music selection end" title="Drag selection end; arrow keys adjust timing"></button></div><div class="fc-music-cursor"></div></div></div>
  <div class="fc-music-range-tools"><label>In (s)<input data-music-bound="start" type="number" min="0" step="0.001" value="0"></label><button data-music-action="mark-in">Mark in</button><label>Out (s)<input data-music-bound="end" type="number" min="0" step="0.001" value="0"></label><button data-music-action="mark-out">Mark out</button><button data-music-action="whole">Whole song</button><label>Song section<select data-music-section aria-label="Music range from song section"></select></label></div>
  <div class="fc-music-settings">
    <fieldset><legend>Rhythm</legend><div class="fc-music-fields">
      ${select('rhythm','Rhythm',[['simplify','Simplify groove'],['accents','Follow accents'],['steady','Steady pulse'],['original','Original timing']])}
      ${select('timing','Timing',[['hits','Drum peaks'],['beats','Detected beats'],['tempo','Tempo grid']])}
      ${number('bpm','BPM',30,300,.1)}${select('density','Density',[[.5,'Sparse'],[1,'Balanced'],[2,'Dense']])}
      ${number('lowFocus','Favor low hits (0–1)',0,1,.05)}${number('maxHitsPerSecond','Max hits / second',.25,8,.25)}
      ${select('beatsPerCycle','Beats / cycle',[[.5,'½'],[1,'1'],[2,'2'],[4,'4'],[8,'8']])}${check('preserveSyncopation','Keep syncopation')}
    </div><small data-music-rhythm-help></small></fieldset>
    <fieldset><legend>Pattern &amp; stroke</legend><div class="fc-music-fields">
      ${select('mode','Pattern mode',[['waveform','Auto · match sound'],['suggest','Suggest from audio'],['manual','Choose pattern'],['random','Random variation']])}
      ${select('shape','Shape',BEAT_CATALOG.map(p=>[p.name,p.name]))}${select('patternFamily','Pattern family',[['all','All families'],...[...new Set(BEAT_CATALOG.map(p=>p.family))].map(p=>[p,p])])}
      <label>Stroke length (%)<input data-music-stroke type="number" min="0" max="100" step="1" value="80"></label>${number('center','Center (%)',0,100)}
      ${select('beatLanding','On beat',[['down','Down · lowest point'],['up','Up · highest point'],['shape','Original shape']])}
      ${number('seed','Variation seed',0,4294967295)}${check('followEnergy','Follow energy')}
      <label class="fc-music-check"><input type="checkbox" data-music-mix checked>Use main song for shape &amp; energy</label>
    </div></fieldset>
  </div>
  <details class="fc-music-catalogue"><summary>Pattern catalogue · ${BEAT_CATALOG.length} shapes</summary><div class="fc-music-patterns"></div></details>
  <div class="fc-music-audition"><label>Percussion sound<select data-music-sound>${choices(BEAT_SOUNDS.map(s=>[s.id,s.label]))}</select></label><button data-music-action="listen" disabled>Listen rhythm</button><button data-music-action="stop-audition" disabled>Stop rhythm</button><button data-music-action="download" disabled>Download rhythm WAV</button><audio data-music-audition controls hidden></audio></div>
  <details class="fc-music-decisions"><summary>Why these shapes?</summary><div data-music-decisions>Generate a preview to see the pattern choices.</div></details>
  <div class="fc-music-saved"><h3>Saved beat blocks</h3><div data-music-blocks>No saved blocks yet.</div><p>Saving a range replaces overlapping beat blocks and keeps everything outside it. Uncovered ranges use the last saved pattern settings. Clip motion and Neutral hold sections keep their own behavior.</p></div>
</section>`;
