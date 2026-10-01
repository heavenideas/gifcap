import m from "mithril";
import { App, Recording, RenderOptions } from "../gifcap";
import Button from "../components/button";
import View from "../components/view";

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
    this.width = Math.max(1, Math.round(this.renderOptions.crop.width * this.renderOptions.scale));
    this.height = Math.max(1, Math.round(this.renderOptions.crop.height * this.renderOptions.scale));
  }

  async oncreate(vnode: m.VnodeDOM<RenderViewAttrs, this>) {
    const gif = new GifEncoder({
      width: this.width,
      height: this.height,
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

      this.app.finishRendering({ blob, url, duration, size: blob.size });
    });

    const canvases = vnode.dom.getElementsByTagName("canvas");
    const ctx = canvases[0].getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    const scaledCtx = canvases[1].getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    scaledCtx.imageSmoothingQuality = "high";

    const processFrame = (index: number) => {
      if (index > this.renderOptions.trim.end) {
        this._onbeforeremove = () => gif.abort();
        gif.render();
        return;
      }

      const frame = this.recording.frames[index];
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

      const delay =
        index < this.renderOptions.trim.end
          ? this.recording.frames[index + 1].timestamp - frame.timestamp
          : this.app.frameLength;
      gif.addFrame(imageData, delay);
      setTimeout(() => processFrame(index + 1), 0);
    };

    processFrame(this.renderOptions.trim.start);
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
