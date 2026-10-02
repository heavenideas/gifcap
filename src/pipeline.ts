import { Frame, Recording, RenderOptions } from "./gifcap";
import { CAPTURE_FPS, outputSize } from "./settings";

// indexes of the frames to keep in [start, end] so that at most `fps` frames are shown per second
export function selectFrames(frames: Frame[], start: number, end: number, fps: number): number[] {
  const result: number[] = [];

  if (fps >= CAPTURE_FPS) {
    for (let index = start; index <= end; index++) {
      result.push(index);
    }

    return result;
  }

  const interval = 1000 / fps;
  let lastSlot = -1;

  for (let index = start; index <= end; index++) {
    const slot = Math.floor((frames[index].timestamp - frames[start].timestamp) / interval);

    if (slot > lastSlot) {
      result.push(index);
      lastSlot = slot;
    }
  }

  return result;
}

function createContext(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
}

// Returns a function producing the cropped and scaled copy of a frame that goes to the encoder.
// It always copies, because the encoder moves frame buffers to web workers and the user might
// go back to edit.
export function createFrameExtractor(recording: Recording, options: RenderOptions): (frame: Frame) => ImageData {
  const crop = options.crop;
  const size = outputSize(crop, options.scale);
  const ctx = createContext(recording.width, recording.height);
  const scaledCtx = createContext(size.width, size.height);
  scaledCtx.imageSmoothingQuality = "high";

  return (frame) => {
    ctx.putImageData(frame.imageData, 0, 0);

    if (options.scale === 1) {
      return ctx.getImageData(crop.left, crop.top, crop.width, crop.height);
    }

    // putImageData ignores transforms, so scale by drawing onto a second canvas
    scaledCtx.drawImage(ctx.canvas, crop.left, crop.top, crop.width, crop.height, 0, 0, size.width, size.height);
    return scaledCtx.getImageData(0, 0, size.width, size.height);
  };
}
