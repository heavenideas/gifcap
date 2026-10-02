import { Recording, Rect, RenderOptions } from "./gifcap";
import { createFrameExtractor, selectFrames } from "./pipeline";
import { outputSize } from "./settings";

// clips with up to this many output frames are encoded fully, giving the exact size
const EXACT_LIMIT = 48;

// longer clips are sampled: windows of this many consecutive frames, one at the start (for the
// first frame) and the rest where the most change happens (where most of the bytes go)
const WINDOW = 12;
const WINDOWS = 3;

// change detection records which TILE×TILE squares changed, comparing every STRIDEth pixel
const TILE = 16;
const STRIDE = 2;

export class EstimateToken {
  cancelled = false;
  private aborts: Function[] = [];

  onCancel(abort: Function): void {
    this.aborts.push(abort);
  }

  cancel(): void {
    this.cancelled = true;
    this.aborts.forEach((abort) => abort());
  }
}

export interface Estimate {
  readonly bytes: number;
  readonly exact: boolean;
}

interface ImageBytes {
  readonly total: number; // with the extensions before it (its delay) and its own palette
  readonly pixels: number; // just the compressed pixel data
}

// Byte sizes of each image in a GIF, and of everything else (header, loop extension, trailer).
function measureGif(bytes: Uint8Array): { images: ImageBytes[]; overhead: number } {
  const images: ImageBytes[] = [];
  const tableSize = (packed: number) => (packed & 0x80 ? 3 * Math.pow(2, (packed & 7) + 1) : 0);
  const skipSubBlocks = (pos: number) => {
    while (bytes[pos] !== 0) {
      pos += bytes[pos] + 1;
    }

    return pos + 1;
  };

  let pos = 13 + tableSize(bytes[10]);
  let pending = 0;

  while (pos < bytes.length && bytes[pos] !== 0x3b) {
    const start = pos;

    if (bytes[pos] === 0x21) {
      const isGraphicControl = bytes[pos + 1] === 0xf9;
      pos = skipSubBlocks(pos + 2);
      pending += isGraphicControl ? pos - start : 0;
    } else if (bytes[pos] === 0x2c) {
      const data = pos + 10 + tableSize(bytes[pos + 9]) + 1;
      pos = skipSubBlocks(data);
      images.push({ total: pending + pos - start, pixels: pos - data });
      pending = 0;
    } else {
      break; // not a GIF block; measure what we have
    }
  }

  return { images, overhead: bytes.length - images.reduce((sum, image) => sum + image.total, 0) };
}

function nextTick(): Promise<void> {
  return new Promise((c) => setTimeout(c, 0));
}

// which tiles differ between two frames (1 = changed), row by row
function changedTiles(a: ImageData, b: ImageData): Uint8Array | undefined {
  if (a === b) {
    return undefined; // imported GIFs reuse one ImageData for repeated frames
  }

  const pa = new Uint32Array(a.data.buffer);
  const pb = new Uint32Array(b.data.buffer);
  const width = a.width;
  const tilesX = Math.ceil(width / TILE);
  const tiles = new Uint8Array(tilesX * Math.ceil(a.height / TILE));
  let changed = false;

  for (let y = 0; y < a.height; y += STRIDE) {
    const row = y * width;
    const tileRow = Math.floor(y / TILE) * tilesX;

    for (let x = 0; x < width; x += STRIDE) {
      if (pa[row + x] !== pb[row + x]) {
        tiles[tileRow + Math.floor(x / TILE)] = 1;
        changed = true;
      }
    }
  }

  return changed ? tiles : undefined;
}

// changed tiles between consecutive frames of a recording (index i: frame i-1 → i), computed once
const changeCache = new WeakMap<Recording, (Uint8Array | undefined)[]>();

async function changes(recording: Recording, token: EstimateToken): Promise<(Uint8Array | undefined)[] | undefined> {
  const cached = changeCache.get(recording);

  if (cached) {
    return cached;
  }

  const result: (Uint8Array | undefined)[] = [undefined];

  for (let i = 1; i < recording.frames.length; i++) {
    if (token.cancelled) {
      return undefined;
    }

    result.push(changedTiles(recording.frames[i - 1].imageData, recording.frames[i].imageData));

    if (i % 8 === 0) {
      await nextTick(); // keep the editor responsive
    }
  }

  changeCache.set(recording, result);
  return result;
}

// Output pixels the encoder stores going from frame `from` to frame `to` (from < to): like the
// encoder, the bounding box of everything that changed inside the crop, scaled.
function changedArea(
  recording: Recording,
  tiles: (Uint8Array | undefined)[],
  from: number,
  to: number,
  crop: Rect,
  scale: number
): number {
  const tilesX = Math.ceil(recording.width / TILE);
  const x0 = Math.floor(crop.left / TILE);
  const x1 = Math.floor((crop.left + crop.width - 1) / TILE);
  const y0 = Math.floor(crop.top / TILE);
  const y1 = Math.floor((crop.top + crop.height - 1) / TILE);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (let i = from + 1; i <= to; i++) {
    const changed = tiles[i];

    if (!changed) {
      continue;
    }

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (changed[ty * tilesX + tx]) {
          left = Math.min(left, tx * TILE);
          top = Math.min(top, ty * TILE);
          right = Math.max(right, (tx + 1) * TILE);
          bottom = Math.max(bottom, (ty + 1) * TILE);
        }
      }
    }
  }

  const width = Math.min(right, crop.left + crop.width) - Math.max(left, crop.left);
  const height = Math.min(bottom, crop.top + crop.height) - Math.max(top, crop.top);
  return width > 0 && height > 0 ? width * height * scale * scale : 0;
}

// Start indexes of the sample windows: the start of the clip, then non-overlapping windows with
// the most change (falling back to the middle and end when nothing changes).
function sampleStarts(areas: number[]): number[] {
  const starts = [0];
  const last = areas.length - WINDOW;
  const overlaps = (start: number) => starts.some((s) => Math.abs(s - start) < WINDOW);
  const windowArea = (start: number) => areas.slice(start + 1, start + WINDOW).reduce((a, b) => a + b, 0);

  while (starts.length < WINDOWS) {
    let best = -1;

    for (let start = 0; start <= last; start++) {
      if (!overlaps(start) && windowArea(start) > 0 && (best < 0 || windowArea(start) > windowArea(best))) {
        best = start;
      }
    }

    if (best < 0) {
      break;
    }

    starts.push(best);
  }

  for (const start of [Math.floor(last / 2), last]) {
    if (starts.length < WINDOWS && !overlaps(start)) {
      starts.push(start);
    }
  }

  return starts;
}

// encodes the given frames with the real pipeline; resolves to undefined if cancelled
async function encode(
  recording: Recording,
  options: RenderOptions,
  indexes: number[],
  frameLength: number,
  token: EstimateToken
): Promise<Uint8Array | undefined> {
  const size = outputSize(options.crop, options.scale);
  const gif = new GifEncoder({ width: size.width, height: size.height, colors: options.colors, loss: options.loss });
  const finished = new Promise<Blob>((c) => gif.once("finished", c));
  token.onCancel(() => gif.abort());

  const extractFrame = createFrameExtractor(recording, options);
  const frames = recording.frames;

  for (let i = 0; i < indexes.length; i++) {
    if (token.cancelled) {
      return undefined;
    }

    const frame = frames[indexes[i]];
    const delay = (i < indexes.length - 1 ? frames[indexes[i + 1]].timestamp : frame.timestamp + frameLength) - frame.timestamp;
    gif.addFrame(extractFrame(frame), delay);
    await nextTick(); // keep the editor responsive
  }

  gif.render();
  const blob = await finished;
  return token.cancelled ? undefined : new Uint8Array(await blob.arrayBuffer());
}

// Estimates the rendered GIF's file size, entirely in the browser. Resolves to undefined if
// cancelled via the token.
export async function estimateSize(
  recording: Recording,
  options: RenderOptions,
  frameLength: number,
  token: EstimateToken
): Promise<Estimate | undefined> {
  const indexes = selectFrames(recording.frames, options.trim.start, options.trim.end, options.fps);

  if (indexes.length <= EXACT_LIMIT) {
    const bytes = await encode(recording, options, indexes, frameLength, token);
    return bytes && { bytes: bytes.length, exact: true };
  }

  // The first frame is a full image; every other frame only stores the area that changed since
  // the previous one, plus a fixed cost (its own palette, position, delay); unchanged frames
  // are merged away. Measure the first frame exactly, learn both costs from sample windows, and
  // apply them to how much actually changes across the whole clip.
  const tiles = await changes(recording, token);

  if (!tiles) {
    return undefined;
  }

  const areas = [0]; // areas[i]: changed output pixels going from kept frame i-1 to i

  for (let i = 1; i < indexes.length; i++) {
    areas.push(changedArea(recording, tiles, indexes[i - 1], indexes[i], options.crop, options.scale));
  }

  const starts = sampleStarts(areas);
  let header = 0;
  let firstFrame: ImageBytes = { total: 0, pixels: 0 };
  let sampleImages = 0;
  let sampleFixedBytes = 0;
  let samplePixelBytes = 0;
  let sampleArea = 0;

  for (let w = 0; w < starts.length; w++) {
    const bytes = await encode(recording, options, indexes.slice(starts[w], starts[w] + WINDOW), frameLength, token);

    if (!bytes) {
      return undefined;
    }

    const gif = measureGif(bytes);

    if (w === 0) {
      header = gif.overhead;
      firstFrame = gif.images[0] || firstFrame;
    }

    for (const image of gif.images.slice(1)) {
      sampleImages++;
      sampleFixedBytes += image.total - image.pixels;
      samplePixelBytes += image.pixels;
    }

    for (let i = starts[w] + 1; i < starts[w] + WINDOW; i++) {
      sampleArea += areas[i];
    }
  }

  // if nothing changed in the samples, fall back to the first frame's costs
  const size = outputSize(options.crop, options.scale);
  const fixedBytes = sampleImages > 0 ? sampleFixedBytes / sampleImages : firstFrame.total - firstFrame.pixels;
  const bytesPerPixel = sampleArea > 0 ? samplePixelBytes / sampleArea : firstFrame.pixels / (size.width * size.height);
  let changedFrames = 0;
  let totalArea = 0;

  for (let i = 1; i < indexes.length; i++) {
    changedFrames += areas[i] > 0 ? 1 : 0;
    totalArea += areas[i];
  }

  return {
    bytes: Math.round(header + firstFrame.total + fixedBytes * changedFrames + bytesPerPixel * totalArea),
    exact: false,
  };
}
