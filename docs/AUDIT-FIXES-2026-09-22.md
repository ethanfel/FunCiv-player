**Audit fixes — 22 September 2026**

All nine confirmed findings in [the audit](AUDIT-2026-09-22.md) have been corrected in the working tree. The changes preserve draft opt-in, minimum ratings, category choices, kept placements and explicit repeat settings.

| Finding | Result | Regression coverage |
| --- | --- | --- |
| A: Save overwrites later edits | Save requests capture separate snapshots and execute in order. Responses update revision bookkeeping while preserving newer edits or another opened session. Failed requests leave the editor dirty and do not block later saves. | Four renderer regressions, plus a real Electron edit during Save. |
| B: False unique-footage shortage | Fixed cuts use augmenting-path matching across source-video identities. Automatic clip lengths use duration-aware backtracking, with exact matching when the remaining requests fit single videos. Approved variants receive preference; locked footage is reserved first. | Overlapping pools across seeds, mixed fixed/automatic cuts, shared identities, kept clips, draft preferences, and 240 cases compared with an independent exhaustive feasibility oracle. |
| C: Accepted draft offer is rearranged | Acceptance validates and commits the exact offered placements after fetching their scripts. Changed files, variants, categories, readiness or applicable filters reject the stale offer. Consent and placements still share one undo step. | Exact-plan acceptance and changed-asset cases; Electron consent, cancellation, download failure recovery and undo. |
| D: HF updates invalidate unchanged assets | Script cache reuse follows axis checksums. Version 2 recipe bindings identify script content independently of repository commit. Removed variants remain as retired records with their original commit and cached scripts, usable by saved/open recipes and excluded from new selection pools. | Metadata-only refresh, legacy/v2 bindings, restart, retirement/reappearance, historical script fetching, and rejection of genuinely changed scripts. |
| E: Cached fallback becomes unavailable | Adopting a downloaded copy clears its old local ID and records its cache source. Relinking also repairs stale local IDs left by older builds when the cached file still validates. | Local deletion → Resolve → relink → offline root rescan, using real files and mocked media delivery. |
| F: Offline root appears ready | Failed rescans mark that root's native records unavailable and persist root status. The library displays offline folders with reconnect/rescan guidance. Successful rescans restore readiness and preserve ratings/categories. | Missing folder, permission error, recovery, local/HF readiness and metadata retention. |
| G: Offline recipe cannot save | Save validates recipe structure and retains known asset bindings without requiring online media. Unresolved references remain editable and saveable. Preview/export still validate files and reject missing or changed assets. | Saving offline edits, saving before resolution, missing clip references, changed-script pins and captured service input. |
| H: Escape misses source drag | Region/source dragging handles Escape at window capture level, plus blur, pointer cancellation and lost pointer capture. Cancelling restores the original recipe and adds no undo entry. | Four event paths in DOM tests and actual focus loss/Escape in Electron. |
| I: Locale parity failures | Added the missing Composer navigation/source keys to all seven affected locales. Ordinary Composer PR checks now also run the general unit suite. | All 183 unit-test files pass. |

**Verification**

- `npm run test:composer`: **62 passed**, including real FFmpeg output and mixed-resolution 1080×1920 export checks.
- `npm test -- --reporter=dot`: **3,839 passed across 183 files**, no failures.
- `npm run test:composer:ui`: **passed**, including the new save/drag regressions, song playback, timeline navigation, filters, draft workflows, portrait export and six-axis FunSync handoff.
- `node scripts/audit-composer.mjs`: all eight functional scenarios now report **`reproduced: false`**.
- `git diff --check`: passed.

The regression suites are [assembly-regressions.test.mjs](../tests/composer/assembly-regressions.test.mjs), [asset-lifecycle.test.mjs](../tests/composer/asset-lifecycle.test.mjs) and [editor-regressions.test.mjs](../tests/composer/editor-regressions.test.mjs). Electron checks are in [editor-regressions-ui.mjs](../tests/composer/editor-regressions-ui.mjs). Smoke screenshots now go into the disposable test directory by default; `FUNCIV_SMOKE_SCREENSHOTS` can select a retained output directory. Linux smoke runs explicitly use X11.

**Compatibility and limits**

Existing recipes remain readable. Legacy bindings retain their script-content and file-stat checks while allowing an unrelated HF commit to advance. New saves use version 2 bindings; saving a recipe with existing bindings preserves those pins. Intentional reassembly still adopts current assets. Retired HF records keep their original review status, so draft consent remains required.

Retirement retention applies to variants still known to this catalog; it cannot reconstruct records already discarded by older versions. Local video bytes are not copied or archived. Restoring a file with different stats or changing a script still requires reviewing and adopting the updated asset. Retired metadata/script records currently have no automatic eviction policy.

Automatic-length assembly has a deterministic work budget. If exhausted, it reports `ASSEMBLY_SEARCH_LIMIT` with guidance, leaves the recipe untouched, and does not claim that a valid arrangement is impossible. Fixed-cut matching and backtracking do not silently enable repeats or relax filters.

Validation used disposable profiles and synthetic files; HF/Civitai failure cases were mocked. No physical-device timing, live authenticated downloads or cross-platform packaging checks were performed. Separate main/beat tracks, automatic verse detection, autosave and broader Composer localization remain feature improvements outside these nine bug fixes.
