# First working implementation — 21 September 2026

Repository: [ethanfel/FunCiv-player](https://github.com/ethanfel/FunCiv-player), forked from FunSync revision `147a788f55ff762b126abcd63d11b52996bdf1ad`.

The implemented slice is a desktop Composer with real song import/analysis, editable sections, category-tagged clips, deterministic arrangements, live audio/video preview, a six-axis motion compiler, device-source binding, persisted recipes, selected remote-asset resolution, and disposable MP4/script rendering. It runs alongside the original player with independent settings and backend ownership.

## Code map

| Component | Responsibility |
| --- | --- |
| `packages/composer-core/index.mjs` | Session validation, deterministic arrangement, trim/rate mapping, section policies, shared motion compilation, undo history |
| `electron/composer-service.cjs` | Registered local library, canonical WAV cache, FFprobe/FFmpeg jobs, dataset verification, Civitai resolution, revision-checked session saves, render manifests and cleanup |
| `electron/composer-ipc.js` | Native dialogs, privileged operations, encrypted API credential storage, narrow renderer bridge |
| `renderer/composer/composer-view.js` | Composer workspace, category editing, section/placement inspectors, analysis, preview/export controls |
| `renderer/composer/composition-player.js` | Song-clock transport, two muted video decoders, source seeks, stall handling, superseded-play protection |
| `renderer/composer/device-session.js` | FunSync engine ownership, multi-axis loading, existing output limits, cloud upload ordering, source release |
| `electron/owned-backend-port.js` | Available loopback-port selection without process termination |
| `vendor/motion-studio/` | Unmodified, versioned Motion Studio algorithms and license |

## Deliberate differences from the original plan

Composer's privileged services initially run in Electron's Node process, with the same JavaScript compiler imported by preview preparation and export. The inherited FastAPI service continues to serve FunSync. There is no additional REST server or websocket compiler protocol in this version.

The recipe uses integer milliseconds at section boundaries and script output, with floating-point source-rate mapping. Export quantizes absolute cut positions to 30 fps rather than accumulating rounded clip durations. The proposed microsecond/rational internal representation is future work.

Catalog and recipes use atomic JSON files rather than SQLite. This is suitable for the initial library size; library paging, a database index, a disk quota, and an eviction policy remain open. Saved recipes pin stat/script/variant bindings; playback fails clearly when those assets change, while offline and unresolved recipes remain saveable. HF script cache reuse follows content checksums, and retired variants remain addressable using their original commit. Historical local media bytes are not copied. See [the September audit fixes](AUDIT-FIXES-2026-09-22.md) for compatibility and validation.

The initial section proposal is six equal ranges. Audio analysis supplies waveform, tempo, confidence, and event data; automatic musical form labeling is not implemented. Source gaps are explicitly marked. Motion generation uses a tempo-aligned, energy-following sine pattern, reusing Motion Studio's generator.

The live ComfyUI editor and GPU extraction pipeline are not connected. Local saved sidecar scripts and dataset variants are supported inputs. Civitai media are checked for plausible duration, not cryptographic frame identity with a source video.

## Validation

- **14 Composer tests passed:** deterministic/locked arrangements, trim/rate interpolation, six axes and chapter units, explicit gap replacement, rejected invalid timelines, history isolation, cancelled playback/upload races, engine rebinding, occupied-port ownership, local import/rescan, revision conflicts and changed assets, actual FFmpeg output, checksummed manifest, cleanup, and remote catalog/redirect validation.
- **298 relevant upstream tests passed** across player/sync, keyboard, session tracker, store/data service, module exports, backend banner, and filler test player. The entire inherited suite was not run.
- **Real Electron workflow passed** using a disposable profile and synthetic media: first-run language selection, analysis, arrangement, playback through clip boundaries, paused seeking, save, song motion, rendering, and six-axis handoff into FunSync. Backend restart also kept its selected port.
- **Live public dataset catalog verified** at commit `2d1647699add22f33efc085e960090782a9237c9`: 17 variants, 16 drafts and one approved. No real videos were downloaded or displayed in tests.
- Hardware output and authenticated Civitai downloads have not been field-tested. No signed/package release was built.

The UI test requires a desktop display. On this workstation Electron's headless window backend stalled; the smoke test uses the desktop backend with frame throttling disabled. The screenshot in README is generated by that test and contains synthetic color clips only.

## Clip availability and star ratings — 21 September 2026

The library now exposes all catalog entries, ready video/script pairs, local videos and clips used in the current session, with status labels and usage counts. Cards show dataset variant quality or a persistent personal rating override. Sorting supports highest rating first and alphabetical order. A per-session minimum offers all ratings, 1–4 stars or higher, and 5 stars only; unrated entries are excluded at positive minimums.

**Rating priority and intensity metadata — 23 September 2026.** Assembly now prefers higher effective notes: the personal rating override if present (including an explicit zero), otherwise HF `quality`. Fixed regions use weighted matching to maximize total note while retaining a feasible assignment across overlapping category pools and unique video identities. Automatic clip lengths try higher notes first and retain longer lower-rated alternatives when needed for full coverage. Reviewed variants break rating ties, followed by seeded variation. Draft opt-in, category/duration limits, minimum rating and kept clips still apply. With the default no-repeat policy, selecting another variant of the same source cannot add footage. Explicit cycle mode exhausts matching source videos before reusing them and prioritizes notes within each usage tier.

HF `intensity` and `intensity_mode` are imported, validated and persisted. Missing fields default to `0` (unrated) and `manual`; accepted values are integer 0–5 and `manual`/`auto`. Selected HF clip details display the level and whether it is an author rating or automatic estimate. Intensity currently has no effect on selection, motion strength, audio analysis or asset bindings. Metadata-only intensity changes keep verified scripts and saved playback intact.

The checksum-verified [HF catalog at revision 4f111ca](https://huggingface.co/datasets/ethanfel/FunCiv-Data/blob/4f111caef9fdc5b0a764c56f73d8635a8a904002/data/catalog.jsonl) contains 148 variants: 109 have a quality note and 78 have a nonzero intensity. The note is published as `quality`; no separate `note` field is present. A disposable live import confirmed persistence without fetching videos or scripts. Metadata-only planning for 60 fixed three-second regions selected all 56 five-star videos and four four-star videos; an automatic three-minute plan selected 16 distinct five-star videos. Both used explicit draft opt-in because the pinned catalog marks all 148 variants as drafts.

Validation: **68 Composer tests passed**, including 240 independently enumerated rating-optimal assignments, rating overrides, tied variations, unique source variants, duration fallback, intensity validation/persistence and unchanged compiled motion. **3,839 general unit tests passed.** The Electron workflow checks the intensity details, existing rating/filter/draft behavior, timeline interactions, audible playback, portrait export and six-axis handoff. Restart the app and use **Sync FunCiv Data** to import newly published metadata; existing timelines keep their choices until reassembled.

The shared compiler checks all placed clips against the current catalog before preview, device preparation or rendering. Locked sections cannot retain below-minimum clips during assembly. The used-clips view retains conflicts, and the replacement selector preserves the actual current choice while offering only qualifying alternatives. Changes to the minimum or a used rating invalidate preview; an in-flight preparation cannot restore a snapshot invalidated by a rating edit. Legacy sessions without a minimum keep accepting unrated clips.

Local overrides are stored separately from source quality and survive rescans, remote refreshes and restarts. They do not change media bindings or public dataset ratings. ComfyUI's internal local review ratings are not automatically imported.

Validation: **18 Composer tests passed**, including rating ranges, unrated/override semantics, locked and manually replaced clips, backend preview/export rejection, persistence and real FFmpeg output. The **real Electron workflow passed** with availability views, both sort modes, 4★+/5★ assembly, visible conflicts, replacement filtering, saved minimum restoration and preview invalidation, followed by playback, rendering and the existing six-axis player handoff. README's screenshot was refreshed using synthetic clips.

## Portrait output and proportional cropping — 21 September 2026

Composer now has Output format and Scaling controls above the preview. New recipes default to portrait 1080×1920 with centered fill/crop; landscape 1280×720 and fit/pad remain available. Recipes without an `output` field retain the previous landscape fit behavior. Both formats use 30 fps. Format changes select fill/crop; the user can then choose fit/pad explicitly. Edits preserve placements and media bindings, participate in undo/redo, and invalidate prepared playback.

`packages/composer-core/output.mjs` validates the supported preset and scaling mode. Recipes store `output: {preset, fit}`; compiled snapshots carry the resolved dimensions and frame rate as well. Export uses those compiled settings and records them in the manifest. It validates the finished video's dimensions before returning the result. Motion compilation is independent of output geometry.

The preview displays a responsive frame with the selected aspect ratio and centered `object-fit: cover` or `contain`. Export scales proportionally using FFmpeg's display aspect ratio, converts to square pixels, and centers either a crop or padding. Even scaling dimensions support H.264/yuv420p. Rotation metadata is applied by FFmpeg before the scaling filter. See the [FFmpeg scale reference](https://ffmpeg.org/ffmpeg-filters.html#scale-1). Crop positioning and subject tracking remain future work.

Validation: **21 Composer tests passed**, including real 1080×1920 export from mixed frame rates, landscape, square, tall portrait, native portrait, non-square pixels and rotation metadata. Pixel checks assert expected corners, centered markers and preserved square shapes; exported scripts match preview compilation. Legacy landscape export, malformed output settings, history and rating checks also passed. The **real Electron workflow passed** with portrait/landscape geometry at desktop and narrow widths, fill/fit, preserved placements, undo/redo, saved settings, mixed-aspect playback and portrait export opened in FunSync. The rotation fixture uses FFmpeg 6+'s explicit display-rotation option.

## Category sections and editable clip regions — 21 September 2026

Sections now support a `categories` array (any matching category qualifies); the legacy single `category` field remains readable. The UI separates Section and Clip region inspectors. Explicit regions are placements with fixed song bounds; `clip_id: null` represents an unfilled draft region, and `section.planned_regions` preserves the section's cut layout across assembly and variations. The existing automatic clip-length behavior remains available for sections without an explicit layout.

`packages/composer-core/regions.mjs` implements region coverage, manual cuts, merges, shared boundary edits, source-window slips, and large section edits. Region assembly picks a long-enough clip under category, rating, availability and motion filters, with a seeded source offset. Manually chosen sources/trims can be kept through variations using placement `locked`. No automatic looping or speed changes are introduced. Empty regions can be saved with bindings for assigned clips, but compilation/export rejects incomplete coverage or unassigned regions.

`renderer/composer/region-editor.js` provides Mark in/out, cut/merge controls, timeline zoom, snapping, pointer-captured boundary/source dragging, one undo entry per drag, Escape cancellation, exact numeric controls and an independent source preview. The shared-cut edit keeps neighbors contiguous and clamps to available source duration. Source slipping preserves song bounds and rate, and applies equally to video and script remapping. Source playback pauses the composition and releases its device binding.

`packages/composer-core/audio-cuts.mjs` suggests beat-group cuts with nearby texture/energy changes from the existing Motion Studio analysis. Suggestions appear as orange markers before explicit application. They are heuristics, not verse/chorus recognition. Missing tempo/grid data produces a manual-marking prompt. Kept clips whose geometry would change require unlocking; unaffected kept regions survive marking elsewhere in the section.

Validation: **28 Composer tests passed**, including category unions, fixed region coverage, unfilled drafts, long-enough selection, trim continuity, boundary limits, kept clips, large section edits, audio-change suggestions, save/load and real video export. The **real Electron workflow passed** with folder checkboxes, Mark in/out, rejection of incomplete preview, actual cut/source-window mouse drags, undo/redo, variations retaining trims, suggested audio cuts, section merging, restored recipes, inspector tabs and final portrait export with six-axis FunSync handoff. The screenshot uses synthetic media only.

## Optional HF draft scripts — 21 September 2026

Sam3D's exporter now defaults to `review_policy: "all-drafts"`, independently of local approval actions and quality ratings. The live [HF snapshot manifest](https://huggingface.co/datasets/ethanfel/FunCiv-Data/blob/b003c3a6c342ce8584873234480f48ad0daf82f5/manifest.json) and checksum-verified catalog contain 129 variants, all drafts, with 774 axis scripts. Of those variants, 128 are unrated and one has quality 5. The earlier 17-variant inspection above describes the older snapshot.

The existing draft checkbox now saves a strictly boolean `include_drafts` session option. New and legacy recipes exclude drafts unless explicitly enabled; a new song inherits the currently selected option. The shared arranger and compiler enforce it, including locked sections, kept regions and every motion policy. Manual replacement uses the same review rule. Disabling drafts preserves placements and trims, invalidates prepared playback and releases device sync; used drafts stay visible as conflicts. Undo/redo and saved-session loading restore the checkbox. A late preparation response cannot undo a draft-policy edit.

Catalog refresh retains the publisher's review policy and derives counts from imported rows. An all-drafts policy overrides approval labels; missing or unknown remote review labels are treated as drafts. The library explains the policy, labels individual drafts and keeps star filtering independent. Resolving still pins/checksums the script variant and reuses a duration-compatible local video or resolves the selected Civitai video. Resolution never approves a script.

Validation: **31 Composer tests passed**, including draft opt-in versus ratings, legacy and malformed settings, locked/kept clips, manual-placement compilation, preserved region bounds, and a mocked HF catalog/script download using a real synthetic local video. The integration test saves/reopens the option, checksums the downloaded script, exports actual video and matching motion, records the choice in the render manifest, and rejects preview/export when drafts are disabled. No real source videos or device output were used.

The **real Electron workflow passed** with draft counts and labels, independent rating filters, a draft-only arrangement, preview preparation/rejection, manual-choice filtering, preserved trims, saved-session restoration, undo/redo and late preparation invalidation. Existing category editing, source/cut dragging, mixed-resolution playback, portrait export and six-axis handoff also passed. The updated screenshot uses synthetic media.

## Listen before assembling — 21 September 2026

Play previously compiled the entire composition first, so an imported song could not be auditioned before selecting usable clips. The transport now has **Playback → Song only** and **Video + motion preview** modes. New and reopened sessions load the song immediately in Song only mode. Play/pause, volume, slider/waveform seeking and Stop work without analysis, placements or scripts; the playhead updates while listening so region markers use the actual song position.

`CompositionPlayer` can load and seek a standalone song while its video decoders remain paused and hidden. Song-only playback cannot arm devices, and switching modes invalidates pending preparation and releases sync. Preview preparation selects the video mode, retains the selected song position and stays paused. Generation checks prevent pending audio playback from restarting after pause/song replacement, and prevent superseded preview loading from restoring stale UI state.

Validation: **33 Composer tests passed**. The **real Electron workflow passed**, including a Web Audio measurement of a nonzero song signal before analysis or assembly, unmuted playback at the selected volume, play/pause, waveform and slider seeks, Stop, mode changes preserving song position and song playback while draft clips are excluded. Existing video playback, editing, export and device handoff checks also passed. Tests use synthetic audio/video and no connected devices.

## Timeline navigation, section folders and compact library — 21 September 2026

`renderer/composer/timeline-viewport.js` owns timeline navigation: continuous 1×–256× zoom, pointer-anchored Ctrl/Command-wheel zoom, horizontal/Shift-wheel panning, middle-button dragging, ruler/waveform scrubbing, Fit song/section and optional playhead following. Track elements use full-song coordinates, while sticky canvases draw only the visible window with readable time ticks. Canvas backing sizes remain bounded by the viewport at high zoom. Navigation is separate from recipe history.

Folder choices now appear in the selected-section bar, section timeline blocks, section list and clip inspector. The folder dialog stages a multi-selection with eligible/catalog counts and explicit Apply/Cancel. Applying affects only that section, preserves compatible clips and trims, and keeps incompatible clips' intervals as empty regions. Unassembled sections expose a visible folder prompt. The existing inspector checkboxes use the same operation.

Song splits create independent sections and preserve source continuity across crossing clips. Default labels are renumbered chronologically after splits/merges; custom names get unique numbered copies. Reopening a recipe repairs old generated “Section 1 B” names and marks it unsaved. Explicitly edited names use `auto_label: false`, so later normalization preserves them even if they resemble a generated name. Clip split controls and track labels now state their scope separately from song sections.

`renderer/composer/clip-library.js` replaces repeated per-clip forms with compact selectable rows and one details editor. Rows retain availability, stars, draft labels, categories, usage counts and conflicts. Search, selection, filtering and rating/category/resolve operations retain their existing semantics. Advanced filters collapse with a visible minimum-rating/draft summary; used-clip conflict warnings stay visible outside the collapsed controls.

Validation: **35 Composer tests passed**, including repeated splits, independent folder arrays, unique names, custom-name preservation, old-name repair, zoom geometry and readable tick intervals. The **real Electron workflow passed** with actual pointer-anchored wheel zoom, 256× bounded canvas sizes, middle-drag/Shift-wheel pan, ruler seeking, fit controls, recipe-preserving navigation, split undo, folder dialog cancellation/application preserving compatible trims, and 129 compact catalog rows with search and one details editor. Existing audible song playback, cut/source drags, ratings, drafts, saved recipes, mixed-resolution portrait export and six-axis handoff also passed. Both documentation screenshots use synthetic fixtures.

Folder dialog follow-up: the shared dialog rule gave checkboxes `width: 100%`, squeezing category labels down to 7–9 pixels and making them wrap vertically. Dialog checkboxes now have a fixed 14-pixel size without flex growth or text-input padding; category text can use the remaining row width. The Electron regression now measures actual checkbox and label geometry at 1500×1080 and 828×815, alongside Apply/Cancel behavior. It reproduced the original failure before the CSS fix; the complete Electron workflow passed afterward.

## Published HF folder categories — 21 September 2026

The checksum-verified [HF catalog at revision 1442bcb](https://huggingface.co/datasets/ethanfel/FunCiv-Data/blob/1442bcb34f1ab62111e2be174bfd0b444a190818/data/catalog.jsonl) now contains categories for all 129 variants: 12 short category labels and 13 relative folder paths. All variants remain drafts. This supersedes the earlier snapshots that omitted folder labels.

Dataset refresh validates and imports both `categories` and `category_paths`. Published labels replace automatic defaults and refresh on subsequent syncs; explicit `manual_categories` overrides remain in place. The catalog keeps the latest published labels, paths and automatic category selection separately so **Use imported categories** can restore the current set, including after restarting. Category fields remain optional for older snapshots; missing labels fall back to matching local folders or Uncategorized. Matching local assets now excludes remote entries, preventing a prior remote row from matching itself and hiding a local folder.

Section folder choices use the short labels. Library search also matches full relative paths, and selected clip details display both forms. The inspector refreshes when the catalog changes so imported labels are immediately available. Categories do not approve drafts, alter ratings or rewrite saved section/clip timings.

Validation: **36 Composer tests passed**, including migration from old Uncategorized entries, multiple labels, repeated refreshes, persisted manual overrides/reset, local fallback, malformed metadata rejection and section matching with independent draft enforcement. The **real Electron workflow passed**, including folder-path search, published labels in the section picker, category overrides/reset through IPC, and the existing playback/edit/export checks. The actual importer also migrated all 129 rows from the pinned public snapshot in a disposable catalog; no videos were downloaded.

## Per-clip Audio sync — 21 September 2026

The checksum-verified [HF snapshot at 0a7ee43](https://huggingface.co/datasets/ethanfel/FunCiv-Data/blob/0a7ee43334b8a186b7614abc2a75f39cef268c45/data/catalog.jsonl) publishes a separate boolean `audio_sync`: one marked variant and 128 unmarked. Import validates its type, defaults older missing fields to false and persists updates independently from manual category overrides. No category-name inference is used.

The shared compiler generates song-time L0 motion only over marked placements in clip/gap sections, ignoring their stored motion axes. Secondary axes use neutral actions over those ranges, subject to the existing cut blend. Neighboring unmarked clips retain remapped scripts. Source slips and video rate changes leave song-generated motion on the global audio clock. Section strength, full-section Follow song and explicit Neutral hold retain their meanings. Analysis is required before generating motion; ratings, draft policy, category membership and available video still control eligibility. The section's default label is now **Clip / audio sync**.

Library rows expose a compact badge and a dedicated Show filter. Clip details and the region inspector explain the active behavior. A changed marker on a used clip invalidates prepared playback; bindings include true markers while retaining compatibility with older unmarked bindings. Imported local-video matches carry file stat metadata so marked clips can use analyzed song motion without first downloading scripts. Preview, device preparation and exports use the same compiler. Composer still uses its one loaded song as the analysis source; a separate beat-stem input remains future work.

Validation: **39 Composer tests passed**, including mixed script/audio-sync regions, global song-clock alignment, source-slip/rate independence, stored-script override, neutral secondary axes, strength, analysis requirements, gaps/hold, draft/rating/category enforcement, imported boolean persistence and changed-label bindings. A synthetic local-video integration verified audio-sync preparation and real FFmpeg export produce identical scripts without fetching the clip's stored script. The **real Electron workflow passed**, including badges/filtering, the analysis prompt, generated region blocks, label-change invalidation and compact rows with the new badge. A disposable live import verified all 129 published flags and the single marked variant without downloading videos.

## Draggable song-section boundaries — 21 September 2026

`renderer/composer/section-editor.js` adds visible purple dividers between song sections. Pointer capture preserves dragging across re-rendered track elements. Pointer time uses the zoomed/scrolled timeline, with optional audio snapping, Alt bypass and edge scrolling. An active vertical guide displays the boundary time. Arrow keys move a focused divider by 100 ms, or 1 second with Shift, without snapping. Dividers expose separator roles and accessible time values; locked neighbors disable their shared handle.

The editor reuses `resizeSongSection` to keep neighbors contiguous, enforce 100 ms minimum sections and preserve source continuity when existing clips cross a boundary. Each drag is evaluated against its starting snapshot and records one undo entry on release. Escape, pointer cancellation, lost capture, window blur and leaving Composer cancel pending changes. Returning to the original boundary now preserves placements and asset bindings exactly. Section rows and folder controls update live without rebuilding the entire inspector on every pointer movement.

Validation: **40 Composer tests passed**, including empty layouts, unchanged-boundary preservation, locks/limits, transferred-category compatibility and source continuity. The **real Electron workflow passed** with actual divider drags under zoom and horizontal scroll, live time guides, no-op clicks, one-step undo/redo, Escape/pointer cancellation, keyboard limits, beat snapping/Alt bypass, locked handles and resizing populated sections without losing trims. Existing clip editing, audio sync, preview/export and six-axis handoff also passed. The updated screenshot uses synthetic media.


## Local HF links, readiness reasons and draft-assisted assembly — 21 September 2026

Scanning and HF sync now share local-video linking by Civitai ID plus duration, with file-stat checks. Scanning after sync updates HF entries immediately; moved matching videos relink and unavailable files lose ready status. HF categories, ratings and manual overrides remain on the variant. All published axes must match their SHA-256 descriptors before local sidecars are reused as that HF script variant. Otherwise scripts can be fetched separately, individually or in a cancellable batch for linked videos, without Civitai video calls or overwriting local sidecars. Folder roots and rescanning are exposed in the library. The folder dialog separates ready counts from missing links, unavailable local files, missing scripts and draft/rating exclusions.

Assembly now defaults to unique source videos across the song. Video identity joins Civitai IDs and shared local paths, so multiple script variants cannot disguise a repeat. Kept footage is reserved before selection and restricted pools get first choice. Optional cycle mode favors the least-used matching sources before reuse. Previously kept edits and manually split source continuations are preserved; the repeat policy controls new automatic selections.

If ordinary assembly fails, a read-only trial checks whether allowing drafts can fill the arrangement without changing categories, ratings, region lengths, locks or repeat rules. Only a successful trial offers draft inclusion. The dialog gives the unique draft-video count and any scripts-only downloads required; nothing is fetched before acceptance. Successful acceptance records draft consent and placements in one undo entry. Cancellation, download failure or a session changed during downloading cannot replace the recipe.

Validation: 46 Composer tests cover linking in either scan order, moved/missing/wrong-duration sources, complete-axis checksums, script-only fetches, independent exclusion reasons, unique source identities, kept clips, restricted pools, explicit reuse and draft proposal suitability. The Electron workflow exercises real dialog interaction, cancellation, acceptance, download failures, filter preservation and undo alongside the existing editing, playback and export flows. An offline scan into a disposable catalog matched all 130 current HF entries to local videos in the workstation library (261 video files scanned, no scan warnings or video downloads); the live application profile was not edited by that audit.
