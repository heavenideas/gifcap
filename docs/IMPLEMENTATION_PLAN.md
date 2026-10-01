# gifcap fork: implementation plan

Living checklist for the features added in this fork. Any agent (or human) can pick up the
next unticked item, do it, verify it, and tick it off.

## Ground rules (read before touching anything)

1. **Local-only processing is non-negotiable.** No feature may add a network request. Recording
   pixels, video, and GIFs must never leave the browser. Everything is `canvas`, Web Workers,
   WASM, `MediaRecorder`, and `blob:` URLs. If a change needs a server, it is out of scope.
2. **YAGNI.** Build exactly what a milestone says. No presets, no settings persistence, no live
   size estimates, no audio, unless a milestone explicitly asks for it.
3. **Defaults reproduce today's behaviour.** With all new settings at their defaults, the GIF
   output must match upstream gifcap (same dimensions, FPS, colours, lossiness).
4. **Performance.** Nothing new on the main thread beyond one canvas draw per frame. New
   settings may only make rendering faster or keep it the same.
5. **Match the surrounding code.** TypeScript + Mithril, Prettier `printWidth: 120`, same idioms
   as `src/views/*.ts`. Don't add dependencies unless a milestone allows it.
6. **Ticking off.** Tick a box (`- [x]`) in the **same commit** as the work it describes. A box
   whose check could not actually be performed (for example, the manual browser test couldn't run in
   your environment) stays unticked and gets a note in the [Progress log](#progress-log)
   saying `needs human verification` and why. Never tick an unverified box.
7. **One milestone per branch/PR** where practical. Commit messages: `M<n>: <what>`.

## Codebase orientation

| Path | Role |
|---|---|
| `src/main.ts` | App state machine (`start → recording → previewing → rendering → playing`). `FPS = 12`. |
| `src/gifcap.d.ts` | Shared types: `Frame`, `Recording`, `RenderOptions`, `Gif`, `App`. |
| `src/views/record.ts` | Captures `getDisplayMedia` stream; a worker ticker (`dist/ticker.js`) triggers `drawImage` + `getImageData` every `frameLength` ms. Stores raw RGBA frames. |
| `src/views/preview.ts` | Trim bar + drag-to-crop; produces `RenderOptions { trim, crop }`; action bar with Render/Discard. |
| `src/views/render.ts` | Crops each frame on a canvas, feeds `GifEncoder.addFrame(imageData, delay)`. |
| `src/views/play.ts` | Shows the finished GIF, size, Download/Edit/Discard. |
| `encoder/gifencoder.js` | Main-thread orchestrator: frame diffing, dedupe, dispatch to workers. Loaded via `<script>` in `index.html`. |
| `encoder/quantizer.js` | Worker: libimagequant palette reduction (WASM). |
| `encoder/writer.js` | Worker: gifsicle encoding (WASM). |
| `encoder/encoder.c` | C glue compiled to `encoder/encoder.js` + `encoder.wasm` (git-ignored, built via Docker / CI). |

### Dev loop

```sh
npm install
npm run dev          # typecheck --watch + esbuild --watch + static server
npm run build        # typecheck + bundle (run before every commit)
```

- **The built WASM encoder is checked in** (`encoder/encoder.js` + `encoder/encoder.wasm`, ~100 KB;
  upstream git-ignores them, this fork commits them so running locally needs no Docker). After
  changing `encoder/encoder.c`, rebuild with `./build.sh` (needs Docker; uses
  `emscripten/emsdk:3.1.9`, **do not bump**, upstream's last commit reverted an emsdk upgrade) and
  commit the regenerated files with the C change.
- **TypeScript is 4.3**, whose `lib.dom` has **no `MediaRecorder` / `BlobEvent` types**. Declare
  the minimal surface you use in the existing `declare global` block in `src/main.ts` (same
  pattern as `getDisplayMedia`). Don't upgrade TypeScript as part of a feature milestone.
- **Manual testing** needs a real browser and the screen-share picker. Agents with Playwright /
  Chromium can try launch flags such as `--auto-select-desktop-capture-source="Entire screen"`
  (or `--auto-select-tab-capture-source-by-title=<title>`) with `--use-fake-ui-for-media-stream`.
  If capture can't be automated, follow rule 6.

---

## M0: Fork setup

- [ ] Enable GitHub Actions on the fork (Settings → Actions; disabled by default on forks).
- [ ] Confirm CI (`.github/workflows/build.yml`) goes green on `main`: typecheck, bundle, and the
      Docker encoder build.
- [ ] Decide on hosting (optional, can be deferred). The upstream deploy job publishes
      branch `prod` to `gh-pages` and commits as João Moreno. For the fork: create `gh-pages`,
      enable Pages, and change the committer name/email in the workflow. Skip if only running
      locally.

---

## M1: Download the original video: **REMOVED**

Implemented with a parallel `MediaRecorder` on the capture stream (see commits `e7bd186`,
`a84fbe5`) and then removed at the owner's request. On the owner's Windows/Chrome machine the
recorded video was corrupted: the MP4 (H.264) had green, torn frames at intervals in every
player, and the VP9 WebM was entirely green. Both point at the machine's hardware video encoder,
which couldn't be reproduced or verified from a sandbox. The GIF pipeline was never affected (it
grabs frames via canvas, not the encoder). If this comes back, start with forcing
`video/webm;codecs=vp8` (software-encoded in Chrome) and get it verified on that machine first.

## M2: Resize output

**Goal:** A **Size** dropdown in the preview action bar: `100%` (default), `75%`, `50%`, `33%`,
applied to the cropped region before encoding.

**Files:** `src/gifcap.d.ts`, `src/views/preview.ts`, `src/views/render.ts`, `main.css`.

- [x] Add `readonly scale: number` to `RenderOptions`. `PreviewView` initialises it from
      `vnode.attrs.renderOptions?.scale ?? 1` so it survives Edit → Render round-trips.
- [x] Add a compact `<select>` to the preview action bar, styled to match the existing buttons
      (chota CSS). Keep the bar usable at narrow widths.
- [x] In `render.ts`, output size is `outW = Math.max(1, Math.round(crop.width * scale))` (same for
      height). Pass `outW/outH` to `new GifEncoder(...)`.
- [x] When `scale !== 1`, `putImageData` the full frame to the existing hidden canvas, then
      `drawImage(srcCanvas, crop.left, crop.top, crop.width, crop.height, 0, 0, outW, outH)` onto a
      second hidden canvas of size `outW×outH` with `imageSmoothingQuality = "high"`, and
      `getImageData` from it. (`putImageData` ignores transforms, so two canvases are needed.)
- [x] When `scale === 1`, keep the current code path untouched.
- [x] Scaling happens **before** `gif.addFrame`, so frame diffing and dedupe operate on scaled
      frames.
- [x] `npm run build` passes.

### Acceptance checks

- [ ] 50% on a 1920×1080 crop → GIF is 960×540; file noticeably smaller; render noticeably faster.
- [x] 100% → identical dimensions and comparable size to before M2.
- [ ] Text stays legible at 75% on a typical UI recording.
- [x] Setting persists across Render → Edit → Render.
- [x] Tiny crops (≈10 px) at 33% don't crash (minimum 1 px).

---

## M3: Lower output FPS

**Goal:** An **FPS** dropdown: `12` (default), `10`, `8`, `5`. Only ≤ 12, because capture runs at
12 FPS.

**Files:** `src/gifcap.d.ts`, `src/views/preview.ts`, `src/views/render.ts`, `encoder/writer.js`.

- [x] Add `readonly fps: number` to `RenderOptions`, initialised like `scale`.
- [x] Add the `<select>` next to Size.
- [x] In `render.ts`, select frames by timestamp: keep a frame when
      `frame.timestamp >= nextEmit`, then `nextEmit += 1000 / fps`. A kept frame's delay is the
      timestamp gap to the **next kept** frame; the last kept frame lasts until the end of the trim
      range (preserves total duration). Skipped frames are never passed to `addFrame`. At
      `fps === 12` behaviour must equal today's.
- [x] Fix delay rounding in `encoder/writer.js`: `frame.delay / 10` is truncated by the `int`
      parameter, so GIFs play ~4% fast. Round with the error carried across frames
      (`Math.round(elapsedMs / 10) - writtenCs`) so long GIFs don't drift. This is JS only, so no
      WASM rebuild is needed.
- [x] Progress bar still reaches 100% (the encoder's `totalFrames` counts only frames actually
      added).
- [x] `npm run build` passes.

### Acceptance checks

- [x] A 10 s recording rendered at 5 FPS still plays for ~10 s (not shorter or longer).
- [x] High-motion recording at 5 FPS is clearly smaller than at 12 FPS.
- [x] Trim boundaries are respected at every FPS.
- [x] Combined with M2 (e.g. 50% + 8 FPS) works.

---

## M4: Colours + compression level (WASM change)

**Goal:** **Colours** dropdown `256` (default) / `128` / `64` / `32`, and **Compression**
dropdown `Normal` (loss 20, default) / `High` (60) / `Max` (120).

**Files:** `encoder/encoder.c`, `encoder/quantizer.js`, `encoder/writer.js`,
`encoder/gifencoder.js`, `encoder/encoder.d.ts`, `src/gifcap.d.ts`, `src/views/preview.ts`,
`src/views/render.ts`, possibly `.github/workflows/build.yml`.

- [x] **Get built WASM without local Docker (if needed):** in `build.yml`, upload the build artifact
      on every branch (not only `prod`); keep the `deploy` job `prod`-only. Then a CI run's
      `build` artifact contains `encoder/encoder.js` + `encoder.wasm` for testing.
- [x] `encoder.c`: add an `int max_colors` parameter to `quantize_image` and call
      `liq_set_max_colors(attr, max_colors)` (valid range 2–256) before `liq_quantize_image`.
- [x] `encoder.c`: add an `int loss` parameter to `encoder_new` and set `gif_write_info.loss = loss`.
      The global is per-module-instance and each writer worker has its own instance, so this is safe.
- [x] `gifencoder.js`: accept `{ width, height, colors, loss }`; include `colors` in each frame
      message sent to quantizers; `writer.js` receives `opts` already and passes `opts.loss` to
      `_encoder_new`.
- [x] `quantizer.js`: pass `frame.colors` to `_quantize_image(width, height, ptr, colors, cb)`.
- [x] `encoder/encoder.d.ts`: extend the constructor options type.
- [x] `RenderOptions` gets `colors` and `loss`; dropdowns added next to Size/FPS; defaults
      `256` / `20` reproduce today's output exactly.
- [x] Rebuild the encoder (`./build.sh` or CI) with emsdk **3.1.9** unchanged.
- [x] `npm run build` passes.

### Acceptance checks

- [x] Defaults → output size within noise of pre-M4 on the same recording.
- [x] 64 colours → smaller file; UI recordings still readable.
- [ ] Max compression → smaller file than Normal; artefacts acceptable on UI recordings.
- [x] Render time not worse than pre-M4 at defaults.
- [x] Works combined with M2 + M3.

---

## M5: Privacy hardening (optional)

**Goal:** Turn "nothing leaves your machine" from *true in practice* into *enforced by the
browser*. Today, recording data is never sent anywhere, but the page itself makes third-party
requests (analytics, fonts, icons).

- [x] Remove GoatCounter analytics from `index.html` (`gc.zgo.at/count.js`). Done with M6: it
      reported page views to upstream's `gifcap.goatcounter.com` account.
- [ ] Self-host fonts: Baloo 2 (700) and Roboto into `media/fonts/` with `@font-face` in `main.css`;
      remove the Google Fonts `<link>`s. (Both are OFL/Apache licensed; keep license files.)
- [x] Self-host icons previously loaded from `icongr.am`. Done as inline SVG: path data for the
      12 icons in use lives in `src/icons.ts` (Octicons v19.38.0, MIT; Material Design Icons
      v7.4.47, Apache-2.0; license notice kept in the bundle via a `/*! */` comment), rendered by
      `src/components/icon.ts` with an explicit `fill`, so there are no image requests at all.
      Octicons renamed `trashcan` to `trash`; the old name is kept as an alias.
- [ ] Add a Content-Security-Policy `<meta>` to `index.html`, roughly:
      `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'`.
      Adjust only as needed for the app to work. Never add another origin.
- [ ] Update `README.md` with a short privacy note.

### Acceptance checks

- [ ] Full flow (record → video download → render → GIF download) works with zero CSP violations in
      the console.
- [ ] Devtools Network tab: every request is same-origin or `blob:`.
- [ ] Works in Chrome, Firefox, and Safari (if available).

---

## M6: Deploy to Vercel

**Goal:** Import the repo into Vercel and have it build and serve with no manual settings.

- [x] `vercel.json`: no framework preset, build command `npm run build && node
      scripts/build-site.js`, output directory `site`.
- [x] `scripts/build-site.js` copies only what the app serves (`index.html`, `main.css`,
      `LICENSE`, `dist/*.js`, the encoder JS + WASM, `media/`) into `site/` (git-ignored), so
      `node_modules`, `docs`, `encoder/vendor`, etc. are never published.
- [x] Built encoder is committed (see Dev loop), so Vercel never needs Docker/emsdk.
- [x] Removed upstream's GoatCounter analytics script.
- [x] Fresh clone → `npm install` → build command → serve `site/` → full record/render flow
      works in headless Chromium.
- [ ] Owner: import the repo in Vercel and confirm the production URL works (screen capture
      needs HTTPS, which Vercel provides).

## M7: Open a local video or GIF

**Goal:** Use the same editor (trim, crop, size, FPS, colours, compression) on a video or GIF
from the user's machine, not only on screen recordings. Read locally; never uploaded.

- [x] Start screen: "Open Video or GIF" button (also on mobile, where recording isn't available)
      and drag-and-drop onto the page.
- [x] `src/import.ts` turns the file into a normal `Recording` sampled at `CAPTURE_FPS`, so the
      rest of the pipeline is unchanged:
  - Video (anything the browser's `<video>` plays; unknown MIME types are tried as video): seek
    through it and grab a frame every 1/12 s. Handles files that report no duration (e.g.
    MediaRecorder WebM) by seeking to the end first.
  - GIF: decoded with WebCodecs `ImageDecoder` (frames come out composited), then resampled to
    12 FPS with repeated frames sharing one `ImageData`; GIF timing is kept (delays < 20 ms
    count as 100 ms, like browsers). Transparent areas are flattened onto white (the encoder has
    no transparency). Browsers without `ImageDecoder` get a clear message.
  - Imports are scaled down to fit ~1.5 GB of raw frames so long or large files don't crash the
    tab.
- [x] Import screen with progress and Cancel; unreadable files show a message and return to start.
- [x] Verified headless (files generated in-browser): MediaRecorder WebM without duration (3 s →
      3000 ms, 36 frames), MP4 (3 s), GIF with 100/200/300/400/1000 ms delays (renders back to 5
      frames, 2.00 s), drag-and-drop, non-media file (message), Cancel on a 20 s video, crop +
      50% + 8 FPS + 64 colours on an import, screen recording unaffected.
- [ ] Owner: try real files (phone videos, `.mov`, large GIFs) in Chrome on Windows.

## Non-goals (don't build unless a new milestone is added)

- Audio capture.
- Downloading the original video (tried in M1, removed; see above).
- Exporting the trimmed/cropped clip as video (WebCodecs/ffmpeg.wasm).
- FPS above 12 or changing capture-time resolution.
- Named presets, remembered settings, live size estimates, side-by-side quality previews.
- A "compression algorithm" selector. GIF only supports LZW; the real levers are M2–M4.
- Dithering toggle (revisit only if M4 results show a need).

## Progress log

Append one line per work session: date, milestone, what was done, anything left unverified.

| Date | Milestone | Notes |
|---|---|---|
| 2026-10-01 | — | Plan created. Fork at upstream `97c7267`. |
| 2026-10-01 | M1 | Implemented. Verified in headless Chromium with a synthetic canvas `captureStream` standing in for `getDisplayMedia`: MP4 (1280×720, 4.07 s duration), forced-WebM path (duration patched to 4.18 s instead of `Infinity`), track `ended` path (synthetic event), no-`MediaRecorder` fallback, Edit round-trip, Discard revokes the URL. Added `fix-webm-duration` dependency and `"moduleResolution": "node"` in `tsconfig.json` so TS can resolve it. **Needs human verification:** real screen capture in Chrome/Firefox/Safari, seeking in VLC, real "Stop sharing" bar, render time unchanged on a real recording. |
| 2026-10-01 | M2 | Implemented. Headless, synthetic 1280×720 stream, 3 s: 100% → 1280×720 / 788 KB; 50% → 640×360 / 224 KB; 33% → 422×238 / 142 KB; crop + 75% and a 20×15 px crop at 33% (→ 7×5) work; setting survives Edit. Added `src/settings.ts` (setting definitions + defaults) and `RenderSettings` type for M3/M4 to extend. **Needs human verification:** 1920×1080 real recording at 50%, render speed-up, text legibility at 75%. |
| 2026-10-01 | M3 | Implemented. Headless, 5 s synthetic recording: 12 FPS → 61 frames / 1015 KB, 10 → 50 / 893 KB, 8 → 40 / 745 KB, 5 → 25 / 554 KB; total GIF delay 4.99–5.11 s at every FPS (before the rounding fix a 4 s recording came out at 3.79 s). `selectFrames` unit-checked on jittered timestamps with a trim range: first kept = trim start, average gaps 83/102/127/204 ms. 50% + 8 FPS combined works and survives Edit. Capture rate moved to `CAPTURE_FPS` in `src/settings.ts`. |
| 2026-10-01 | M4 | Implemented; encoder rebuilt with emsdk 3.1.9 in Docker. Deterministic benchmark (same 40 synthetic 960×540 frames fed straight to `GifEncoder`, old vs new encoder): defaults are **byte-identical** to pre-M4 (492,631 B), same speed. 128/64/32 colours → 374/273/216 KB; loss 60/120 → 475/465 KB (lossy gains are small on this synthetic content); 64 colours + Max → 249 KB. All outputs decode. Full UI flow with all four settings survives Edit. Settings wrap to a second row below 1300 px so the trim bar stays usable. README now has accurate local build/run steps (incl. Windows). **Needs human verification:** readability at 64 colours and artefacts at Max on real UI recordings. |
| 2026-10-01 | — | Committed the built encoder (from `encoder.c` at `7df7582`) so local runs need no Docker; `build.sh` fixed for Git Bash. |
| 2026-10-01 | M1 | Human test on Windows/Chrome: GIF sizes/compression and video download work, but the MP4 had green, torn frames at intervals in every player (likely Chrome's GPU H.264 encoder). Switched to prefer WebM (VP9 → VP8), MP4 only as Safari fallback. **Needs human verification** that the WebM is clean on that machine. |
| 2026-10-01 | M1 | WebM was entirely green on the owner's machine too. Feature removed at the owner's request; `record.ts`, `play.ts`, `package.json`, `tsconfig.json` are back to upstream. |
| 2026-10-01 | M6 | Vercel setup added (`vercel.json`, `scripts/build-site.js`), GoatCounter removed. Verified by simulating the Vercel build on a fresh clone. |
| 2026-10-01 | M5 | Icons bundled as inline SVG (no more icongr.am requests). Checked visually on start, recording, preview and finished screens plus footer; the only remaining third-party requests are the two Google Fonts stylesheets. Fonts and CSP still open. |
| 2026-10-01 | M7 | Local video/GIF import added (see M7). Needs a real-file check on the owner's machine. |
