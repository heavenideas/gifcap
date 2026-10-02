import m from "mithril";
import { App, Recording, RenderOptions } from "../gifcap";
import Button from "../components/button";
import View from "../components/view";
import { createFrameExtractor, selectFrames } from "../pipeline";
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

    gif.once("finished", (blob) => {
      const url = URL.createObjectURL(blob);
      const duration =
        this.recording.frames[this.renderOptions.trim.end].timestamp -
        this.recording.frames[this.renderOptions.trim.start].timestamp +
        this.app.frameLength;

      this.app.finishRendering({ blob, url, duration, size: blob.size, width: this.width, height: this.height });
    });

    const extractFrame = createFrameExtractor(this.recording, this.renderOptions);

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
      const imageData = extractFrame(frame);

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
      ]),
    ];
  }

  onbeforeremove(): void {
    this._onbeforeremove && this._onbeforeremove();
  }
}
