import { Frame, Recording } from "./gifcap";
import { CAPTURE_FPS } from "./settings";

// TypeScript 4.3's DOM lib has no WebCodecs types; declare only what we use
declare global {
  interface VideoFrame {
    readonly displayWidth: number;
    readonly displayHeight: number;
    readonly duration: number | null; // microseconds
    close(): void;
  }

  interface ImageDecoder {
    readonly completed: Promise<void>;
    readonly tracks: { readonly ready: Promise<void>; readonly selectedTrack: { readonly frameCount: number } | null };
    decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
    close(): void;
  }

  var ImageDecoder: { new (init: { data: BufferSource; type: string }): ImageDecoder } | undefined;
}

// frames are kept as raw RGBA in memory; above this, imports are scaled down so the tab survives
const MEMORY_BUDGET = 1.5 * 1024 * 1024 * 1024;

// browsers show GIF frames with a delay this short (or none) for 100ms
const MIN_GIF_DELAY = 20;

export interface ImportToken {
  cancelled: boolean;
}

export class ImportError extends Error {}

class Cancelled extends Error {}

function timestamp(index: number): number {
  return Math.round((index * 1000) / CAPTURE_FPS);
}

// largest size (at most the source size) that fits `frameCount` frames into the memory budget
function fitToBudget(width: number, height: number, frameCount: number): { width: number; height: number } {
  const scale = Math.min(1, Math.sqrt(MEMORY_BUDGET / (width * height * 4 * Math.max(1, frameCount))));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

function createContext(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((c, e) => {
    video.onseeked = () => c();
    video.onerror = () => e(new ImportError("This video can't be decoded by your browser."));
    video.currentTime = time;
  });
}

async function importVideo(file: File, onProgress: (progress: number) => void, token: ImportToken): Promise<Recording> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";

  try {
    await new Promise<void>((c, e) => {
      video.onloadeddata = () => c();
      video.onerror = () => e(new ImportError("This video format isn't supported by your browser."));
      video.src = url;
    });

    // some files (e.g. WebM from MediaRecorder) only report their duration after seeking to the end
    if (!isFinite(video.duration)) {
      await seek(video, Number.MAX_SAFE_INTEGER);
    }

    const duration = video.duration * 1000;

    if (!isFinite(duration) || video.videoWidth === 0) {
      throw new ImportError("This video has no readable duration or picture.");
    }

    const frameCount = Math.max(1, Math.ceil((duration * CAPTURE_FPS) / 1000));
    const size = fitToBudget(video.videoWidth, video.videoHeight, frameCount);
    const ctx = createContext(size.width, size.height);
    const frames: Frame[] = [];

    for (let index = 0; index < frameCount; index++) {
      if (token.cancelled) {
        throw new Cancelled();
      }

      await seek(video, timestamp(index) / 1000);
      ctx.drawImage(video, 0, 0, size.width, size.height);
      frames.push({ imageData: ctx.getImageData(0, 0, size.width, size.height), timestamp: timestamp(index) });
      onProgress((index + 1) / frameCount);
    }

    return { width: size.width, height: size.height, frames };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function importGif(file: File, onProgress: (progress: number) => void, token: ImportToken): Promise<Recording> {
  if (typeof ImageDecoder === "undefined") {
    throw new ImportError("Opening GIFs needs a browser with ImageDecoder support, such as Chrome or Edge.");
  }

  const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: "image/gif" });

  try {
    await decoder.tracks.ready;
    await decoder.completed;

    const track = decoder.tracks.selectedTrack;

    if (!track || track.frameCount === 0) {
      throw new ImportError("This GIF has no frames.");
    }

    // decode each GIF frame once (frames come out fully composited)...
    const images: ImageData[] = [];
    const starts: number[] = [];
    let ctx: CanvasRenderingContext2D | undefined;
    let size = { width: 0, height: 0 };
    let elapsed = 0;

    for (let index = 0; index < track.frameCount; index++) {
      if (token.cancelled) {
        throw new Cancelled();
      }

      const image = (await decoder.decode({ frameIndex: index })).image;

      if (!ctx) {
        size = fitToBudget(image.displayWidth, image.displayHeight, track.frameCount);
        ctx = createContext(size.width, size.height);
      }

      // the encoder has no transparency support, so flatten transparent areas onto white
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.drawImage(image as unknown as CanvasImageSource, 0, 0, size.width, size.height);
      images.push(ctx.getImageData(0, 0, size.width, size.height));
      starts.push(elapsed);

      const delay = image.duration === null ? 0 : image.duration / 1000;
      elapsed += delay < MIN_GIF_DELAY ? 100 : delay;
      image.close();
      onProgress((index + 1) / track.frameCount);
    }

    // ...then sample them at the capture rate like a recording; repeated frames share one ImageData
    const frames: Frame[] = [];
    let source = 0;

    for (let index = 0; index === 0 || timestamp(index) < elapsed; index++) {
      while (source < starts.length - 1 && starts[source + 1] <= timestamp(index)) {
        source++;
      }

      frames.push({ imageData: images[source], timestamp: timestamp(index) });
    }

    return { width: size.width, height: size.height, frames };
  } finally {
    decoder.close();
  }
}

// Turns a local video or GIF into a Recording, entirely in the browser. Resolves to undefined if
// cancelled via the token; rejects with ImportError (user-facing message) if the file can't be read.
export async function importFile(
  file: File,
  onProgress: (progress: number) => void,
  token: ImportToken
): Promise<Recording | undefined> {
  try {
    // some systems report no type for less common extensions; let the browser try those as video
    if (file.type === "image/gif" || /\.gif$/i.test(file.name)) {
      return await importGif(file, onProgress, token);
    } else if (file.type.startsWith("video/") || file.type === "") {
      return await importVideo(file, onProgress, token);
    }

    throw new ImportError("Please choose a video or a GIF file.");
  } catch (err) {
    if (err instanceof Cancelled) {
      return undefined;
    }

    throw err;
  }
}
