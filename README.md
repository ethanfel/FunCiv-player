# FunCiv Player

Compose a session from **a song → sections → categories → video clips and synchronized motion**. Preview the assembled timeline live or render a disposable MP4 with six matching funscripts.

This is an early working fork of [FunSync Player](https://github.com/DaveMakesWaves/funsync-player). It adds a **Composer** workspace and reuses the player, device transports, and selected audio/curve algorithms from [ComfyUI-Sam3D-to-Funscript](https://github.com/ethanfel/ComfyUI-Sam3D-to-Funscript). The original Library, Playlists, Categories, and video player remain available.

![Composer with synthetic test media](docs/composer-implemented.png)

## Run locally

Requires Node.js 22.15+ (tested with 24), Python 3.10+, FFmpeg and FFprobe on `PATH`, and a desktop environment for Electron. On this workstation, dependencies have already been installed in this checkout.

```bash
cd /media/p5/FunCiv-player
npm start
```

For a fresh checkout:

```bash
npm ci
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
npm start
```

On Windows, use `backend\.venv\Scripts\python.exe` for the Python commands. `FUNCIV_PYTHON` can select a different interpreter. If your npm policy suppresses Electron's install script, run `node node_modules/electron/install.js` once after `npm ci`.

FunCiv uses its own `funciv-player` application data directory. It starts its backend on loopback port 5124, choosing an available port if occupied. It does not terminate another application's server or import your existing FunSync settings. `FUNCIV_USER_DATA` overrides the data directory for development. Automatic binary updates are disabled until this fork has a tested release feed.

## Make a session

1. Open **Composer**, then **Load song**. Audio is converted once to a cached stereo 48 kHz WAV. Recent imported songs are reusable.
2. Click **＋ Folder** and choose the folder containing your downloaded clips. For your ComfyUI installation under `/media/p5/ComfyUI-Sam3D-to-Funscript`, choose the actual video library/output folder configured in its Folder node. Subfolders become initial categories. Change a clip's category directly in the library.
3. Click **Analyze song** for an energy waveform and estimated BPM. Sessions start with six equal sections; rename them, change an end time, or click the waveform and use **Split at playhead** / **Merge next**.
4. Select each section and choose its category and motion policy:
   - **Clip motion:** use the clip's existing script.
   - **Follow song:** generate L0 motion from the song's tempo and energy, including when the clip has no script.
   - **Clip + marked gaps:** replace only the ranges you explicitly mark with song motion.
   - **Neutral hold:** keep all axes at their neutral position.
5. Click **Assemble**. **New variation** changes unlocked choices; **Keep clips on variation** retains a section's placements. Click a clip on the timeline to replace it or adjust its source start and speed. Invalid source ranges are rejected.
6. **Prepare preview**, then **Play**. The song is the master clock; two muted video decoders prepare consecutive cuts. A decoder stall pauses the audio clock. Editing pauses playback and invalidates its prepared snapshot. Undo/redo is available.
7. **Save session** keeps the recipe, song analysis, and asset bindings. Reopening a saved recipe rejects changed media/scripts until you deliberately reassemble.

Adjacent scripts use the same stem as the video: `clip.funscript` (L0), `clip.surge.funscript` (L1), `clip.sway.funscript` (L2), `clip.twist.funscript` (R0), `clip.roll.funscript` (R1), and `clip.pitch.funscript` (R2). Missing secondary axes stay neutral. Hidden folders and symlinks are excluded from recursive scans; ComfyUI's hidden review staging can be selected explicitly as a folder if needed.

## FunCiv Data and Civitai

**Sync FunCiv Data** imports the public [dataset catalog](https://huggingface.co/datasets/ethanfel/FunCiv-Data). The client pins a full repository commit and verifies the catalog and requested scripts against their SHA-256 values. It does not download the whole video library.

Use **API settings** to choose `civitai.com`, `civitai.red`, or `civitaired.com`. An optional API key is stored with Electron's system credential encryption; unsupported plaintext storage is rejected. Alternatively set `CIVITAI_API_TOKEN` in the launching environment. The key is used for the metadata API and is not forwarded to media downloads or redirected endpoints.

Click **Resolve video + scripts** on a variant to fetch its verified axes. An indexed local video with a matching Civitai ID is reused when its duration is compatible. Otherwise the selected video is fetched through Civitai's API into FunCiv's cache. Compatibility is checked by duration; this is not proof that two videos contain identical frames. API account, site, or regional restrictions can make a clip unavailable.

Draft scripts are excluded until **Include draft scripts** is enabled. Categories are local editorial tags; the dataset currently does not provide a category taxonomy. Refreshing the catalog does not silently substitute a changed asset in a saved recipe.

## Playback, devices, and temporary video

Preview defaults to devices off. Connect a device through FunSync's **Devices** panel, then click **Prepare device sync** in Composer. The adapter reuses the configured Handy, Buttplug, TCode, or Autoblow transports. Compiled secondary axes feed the multi-axis engines. Stop, editing, leaving Composer, or a VR/Web Remote source takeover releases the Composer binding. Cloud uploads are serialized to prevent an older pending upload from replacing a newer source's script.

**Render temporary video** creates a 1280×720, 30 fps H.264/AAC MP4, six same-stem scripts, and a provenance/checksum manifest. Preview and export use the same motion compiler and source-time mapping. Frame cuts are quantized to 30 fps; script times are integer milliseconds. **Play in FunSync** opens the result paused in the existing player with its axes. **Open export folder** exposes the files; **Delete render** removes that owned export while retaining your recipe and source clips. Downloads and audio caches are retained; there is no automatic disk quota yet.

## Current limits and next work

This first version provides an editable composition workflow. Automatic verse/chorus recognition, weighted category pools, beat-aware clip scoring, interactive curve editing, automatic motion-gap detection, rendered transitions, and GPU motion extraction jobs are future work. Song motion currently uses an energy-following sine pattern on a tempo grid. Video uses hard cuts with configurable motion blending.

Motion Studio's algorithms are vendored with provenance; the live ComfyUI graph/editor is not embedded or called. This version does not continuously rewrite device scripts during playback: edits produce a new prepared snapshot. Direct local preview uses browser-supported video formats; FFmpeg export can normalize sources that Chromium cannot decode. The inherited LAN remote features are not enabled by the loopback-only backend binding.

Real hardware and authenticated Civitai video downloads still need field testing. Automated device tests use mocks; UI and export tests use synthetic media only. A signed installer/release has not been produced.

## Tests and design

```bash
npm run test:composer       # compiler, storage, provenance, transport races, port ownership, FFmpeg
npm run test:composer:ui    # real Electron window; requires a desktop display
npm test                   # inherited FunSync unit suite
```

The UI test creates a disposable profile and synthetic clips, analyzes a song, crosses clip boundaries, seeks while paused, saves a recipe, compiles song motion, renders an MP4, and opens it in FunSync with all axes. It also updates the screenshot above. It uses no account credentials or physical devices.

- [Detailed roadmap](PLAN.md)
- [Integration research and reusable functions](docs/REUSE_MAP.md)
- [Original interactive UI study](docs/composer-ui.html)
- [Motion Studio provenance and license](vendor/motion-studio/README.md)

GPL-3.0-or-later; upstream attribution and history are retained. See [LICENSE](LICENSE).
