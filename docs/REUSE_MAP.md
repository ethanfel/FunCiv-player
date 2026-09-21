# Reuse and integration research

This is the source-level companion to [the implementation plan](../PLAN.md). “Reuse” below means a verified function/class exists; it does not mean compatibility with the proposed Composer has been runtime-tested.

## Inspected versions

| Source | Inspected revision |
| --- | --- |
| `/media/p5/funsync-player` | `147a788f55ff762b126abcd63d11b52996bdf1ad`, package version `0.9.2` |
| `/media/p5/ComfyUI-Sam3D-to-Funscript` | `2b56e110ab382fbec5a5bb973669c4f02b9c3b7e` |
| Public `ethanfel/FunCiv-Data` | `2d1647699add22f33efc085e960090782a9237c9` |
| `/media/p5/ComfyUI-Song-timing` | README and interface inspected for optional lyric-marker import |

Local file links are for this machine. Record upstream provenance when copying modules into the future fork; line numbers may move after updates.

## Motion Studio: strongest reuse candidates

| Existing function/module | Verified behavior | Proposed use and adaptation |
| --- | --- | --- |
| [`decodeBeatAudio(file)`](/media/p5/ComfyUI-Sam3D-to-Funscript/assets/audio-analysis.mjs:39) | Browser decoding through `OfflineAudioContext`, mono samples at an analysis-oriented rate | Decode a song or supplied drum stem. In packaged workflow, feed the canonical audio asset to avoid independent decoder origins. |
| [`analyzeBeatAudio(samples, sampleRate, options)`](/media/p5/ComfyUI-Sam3D-to-Funscript/assets/audio-analysis.mjs:51) | Async analysis with progress/cancel hooks; waveform, BPM, confidence, beats, onsets, attacks; optional character features | Baseline analysis adapter. Move heavy work off the playback/UI path. It does not produce semantic verse/chorus labels. |
| [`beatGrid(audio, options)`](/media/p5/ComfyUI-Sam3D-to-Funscript/assets/audio-patterns.mjs:112) | Original timing plus accents, simplify and steady rhythm modes, density and low-band emphasis | Shared timing input for generated motion. A rhythm hit limit is not a physical speed limit. |
| [`generateBeatSection(audio, start, end, options)`](/media/p5/ComfyUI-Sam3D-to-Funscript/assets/audio-patterns.mjs:327) | Produces actions, timing events, shape decisions, settings and a summary for a range | Primary audio-to-motion generator. Preserve the returned reasoning/settings so a saved session can regenerate it. |
| [`BEAT_CATALOG`, `beatShapeValue()`](/media/p5/ComfyUI-Sam3D-to-Funscript/assets/audio-patterns.mjs:5) | Named shape families and sampling logic | Populate the advanced shape picker; avoid an unrelated new pattern catalog. |
| [`insertBeatSection(actions, section, blendMs)`](/media/p5/ComfyUI-Sam3D-to-Funscript/assets/audio-patterns.mjs:421) | Inserts a section with optional edge blending and point reduction | Place audio-generated motion into the song curve after assigning the correct song-time range. |
| [`sliceBeatSection()`, `savedBeatSelection()`, `editBeatSections()`](/media/p5/ComfyUI-Sam3D-to-Funscript/assets/audio-patterns.mjs:450) | Range selection/editing of saved audio blocks | Adapt for block replacement and preserving unaffected ranges. |
| [`assignBeatSounds()`, `renderBeatClicks()`, `beatClicksWav()`](/media/p5/ComfyUI-Sam3D-to-Funscript/assets/audio-patterns.mjs:237) | Percussion assignment, rhythm audition and WAV generation | Optional “hear rhythm” preview for assessing motion timing separately from source audio. |
| [`evaluate()`, `validateReference()`, `reduceActions()`](/media/p5/ComfyUI-Sam3D-to-Funscript/assets/curve.mjs:10) | Curve evaluation/validation and simplification with protected timestamps | Shared compiler primitives. Add FunCiv's source-time mapping and whole-session invariants around them. |
| [`spliceActions(main, source, start, end, method, blendMs, protectedTimes)`](/media/p5/ComfyUI-Sam3D-to-Funscript/assets/timeline.mjs:313) | Same-clock cut/blend with boundary protection and adaptive intermediate samples | Most useful joining primitive. Remap source curves before calling it; inspect its one-millisecond cut guards when clipping final output. |
| [`copyTrackToMain()`, `applyTrack()`](/media/p5/ComfyUI-Sam3D-to-Funscript/assets/timeline.mjs:345) | Applies project tracks to Main with coverage and lock semantics | Reference behavior for multi-axis transfers. These functions expect a Motion Studio project, so do not call them on the new recipe shape directly. |
| [`combine_projects(inputs)`](/media/p5/ComfyUI-Sam3D-to-Funscript/sam3d_funscript/timeline.py:34) | Combines anchor projects from one original video and explicitly rejects differing source-video identities | Confirms that assembling different videos along a song is new work, even though motion-section joining is already reusable. |
| [`motionSections()`, `sectionAt()`](/media/p5/ComfyUI-Sam3D-to-Funscript/assets/timeline.mjs:402) | Derives/query sections from source ranges | Useful for presenting source motion ranges. Song sections still need their own model. |
| [`frameClock(data)`](/media/p5/ComfyUI-Sam3D-to-Funscript/assets/frame-clock.mjs:4) | Source presentation-frame lookup, snapping, stepping and ticks from supplied frame timestamps | Source trimming/stepping, including variable frame rate. It is not the master playback clock. |
| [`analyseStroke()`, `limitStroke()`](/media/p5/ComfyUI-Sam3D-to-Funscript/assets/device-output.mjs:46) | Physical-distance/speed analysis and bounded curve transformation | Diagnostics and optional device-specific export. Coordinate with FunSync so limits are not applied twice. |
| [`buildDeviceOutput()`, `deviceOutputFiles()`](/media/p5/ComfyUI-Sam3D-to-Funscript/assets/device-output.mjs:83) | Derives device-oriented outputs from a Motion Studio project | Reference profiles and export conventions; use an adapter instead of making Composer imitate the entire project schema. |
| [`editorSession()`](/media/p5/ComfyUI-Sam3D-to-Funscript/assets/editor-session.mjs:65) | Connected-editor save/recovery coordination | Reuse its conflict-handling ideas. FunCiv sessions require separate endpoints and schema. |
| [`EditorStore.save(session, project, revision)`](/media/p5/ComfyUI-Sam3D-to-Funscript/sam3d_funscript/editor.py:351) | Validates project; rejects stale revisions; increments revision on save | Required contract when round-tripping to an existing Motion Studio editor. Never bypass by overwriting its JSON. |
| [`extract_video_audio(source, directory)`](/media/p5/ComfyUI-Sam3D-to-Funscript/sam3d_funscript/video_audio.py:11) | Cached audio extraction from source video | Reference for audio preview jobs and timestamp origins. Song canonicalization needs its own asset contract. |

The smallest useful vendored JavaScript group is `audio-analysis.mjs`, `audio-patterns.mjs`, `patterns.mjs`, `curve.mjs`, and selected timeline joining helpers. `audio-patterns` imports `curve` and `patterns`; `timeline` imports `curve`. Prefer named extraction or pinned whole pure modules with adaptation tests over copying snippets without their dependencies.

The analysis return shape currently has `version: 4`, `duration_ms`, `waveform`, `bpm`, `confidence`, `beats`, `onsets`, `attacks`, and optional `timbres` or `features`. Treat this as a versioned upstream adapter input. Do not assume its `confidence` measures semantic section correctness.

## Motion Studio: library and network integration

| Existing function/module | Useful behavior | Boundary |
| --- | --- | --- |
| [`encoded_video_id()`](/media/p5/ComfyUI-Sam3D-to-Funscript/sam3d_funscript/public_dataset.py:20) | Canonical numeric ID validation and SHA-256 index key | Implement the public lookup contract in the dataset client; retain conformance fixtures. |
| [`clean_script()`, `validate_snapshot()`](/media/p5/ComfyUI-Sam3D-to-Funscript/sam3d_funscript/public_dataset.py:31) | Action/schema validation and managed-file checksum validation | Reference for importer validation. Export/publish operations are not necessary for the player. |
| [`video_id()`, `media_url()`, `download_urls()`](/media/p5/ComfyUI-Sam3D-to-Funscript/sam3d_funscript/civitai_library.py:31) | Validated IDs, permitted media hosts, full-size/original URL choices | Reuse in an isolated Civitai adapter after separating FolderStore dependencies. |
| [`CheckedRedirects`, `open_remote()`, `fetch_json()`](/media/p5/ComfyUI-Sam3D-to-Funscript/sam3d_funscript/civitai_library.py:87) | Controls API/media redirects, token use and remote responses | Preserve credential separation and explicit redirect handling. |
| [`transfer_video()`, `video_extension()`](/media/p5/ComfyUI-Sam3D-to-Funscript/sam3d_funscript/civitai_library.py:116) | Bounded download and container recognition | Add FunCiv-owned job cancellation, cache promotion and binding validation. |
| [`CivitaiLibrary.catalogue()`](/media/p5/ComfyUI-Sam3D-to-Funscript/sam3d_funscript/civitai_library.py:207) | Joins local copies, category information and saved download/review state | Connected read adapter, or reference for initial local import. It expects a registered FolderStore. |
| [`CivitaiLibrary.query()`, `.record()`, `.browse()`](/media/p5/ComfyUI-Sam3D-to-Funscript/sam3d_funscript/civitai_library.py:248) | Builds API queries and normalizes video results | Good transport reference; do not assume metadata includes FunCiv's desired category taxonomy. |
| [`CivitaiLibrary.download()`](/media/p5/ComfyUI-Sam3D-to-Funscript/sam3d_funscript/civitai_library.py:282) | Existing-file reuse plus node-specific staged review downloads | Do not call for ordinary player caching without understanding its ownership/review side effects. |

Verified current route families in [routes.py](/media/p5/ComfyUI-Sam3D-to-Funscript/routes.py):

| Route | Current use |
| --- | --- |
| `GET /sam3d_funscript/civitai/{folder}` | Registered folder's Civitai/local catalog |
| `GET /sam3d_funscript/civitai/{folder}/local/{clip}` | Source video access |
| `POST /sam3d_funscript/civitai/{folder}/{action}` | Browse, category, ignore, key, queue and download actions |
| `GET /sam3d_funscript/folders/{folder}` | Scan/read known folder |
| `POST /sam3d_funscript/folders/{folder}/{action}` | Source review and queue operations |
| `GET/POST /sam3d_funscript/editors/{session}` | Read/write connected motion editor state |
| `GET/POST /sam3d_funscript/timelines/{session}` | Processing timeline state |
| `GET /sam3d_funscript/timelines/{session}/frames` | Source frame timestamps |
| `GET /sam3d_funscript/video/{project}/audio` | Extracted source audio preview |

There is no generic FunCiv composition endpoint in this route list. The plan's capability/library-discovery handshake and session compiler are new work. Existing route error/revision shapes should be captured in contract fixtures before integration.

## FunSync: reuse the player, not just its Python server

| Existing component | Integration value | Adaptation / caveat |
| --- | --- | --- |
| [`NavBar`](/media/p5/funsync-player/renderer/components/nav-bar.js:7) | Existing top navigation and localization | Add Composer item and view route. |
| [`app.js` engine construction](/media/p5/funsync-player/renderer/js/app.js:740) | Instantiates device managers and synchronization engines | Small dependency/source-binding seam; avoid duplicating all initialization in a new app. |
| [`loadVideo()`](/media/p5/funsync-player/renderer/js/app.js:4527) | Existing ordinary-video lifecycle | Reference for preparing a rendered session; loading each tiny clip through it would repeatedly reset script/session state. |
| [`loadFunscript()`](/media/p5/funsync-player/renderer/js/app.js:4892) | Coordinates script parsing, multi-axis feeding, UI and device upload | Its current-video assumptions require extraction of a lower-level prepared-session path. |
| [`FunscriptEngine.loadContent()`](/media/p5/funsync-player/renderer/js/funscript-engine.js:119) | Parses script and exposes actions/heatmap data; delegates CSV conversion to preload | Works with compiled JSON, but is not entirely environment-free because it uses `window.funsync`. |
| [`RemotePlaybackProxy`](/media/p5/funsync-player/renderer/js/remote-playback-proxy.js:17) | Player-shaped interface and playback events | Strong reference for Composer's adapter; local audio supplies time instead of remote extrapolation. |
| [`SyncEngine`](/media/p5/funsync-player/renderer/js/sync-engine.js:3) | Handy prepared-script synchronization, seek and play/pause race handling | Bind once to the song clock and one complete snapshot. |
| [`ButtplugSync`](/media/p5/funsync-player/renderer/js/buttplug-sync.js:38) | Device scheduling, action reload and axis handling | Preserve its scheduler/output stack; add source integration, not a parallel scheduler. |
| [`TCodeSync`](/media/p5/funsync-player/renderer/js/tcode-sync.js:44) | Multi-axis timed output, offsets, ranges and generated secondary-axis support | Feed compiled axes with explicit policies for missing axes. |
| [`HandyHdspSync`](/media/p5/funsync-player/renderer/js/handy-hdsp-sync.js:60) | Alternate polled motion path used for playback-rate changes | Useful existing capability, not proof of seamless arbitrary live script streaming. |
| [`SessionTracker`](/media/p5/funsync-player/renderer/js/session-tracker.js:38) | Session ownership/status/history | Add Composer as a first-class source and audit assumptions about source names. |
| [`applyDeviceStack()` and related transforms](/media/p5/funsync-player/renderer/js/device-transform-stack.js:168) | Device range, invert, cutoff and scalar-limit logic | Keep output settings centralized. Retain a distinction between canonical and transformed curves. |
| [`EditableScript`](/media/p5/funsync-player/renderer/js/editable-script.js:5) | Action editing, selection, metadata and history | Use for detailed curve edits; session-level undo needs a separate command history. |
| [`interpolation.js`](/media/p5/funsync-player/renderer/js/interpolation.js:13) | Interval lookup, linear/step/PCHIP/Makima interpolation and speed limiting | Preserve existing runtime choices; define how preview/export reflect each transform. |
| [`detectGaps()`, `fillGap()`](/media/p5/funsync-player/renderer/js/gap-filler.js:12) | Temporal action-gap detection and pattern filling | Useful manual diagnostic. Sparse actions/flat motion are not evidence of failed tracking. |
| [`detectBeats()`, `beatsToActions()`](/media/p5/funsync-player/renderer/js/beat-detector.js:34) | Existing simpler beat pipeline | Keep as a fallback/legacy feature; select one Composer analysis pipeline to prevent inconsistent grids. |
| [`waveform.js`](/media/p5/funsync-player/renderer/js/waveform.js) | Existing waveform caches and band filtering | Alternative to a new waveform dependency; benchmark redraw/zoom needs first. |

### Why the stock remote API is insufficient on its own

The Python WebSocket relay enriches a remote `videoId` with a path from the media registry. The desktop then looks up that path in `library._videosByPath` and loads the associated local script. An arbitrary generated session is not automatically accepted by that flow. See [remote synchronization routes](/media/p5/funsync-player/backend/routes/remote_sync.py:104) and [desktop remote connection handling](/media/p5/funsync-player/renderer/js/app.js:2452).

Also, [`POST /api/media/register`](/media/p5/funsync-player/backend/routes/media.py:605) replaces the supplied registry/groupings; it is not an append-one-temporary-session endpoint. A companion must not overwrite the stock library snapshot to inject its own item. The fork can instead add a dedicated, scoped session registry and source-binding operation.

### Fork lifecycle changes that should come first

- [Backend launcher](/media/p5/funsync-player/electron/python-bridge.js:50): replace port-wide process termination with tracked-child ownership and configurable port discovery.
- [Build identity and publish destination](/media/p5/funsync-player/electron-builder.yml:1): separate app ID/name/output identity; the present publish target points at the original author/repository.
- [Updater](/media/p5/funsync-player/electron/auto-updater.js): disable original feed until the fork has a release source.
- [Preload API](/media/p5/funsync-player/electron/preload.js): extend narrow typed operations, not unrestricted I/O.
- [Theme tokens](/media/p5/funsync-player/renderer/styles/player.css) and [modern layer](/media/p5/funsync-player/renderer/styles/modern.css): reuse styling conventions.

## UI and analysis dependency choices

| Candidate | Research result | Recommendation |
| --- | --- | --- |
| Existing Canvas/timeline modules | Already match both local projects' rendering model | First choice for synchronized multi-lane timeline and curve editing |
| WaveSurfer | Has waveform rendering plus region/timeline/zoom plugins | Optional waveform widget; do not make its region objects the project database. [Documentation](https://wavesurfer.xyz/docs/) |
| WaveSurfer precomputed peaks | Supports separate peaks and known duration, avoiding repeated full decode for display | Use only if it improves the prototype over the existing waveform code. [Precomputed peaks](https://wavesurfer.xyz/docs/peaks/) |
| `allin1` | Joint musical timing and structure labeling, with heavier inference dependencies | Optional sidecar after a compatibility benchmark. [Project](https://github.com/mir-aidj/all-in-one) |
| librosa segmentation | Temporally constrained feature clustering | Useful lower-dependency boundary suggestions, without semantic-label claims. [API](https://librosa.org/doc/0.11.0/generated/librosa.segment.agglomerative.html) |
| Existing Song Timing | Aligns supplied lyric text and returns section-aware segments | Optional marker import. [Local README](/media/p5/ComfyUI-Song-timing/README.md) |
| FFmpeg | Required media probing/normalization/rendering building blocks | Native process jobs; avoid shipping a second browser/WASM rendering pipeline initially. [Filter reference](https://ffmpeg.org/ffmpeg-filters.html) |

The Composer should remain a native-module view in the current Electron UI. React or another framework is possible later, but does not solve the important new problems: temporal mapping, snapshot consistency and source ownership.

## Existing tests worth retaining or adapting

Motion Studio has relevant suites for [curve math](/media/p5/ComfyUI-Sam3D-to-Funscript/tests/test_curve.mjs), [timeline joining](/media/p5/ComfyUI-Sam3D-to-Funscript/tests/test_timeline.mjs), [audio patterns](/media/p5/ComfyUI-Sam3D-to-Funscript/tests/test_audio_patterns.mjs), [audio rhythm](/media/p5/ComfyUI-Sam3D-to-Funscript/tests/test_audio_rhythm.mjs), [device output](/media/p5/ComfyUI-Sam3D-to-Funscript/tests/test_device_output.mjs), [public dataset](/media/p5/ComfyUI-Sam3D-to-Funscript/tests/test_public_dataset.py) and [Civitai downloads](/media/p5/ComfyUI-Sam3D-to-Funscript/tests/test_civitai_library.py).

FunSync already uses Vitest and Playwright, plus backend pytest. Preserve affected upstream suites and add focused checks for the new source adapter, rate/trim mapping, immutable snapshot swaps and fork process coexistence. This planning task did not run those suites or claim they pass.

## Research outcome

Most primitive motion operations and device integration already exist. The main new code is a song-centered project model, category-aware arrangement, exact video/script binding, source-time mapping, a composition playback source, and an export/cache lifecycle. These should be the center of implementation effort.
