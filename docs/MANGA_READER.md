# Animated manga reader

Open **Manga → Open H3 project…** and select the project directory containing `project.json`. For this workstation, select `/media/unraid/davinci/H3-Animator/Now_Living_project/`. ComfyUI does not need to be running. The reader does not modify the source project.

The importer follows active page layouts and H3's saved joined-panel order in `flf_sequence.json`. A joined clip replaces its two endpoints at the opening panel's position, including joins across pages. Only takes for that exact saved pair appear in its take selector: H3's main take is preferred, otherwise the latest completed matching take is used. An old reader take choice cannot select an unrelated video. If the active pair has no completed video, the reader shows still artwork and explains why in Settings & details. It measures selected videos with FFprobe and keeps pages without animations readable.

Use **Refresh** after pairing, choosing a different saved pair, unpairing, or changing H3's main take. Unpairing restores individual panels and excludes archived joined takes. Original pages stay available for manual reading; autoplay and prefetch skip pages whose panels are entirely consumed by joins. Portable books and updates preserve these choices. Existing portable books exported before this fix need a fresh export or update from the linked H3 project.

## Reading and playback

Click a panel to focus it. **Back to page** returns to its page; **Animate in page** places the animation inside the panel boundary. Original panel polygons and the render's content box align in-page playback. Single-page and continuous-scroll layouts, page jumps, thumbnails, bookmarks, fit/zoom, and fullscreen are available. Upcoming panels and the next page are prepared in the background; one upcoming video is decoded silently while the current one plays. The reader looks past loops and still segments when preloading. Page autoplay transitions directly to the first panel, holding the outgoing picture until the next frame is ready and then fading for 180 ms. Reduced-motion preferences disable the fade. At higher zoom, drag the page to pan, or use the middle mouse button.

**Bubbles** switches transparent overlays without restarting clean videos. Animator bubble timing is honored automatically: each bubble uses its saved In/Out frames, hidden tracks remain hidden, and Fade, Pop and directional Slide entrance/exit effects are preserved. Enable **Ignore bubble timing** beside **Bubbles** to show all enabled bubble layers throughout the animation, without entrance/exit effects. This preference is remembered per book and included in portable exports; changing it applies immediately without interrupting playback or prepared device sync. The Bubbles toggle still hides all overlays. Repaired bubble artwork and older first/last-frame overlay switches are supported. **Refresh** imports edits saved in Animator’s Bubble timeline; applying/re-encoding the bubbles-on video is not required. Saved timing takes priority over the last applied render. Seeking restores the correct bubbles immediately, loops repeat their timing, and motion extension holds the bubbles at the frozen video frame. This affects animated panel playback; the original full manga pages keep their printed lettering. If only separate video variants exist, the reader preserves position while loading the other variant. Clean still artwork is used where available; the reader cannot remove text baked into an original image without a clean asset.

Transport controls support seeking forward and backward. Space toggles play/pause when focus is outside form controls; F toggles fullscreen, B toggles bubbles, and Escape closes settings or returns to the page. Reading position and preferences are saved locally and restored paused.

**Autoplay** selects this page, across pages, or manual advancement. **Read before playing** holds a panel before its first animation pass.

Still panels and pages without detected panels have a visible reading countdown. In **Settings & details → Still reading time (seconds)**, choose the duration (default **10 seconds**); **0** waits indefinitely for Next. Individual still panels can override the book duration. Press Play to start or resume the countdown; Pause/Stop and seeking also work. **Across pages** autoplay continues through consecutive still pages, while **This page** stops at each page boundary and **Manual** waits after each panel. Next can advance immediately, including at a page boundary. Still reading never plays leftover video audio or device motion. Timer settings and paused reading position are saved and travel with portable books as appropriate.

## Extra reading time

**While reading** has four choices:

- **Continue normally:** play once and follow the autoplay setting.
- **Pause to read:** hold the last image with motion stopped.
- **Loop panel:** repeat the video and its matching script. Audio plays only on the first pass unless repeated audio is enabled.
- **Extend motion:** hold the image and repeat a phrase from the approved script. Its action spacing, shape, and axis phase are preserved rather than replacing the motion with a uniform beat.

Settings & details provides the extra-time budget, automatic/manual advancement after that budget, per-panel overrides, and a manual motion phrase range. Automatic phrase selection requires repeated complete cycles; unsuitable motion asks for a manual range or another reading mode. Unscripted panels never inherit motion from another panel.

Budgets are rounded to complete repetitions. When extending motion, **Next panel** finishes the current phrase before advancing. **Stop** requests a stop immediately. The reader pauses when a manual reading budget ends; it does not run beyond the uploaded script. Source scripts remain untouched.

Panel volume gain and optional short audio fades do not change motion timing. **Suggest audio level** measures the selected take and offers a gain adjustment; applying it is explicit. **Read earlier/later** changes guided reading order locally.

## Motion and devices

Approved Sam3D scripts are read beside the selected take's video: `video_clean.funscript` with optional `.surge`, `.sway`, `.twist`, `.roll`, and `.pitch` axis suffixes. Video-stem matching keeps takes distinct. Processing exclusions do not remove manga pages, and ComfyUI editor drafts are not imported automatically.

Connect through **Devices**, choose **Prepare device sync**, then press **Play**. The reader prepares one page, including its finite reading extensions, and uses FunSync's existing transports. No movie export is needed. Changing the selected take, script, reading order, or motion settings requires preparation again. Bubble toggles and zoom do not.

Playback pauses device output during buffering, seeks, unscripted panels, reading holds, and source takeover. Prepared media are cached and script contents are fixed for that run. Background checks announce changed H3 media, bubble timing and scripts; **Refresh** applies them explicitly.

Device-session ownership and clock behavior are covered by software tests. Physical Handy playback has not been verified in this implementation session.

## Portable books and updates

**Export book…** creates a `.fcmanga` ZIP64 reader edition containing pages, selected animations, bubble assets and timings, available scripts, and presentation settings. Timed-bubble packages require a reader supporting this feature; older readers reject them instead of displaying incorrect lettering. Clean video plus overlay preserves both bubble views without storing a second encode by default. Settings can retain both original encodes or alternate takes.

Open the package directly on another installation. Assets are extracted on demand and validated against their hashes. Cache maintenance keeps unused assets within a 4 GiB target after operations; the current and upcoming prepared pages stay pinned. Preparing an upcoming page cannot evict current playback assets; a prepared page is reused when advancing. Only two video decoders are used, and artwork preloading is bounded. **Clear unused playback cache** removes unpinned cached files. Export can temporarily need additional disk space while collecting a consistent edition.

**Export small update…** selects a previous full package as its base and writes only changed assets plus new metadata to `.fcmanga-update`. Open that base package, then choose **Apply update…**. Updates require the exact base edition. **Roll back last update** restores the previous version; applied updates are reopened with the book. An alternative update targeting the original base requires rolling back the current update first.

Packages are reader editions. Preserve the H3 project and ComfyUI output store separately for editable workflows, generation history, and unapproved drafts.

## Verification

Run `npm run test:manga` for importer, archive, motion, and clock tests. Run `npm run test:manga:ui` in a desktop session for the disposable Electron workflow. Fixtures contain synthetic artwork/audio/video and do not use devices or account credentials.

The original design and implementation stages remain in [the plan](ANIMATED_MANGA_PLAN.md).
