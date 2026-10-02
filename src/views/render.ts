import m from "mithril";
import { App, Frame, Recording, RenderOptions } from "../gifcap";
import Button from "../components/button";
import View from "../components/view";
import { CAPTURE_FPS, outputSize } from "../settings";

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

interface RenderViewAttrs {
  readonly app: App;
  readonly recording: Recording;
  readonly renderOptions: RenderOptions;
}

export default class RenderView implements m.ClassComponent<RenderViewAttrs> {
  private readonly app: App;
  private readonly recording: Recording;
  private readonly renderOptions: RenderOptions;
  private readonly width: number;
  private readonly height: number;

  private progress = 0;
  private _onbeforeremove: Function | undefined;

  constructor(vnode: m.CVnode<RenderViewAttrs>) {
    this.app = vnode.attrs.app;
    this.recording = vnode.attrs.recording;
    this.renderOptions = vnode.attrs.renderOptions;
    const size = outputSize(this.renderOptions.crop, this.renderOptions.scale);
    this.width = size.width;
    this.height = size.height;
  }

  async oncreate(vnode: m.VnodeDOM<RenderViewAttrs, this>) {
    const gif = new GifEncoder({
      width: this.width,
      height: this.height,
      colors: this.renderOptions.colors,
      loss: this.renderOptions.loss,
    });

    gif.on("progress", (progress) => {
      this.progress = progress;
      m.redraw();
    });

    gif.once("finished", (blob) => {
      const url = URL.createObjectURL(blob);
      const duration =
        this.recording.frames[this.renderOptions.trim.end].timestamp -
        this.recording.frames[this.renderOptions.trim.start].timestamp +
        this.app.frameLength;

      this.app.finishRendering({ blob, url, duration, size: blob.size, width: this.width, height: this.height });
    });

    const canvases = vnode.dom.getElementsByTagName("canvas");
    const ctx = canvases[0].getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    const scaledCtx = canvases[1].getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    scaledCtx.imageSmoothingQuality = "high";

    const frames = this.recording.frames;
    const indexes = selectFrames(
      frames,
      this.renderOptions.trim.start,
      this.renderOptions.trim.end,
      this.renderOptions.fps
    );
    const endTimestamp = frames[this.renderOptions.trim.end].timestamp + this.app.frameLength;

    const processFrame = (i: number) => {
      if (i >= indexes.length) {
        this._onbeforeremove = () => gif.abort();
        gif.render();
        return;
      }

      const frame = frames[indexes[i]];
      let imageData = frame.imageData;

      // we always copy the imagedata, because the user might want to
      // go back to edit, and we can't afford to lose frames which
      // were moved to web workers
      ctx.putImageData(imageData, 0, 0);

      if (this.renderOptions.scale === 1) {
        imageData = ctx.getImageData(
          this.renderOptions.crop.left,
          this.renderOptions.crop.top,
          this.renderOptions.crop.width,
          this.renderOptions.crop.height
        );
      } else {
        // putImageData ignores transforms, so scale by drawing onto a second canvas
        scaledCtx.drawImage(
          canvases[0],
          this.renderOptions.crop.left,
          this.renderOptions.crop.top,
          this.renderOptions.crop.width,
          this.renderOptions.crop.height,
          0,
          0,
          this.width,
          this.height
        );
        imageData = scaledCtx.getImageData(0, 0, this.width, this.height);
      }

      // each kept frame lasts until the next kept one; the last lasts until the end of the trim range
      const delay = (i < indexes.length - 1 ? frames[indexes[i + 1]].timestamp : endTimestamp) - frame.timestamp;
      gif.addFrame(imageData, delay);
      setTimeout(() => processFrame(i + 1), 0);
    };

    processFrame(0);
  }

  view() {
    const actions = [
      m(Button, {
        label: "Cancel",
        icon: "square-fill",
        onclick: () => this.app.cancelRendering(),
      }),
    ];

    return [
      m(View, { actions }, [
        m(
          "progress",
          { max: "1", value: this.progress, title: "Rendering..." },
          `Rendering: ${Math.floor(this.progress * 100)}%`
        ),
        m("canvas.hidden", {
          width: this.recording.width,
          height: this.recording.height
        }),
        m("canvas.hidden", { width: this.width, height: this.height }),
      ]),
    ];
  }

  onbeforeremove(): void {
    this._onbeforeremove && this._onbeforeremove();
  }
}
