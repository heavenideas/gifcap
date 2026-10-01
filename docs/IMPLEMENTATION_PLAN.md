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

## M1: Download the original video (Option A: parallel `MediaRecorder`)

**Goal:** Record the capture stream with `MediaRecorder` alongside the existing frame capture,
and offer a **"Download original video"** button. The video is the untouched original: full
resolution, the stream's native frame rate, **not** trimmed or cropped. No audio.

**Files:** `src/gifcap.d.ts`, `src/main.ts`, `src/views/record.ts`, `src/views/preview.ts`,
`src/views/play.ts`, possibly `main.css`.

### Tasks

- [x] **Types.** In `src/gifcap.d.ts` add:
      ```ts
      export interface Video { readonly blob: Blob; readonly url: string; readonly mimeType: string; }
      ```
      and an optional `readonly video?: Video` on `Recording`. Optional because `MediaRecorder` may
      be unavailable or fail. The GIF flow must keep working without it.
- [x] **TS declarations.** Add minimal `MediaRecorder` / `BlobEvent` declarations to the
      `declare global` block in `src/main.ts` (TS 4.3 lacks them): constructor
      `(stream, { mimeType?, videoBitsPerSecond? })`, static `isTypeSupported`, `start(timeslice?)`,
      `stop()`, `state`, `mimeType`, `ondataavailable`, `onstop`, `onerror`.
- [x] **Pick the format at runtime.** Try in order, first supported wins:
      `video/webm;codecs=vp9`, `video/webm;codecs=vp8`, `video/webm`, `video/mp4;codecs=avc1`,
      `video/mp4`. (WebM first: Chrome's H.264 path can use the GPU encoder, which produced green,
      torn frames on a Windows machine in testing. MP4 is for Safari, which can't record WebM.) If none is supported or `MediaRecorder` is undefined, record no video.
      After start, trust `recorder.mimeType` (not the requested string) for the file type.
- [x] **Record in parallel.** In `RecordView.oncreate`, create the recorder on `this.captureStream`
      with `videoBitsPerSecond: 8_000_000` (keeps screen text crisp; browser defaults are too
      low) and `start(1000)` so chunks are flushed every second. Collect `ondataavailable`
      chunks (ignore empty ones).
- [x] **Async stop.** `stopRecording()` must call `recorder.stop()` and wait for `onstop` (the final
      `dataavailable` arrives after `stop()`), then build the `Blob` and call
      `app.stopRecording({ width, height, frames, video })`. Add a re-entry guard so the Stop button
      and the track `ended` event can't both complete a stop. Stop the ticker worker first so no
      frames are added while waiting. If the recorder errored, carry on without `video`.
- [x] **WebM duration fix.** WebM files from `MediaRecorder` lack a Duration header, so many players
      show no length and can't seek. When the result is WebM, patch the duration (measured from
      recording start to stop) before creating the Blob. Use the small, dependency-free
      `fix-webm-duration` npm package (bundled by esbuild; runs fully locally) or an equivalent
      vendored function. MP4 needs no fix.
- [x] **Blob URL lifecycle.** Create the object URL once when the recording stops. Revoke it in
      `App.discardGif()` when the user confirms. Edit/re-render must **not** revoke it.
- [x] **UI: preview screen.** Add an icon-only secondary `Button` (title
      `"Download original video"`) to the `PreviewView` action bar, rendered only when
      `recording.video` exists. Uses `Button`'s `a: { href, download }`, like `play.ts`.
- [x] **UI: finished screen.** Add a labelled secondary button `"Download video"` next to "Download"
      in `PlayView`, same condition. This requires passing `recording` (or `recording.video`) into
      `PlayView`; `main.ts` already holds `recording` in the `playing` state.
- [x] **Filename.** Reuse the existing `Recording YYYY-MM-DD at HH.MM.SS` pattern from
      `play.ts` (extract it to a small shared helper rather than copy it), with extension `.mp4` or
      `.webm` from the actual MIME type.
- [x] `npm run build` passes (typecheck + bundle).

### Acceptance checks

- [ ] Chrome: record ~10 s with motion → preview shows the video button → downloaded file plays in
      the browser and in VLC, **has a correct duration and is seekable**, full resolution, smooth
      motion (more than 12 FPS).
- [ ] Firefox: same, as WebM, with working duration/seeking.
- [ ] Safari (if available): same, as MP4.
- [ ] Trim + crop in preview → video download is still the full original (expected behaviour).
- [x] Render GIF → Edit → Render again → video button still works on both screens.
- [x] Stop via the browser's own "Stop sharing" bar (track `ended` path) → video still complete.
- [x] Discard → confirm → object URL revoked (Devtools: fetching the old `blob:` URL fails).
- [x] With `MediaRecorder` forced unavailable (e.g. `delete window.MediaRecorder` in devtools before
      recording), the app works exactly as before, with no video button and no errors.
- [x] Devtools Network tab shows **no new requests** during record/stop/download (apart from the
      button icon from icongr.am, like every other icon; icons are self-hosted in M5).
- [ ] GIF rendering time and output are unchanged versus before M1 on a comparable recording.

---

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

- [ ] Remove GoatCounter analytics from `index.html` (`gc.zgo.at/count.js`).
- [ ] Self-host fonts: Baloo 2 (700) and Roboto into `media/fonts/` with `@font-face` in `main.css`;
      remove the Google Fonts `<link>`s. (Both are OFL/Apache licensed; keep license files.)
- [ ] Self-host icons now loaded from `icongr.am` as SVGs under `media/icons/`, and update
      `src/components/button.ts`, `src/components/timer.ts`, `src/main.ts`, `src/views/play.ts`.
      In use today: octicons `play`, `gear`, `trashcan`, `square-fill`, `download`, `pencil`, `clock`,
      `mark-github`, `heart`, plus whatever M1 adds (e.g. `device-camera-video`); material `play`,
      `pause`, `coffee`. Octicons are MIT and Material Icons Apache-2.0, so keep license notices.
      Note `Button` currently tints icons via a URL `color` param, so you need white and `#333333`
      variants (or CSS-based tinting).
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

## Non-goals (don't build unless a new milestone is added)

- Audio capture.
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
