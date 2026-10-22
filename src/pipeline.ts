import { Frame, Overlay, Recording, RenderOptions } from "./gifcap";
import { CAPTURE_FPS, outputSize } from "./settings";

export interface OutputFrame {
  readonly index: number;
  readonly delay: number; // ms
}

// The frames that go into the GIF and how long each shows: trimmed, cut sections removed (later
// frames move up to close the gap), and at most `fps` per second.
export function outputFrames(frames: Frame[], options: RenderOptions, frameLength: number): OutputFrame[] {
  const start = frames[options.trim.start].timestamp;
  const end = frames[options.trim.end].timestamp + frameLength;
  const isCut = (t: number) => options.cuts.some((cut) => t >= cut.start && t < cut.end);
  const outputTime = (t: number) =>
    options.cuts.reduce((time, cut) => time - Math.max(0, Math.min(t, cut.end) - Math.max(start, cut.start)), t - start);

  const kept: { index: number; time: number }[] = [];
  let lastSlot = -1;

  for (let index = options.trim.start; index <= options.trim.end; index++) {
    const t = frames[index].timestamp;

    if (isCut(t)) {
      continue;
    }

    // at the capture rate keep every frame: timestamps jitter, so time slots could drop some
    const slot = options.fps >= CAPTURE_FPS ? index : Math.floor(outputTime(t) / (1000 / options.fps));

    if (slot > lastSlot) {
      kept.push({ index, time: outputTime(t) });
      lastSlot = slot;
    }
  }

  const total = outputTime(end);
  return kept.map((frame, i) => ({ index: frame.index, delay: (i < kept.length - 1 ? kept[i + 1].time : total) - frame.time }));
}

export function overlayFont(size: number): string {
  return `bold ${size}px sans-serif`;
}

// draws the overlays visible at `timestamp`, in recording pixels (the caller sets the transform)
export function drawOverlays(ctx: CanvasRenderingContext2D, overlays: Overlay[], timestamp: number): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const overlay of overlays) {
    if (timestamp < overlay.from || timestamp >= overlay.to) {
      continue;
    }

    if (overlay.text !== undefined) {
      // outlined so it reads on any background
      ctx.font = overlayFont(overlay.size);
      ctx.textBaseline = "top";
      ctx.lineWidth = overlay.size / 6;
      ctx.strokeStyle = overlay.color === "#000000" ? "#ffffff" : "#000000";
      ctx.strokeText(overlay.text, overlay.x, overlay.y);
      ctx.fillStyle = overlay.color;
      ctx.fillText(overlay.text, overlay.x, overlay.y);
    }

    for (const stroke of overlay.strokes || []) {
      ctx.beginPath();
      ctx.moveTo(stroke[0], stroke[1]);

      for (let i = 0; i < stroke.length; i += 2) {
        ctx.lineTo(stroke[i], stroke[i + 1]); // includes the first point, so a click draws a dot
      }

      ctx.lineWidth = overlay.size;
      ctx.strokeStyle = overlay.color;
      ctx.stroke();
    }
  }
}

function createContext(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
}

// Returns a function producing the cropped and scaled copy of a frame, overlays included, that goes
// to the encoder. It always copies, because the encoder moves frame buffers to web workers and the
// user might go back to edit.
export function createFrameExtractor(recording: Recording, options: RenderOptions): (frame: Frame) => ImageData {
  const crop = options.crop;
  const size = outputSize(crop, options.scale);
  const ctx = createContext(recording.width, recording.height);
  const scaledCtx = createContext(size.width, size.height);
  scaledCtx.imageSmoothingQuality = "high";

  return (frame) => {
    ctx.putImageData(frame.imageData, 0, 0);

    if (options.scale === 1) {
      drawOverlays(ctx, options.overlays, frame.timestamp);
      return ctx.getImageData(crop.left, crop.top, crop.width, crop.height);
    }

    // putImageData ignores transforms, so scale by drawing onto a second canvas; overlays are drawn
    // after scaling so they stay sharp
    scaledCtx.setTransform(1, 0, 0, 1, 0, 0);
    scaledCtx.drawImage(ctx.canvas, crop.left, crop.top, crop.width, crop.height, 0, 0, size.width, size.height);
    const sx = size.width / crop.width;
    const sy = size.height / crop.height;
    scaledCtx.setTransform(sx, 0, 0, sy, -crop.left * sx, -crop.top * sy);
    drawOverlays(scaledCtx, options.overlays, frame.timestamp);
    return scaledCtx.getImageData(0, 0, size.width, size.height);
  };
}
