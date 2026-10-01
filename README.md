# gifcap

[![Build](https://github.com/joaomoreno/gifcap/actions/workflows/build.yml/badge.svg)](https://github.com/joaomoreno/gifcap/actions/workflows/build.yml)

Record your screen into an animated GIF, all you need is a browser!

👉 [gifcap.dev](https://gifcap.dev/)

[![gifcap screenshot](https://user-images.githubusercontent.com/22350/119881198-4d861b00-bf2d-11eb-866b-9607b6da676a.png)](https://gifcap.dev/)

**Features:**

- No installations, no bloatware, no updates: this works in any modern browser, including Google Chrome, Firefox, Edge and Safari;
- No server side, everything is **100% client-side only**. All data stays in your machine, nothing gets uploaded to any server, the entire application is made of static files;
- PWA support makes it easy to add gifcap to your OS list of applications;
- Blazing fast GIF rendering powered by WASM, [libimagequant](https://github.com/ImageOptim/libimagequant) and [gifsicle](https://github.com/kohler/gifsicle);
- Highly optimized GIF file sizes, thanks to frame deduplication, boundary delta detection and lossy encoding;
- Entire screen recordings, or selection of single window;
- Intuitive trimming UI
- Easy cropping via visual drag-and-drop

## How to build and run locally

You only need Node.js. The built WASM encoder (`encoder/encoder.js` + `encoder/encoder.wasm`) is
checked in, so no Docker is required to run the app:

```sh
git clone https://github.com/heavenideas/gifcap
cd gifcap
npm install
npm run dev    # http://localhost:5000 (rebuilds on save)
```

Port 5000 taken (e.g. macOS AirPlay)? Set `PORT=3000` (PowerShell: `$env:PORT=3000`) before
`npm run dev`.

### Deploying to Vercel

Import the repository in Vercel and deploy; `vercel.json` sets everything (no framework preset,
build command `npm run build && node scripts/build-site.js`, output directory `site`). Only the
files the app serves are published. To check the output locally:
`npm run build && node scripts/build-site.js && npx serve site`.

### Rebuilding the encoder (only after changing `encoder/encoder.c`)

Needs Docker. Uses `emscripten/emsdk:3.1.9`; don't bump it, upstream reverted an emsdk upgrade.
Commit the regenerated `encoder/encoder.js` and `encoder/encoder.wasm` along with your C change.

```sh
./build.sh     # bash, macOS, Linux, or Git Bash on Windows
```

PowerShell instead (not Git Bash, which turns `/work` into `C:/Program Files/Git/work`):

```powershell
git submodule update --init --recursive
docker build -t gifcap-encoder -f encoder/Dockerfile .
docker run --rm -v "${PWD}:/work" -w /work gifcap-encoder
```

On Windows, clone with `git clone -c core.autocrlf=false ...` before building: CRLF line endings
break the `configure` scripts inside the Linux container. No Docker? Every CI run uploads a
`build` artifact containing freshly built `encoder/encoder.js` and `encoder/encoder.wasm`.
