import m from "mithril";
import { App, Recording, RenderOptions } from "../gifcap";
import Button from "../components/button";
import View from "../components/view";
import { createFrameExtractor, outputFrames } from "../pipeline";
import { outputSize } from "../settings";

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

  async oncreate() {
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

    const frames = outputFrames(this.recording.frames, this.renderOptions, this.app.frameLength);

    gif.once("finished", (blob) => {
      const url = URL.createObjectURL(blob);
      const duration = frames.reduce((sum, frame) => sum + frame.delay, 0);

      this.app.finishRendering({ blob, url, duration, size: blob.size, width: this.width, height: this.height });
    });

    const extractFrame = createFrameExtractor(this.recording, this.renderOptions);

    const processFrame = (i: number) => {
      if (i >= frames.length) {
        this._onbeforeremove = () => gif.abort();
        gif.render();
        return;
      }

      gif.addFrame(extractFrame(this.recording.frames[frames[i].index]), frames[i].delay);
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
      ]),
    ];
  }

  onbeforeremove(): void {
    this._onbeforeremove && this._onbeforeremove();
  }
}
