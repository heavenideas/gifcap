import m from "mithril";
import { App, Frame, Overlay, Recording, Rect, Range, RenderOptions, RenderSettings } from "../gifcap";
import Button from "../components/button";
import Icon from "../components/icon";
import { Estimate, estimateSize, EstimateToken } from "../estimate";
import { humanSize } from "../format";
import { drawOverlays, outputFrames, overlayFont } from "../pipeline";
import {
  DEFAULT_RENDER_SETTINGS,
  MAX_SCALE_PERCENT,
  MIN_SCALE_PERCENT,
  outputSize,
  renderSettingsFrom,
  SETTINGS,
} from "../settings";

// wait this long after the last change before estimating the file size
const ESTIMATE_DELAY = 500;

const COLORS = ["#ffffff", "#000000", "#e53935", "#fdd835", "#43a047", "#1e88e5"];

// small / medium / large, as a fraction of the recording height
const TEXT_SIZES = [0.04, 0.07, 0.12];
const BRUSH_SIZES = [0.006, 0.012, 0.024];

type Tool = "crop" | "text" | "draw";

// the parts of `range` not covered by `cuts`
function keptSegments(range: Range, cuts: Range[]): Range[] {
  let segments = [range];

  for (const cut of cuts) {
    segments = segments
      .flatMap((s) => [
        { start: s.start, end: Math.min(s.end, cut.start) },
        { start: Math.max(s.start, cut.end), end: s.end },
      ])
      .filter((s) => s.end > s.start);
  }

  return segments;
}

function mergeCuts(cuts: Range[]): Range[] {
  const merged: Range[] = [];

  for (const cut of [...cuts].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];

    if (last && cut.start <= last.end) {
      last.end = Math.max(last.end, cut.end);
    } else {
      merged.push({ ...cut });
    }
  }

  return merged;
}

function drag(onMove: (event: MouseEvent) => void, onUp: () => void): void {
  const up = () => {
    document.body.removeEventListener("mousemove", onMove);
    document.body.removeEventListener("mouseup", up);
    onUp();
    m.redraw();
  };

  document.body.addEventListener("mousemove", onMove);
  document.body.addEventListener("mouseup", up);
}

function isDefault(settings: RenderSettings): boolean {
  return (Object.keys(DEFAULT_RENDER_SETTINGS) as (keyof RenderSettings)[]).every(
    (key) => settings[key] === DEFAULT_RENDER_SETTINGS[key],
  );
}

function formatPercent(scale: number): string {
  return String(Math.round(scale * 10000) / 100);
}

interface Viewport extends Rect {
  scale: number;
}

interface Point {
  x: number;
  y: number;
}

interface Playback {
  head: number;
  start: number;
  end: number;
  offset: number;
  disposable: Function;
}

export function getFrameIndex(frames: Frame[], timestamp: number, start = 0, end = frames.length - 1): number {
  const gap = end - start;

  if (gap === 0) {
    return start;
  } else if (gap === 1) {
    return timestamp < frames[end].timestamp ? start : end;
  }

  const mid = Math.floor((end + start) / 2);
  const midTimestamp = frames[mid].timestamp;

  if (timestamp === midTimestamp) {
    return mid;
  }

  return timestamp < midTimestamp
    ? getFrameIndex(frames, timestamp, start, mid)
    : getFrameIndex(frames, timestamp, mid, end);
}

const noop = () => null;
const dpr = window.devicePixelRatio || 1;

interface PreviewViewAttrs {
  readonly app: App;
  readonly recording: Recording;
  readonly renderOptions?: RenderOptions;
}

export default class PreviewView implements m.ClassComponent<PreviewViewAttrs> {
  private readonly app: App;
  private readonly recording: Recording;
  private readonly duration: number;

  private sourceCanvas!: HTMLCanvasElement;
  private sourceCtx!: CanvasRenderingContext2D;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private matrix!: DOMMatrix;

  private playbar!: HTMLDivElement;
  private content!: HTMLDivElement;
  private viewportDisposable!: Function;

  private mouse: Point;
  private viewport: Viewport;
  private initialScale!: number;
  private playback: Playback;
  private trim: Range;
  private cuts: Range[]; // removed sections (ms), merged and sorted
  private cutStart: number | undefined; // where a cut in progress starts (ms)
  private crop: Rect;
  private overlays: Overlay[];
  private selected: Overlay | undefined;
  private tool: Tool = "crop";
  private color = COLORS[0];
  private sizeIndex = 1;
  private focusText = false;
  private settings: RenderSettings;
  private scaleText: string; // what's in the size box, which may be mid-edit or invalid

  private estimate: Estimate | undefined;
  private estimating = false;
  private baseline: Estimate | undefined; // same trim and crop at default settings, for the saving
  private baselineKey = "";
  private estimateToken: EstimateToken | undefined;
  private estimateTimeout: number | undefined;

  private didDraw = false;
  private didResize = false;

  constructor(vnode: m.CVnode<PreviewViewAttrs>) {
    this.app = vnode.attrs.app;
    this.recording = vnode.attrs.recording;
    this.duration = this.recording.frames[this.recording.frames.length - 1].timestamp + this.app.frameLength;
    this.mouse = { x: 0, y: 0 };
    this.viewport = { width: 0, height: 0, top: 0, left: 0, scale: 1 };

    const trimStart = vnode.attrs.renderOptions
      ? this.recording.frames[vnode.attrs.renderOptions.trim.start].timestamp
      : 0;
    const trimEnd = vnode.attrs.renderOptions
      ? this.recording.frames[vnode.attrs.renderOptions.trim.end].timestamp
      : this.duration;

    this.playback = { head: trimStart, start: trimStart, offset: 0, end: trimEnd, disposable: noop };
    this.trim = { start: trimStart, end: trimEnd };
    this.crop = vnode.attrs.renderOptions?.crop ?? {
      top: 0,
      left: 0,
      width: this.recording.width,
      height: this.recording.height,
    };
    this.cuts = vnode.attrs.renderOptions?.cuts ?? [];
    this.overlays = vnode.attrs.renderOptions?.overlays ?? [];
    this.settings = renderSettingsFrom(vnode.attrs.renderOptions);
    this.scaleText = formatPercent(this.settings.scale);
  }

  private get isPlaying() {
    return this.playback.disposable !== noop;
  }

  async oncreate(vnode: m.VnodeDOM<PreviewViewAttrs, this>) {
    this.sourceCanvas = vnode.dom.querySelector("canvas.source")!;
    this.sourceCtx = this.sourceCanvas.getContext("2d")!;
    this.canvas = vnode.dom.querySelector("canvas.target")!;
    this.ctx = this.canvas.getContext("2d")!;
    this.matrix = this.ctx.getTransform();
    this.playbar = vnode.dom.querySelector(".playbar")!;
    this.content = vnode.dom.querySelector(".content")!;

    // the picture area also resizes when timeline rows or tool controls come and go
    const observer = new ResizeObserver(() => this.onDidResize());
    observer.observe(this.content);
    this.viewportDisposable = () => observer.disconnect();
    this.onDidResize();
    this.zoomToFit();

    setTimeout(() => this.play());
    this.scheduleEstimate();
  }

  private zoomToFit() {
    this.viewport.top = (this.recording.height - this.viewport.height * dpr) / -2;
    this.viewport.left = (this.recording.width - this.viewport.width * dpr) / -2;
    this.initialScale = Math.max(
      0.1,
      Math.min(
        1,
        (this.viewport.width * dpr * 0.95) / this.recording.width,
        (this.viewport.height * dpr * 0.95) / this.recording.height,
      ),
    );
  }

  private onDidResize() {
    const width = Math.floor(this.content.clientWidth);
    const height = Math.floor(this.content.clientHeight);
    this.viewport.left += Math.round((width - this.viewport.width) / this.viewport.scale / 2);
    this.viewport.top += Math.round((height - this.viewport.height) / this.viewport.scale / 2);
    this.viewport.width = width;
    this.viewport.height = height;
    this.didResize = true;
    m.redraw();
  }

  onbeforeremove() {
    this.pause();
    this.viewportDisposable();
    clearTimeout(this.estimateTimeout);
    this.estimateToken && this.estimateToken.cancel();
  }

  view() {
    return m("section.view.editor", [
      m(".tools", this.tools()),
      m(
        "section.content.crop",
        {
          class: `tool-${this.tool}`,
          onmousemove: (e: MouseEvent) => this.onMouseMove(e),
          onmousedown: (e: MouseEvent) => this.onMouseDown(e),
          oncontextmenu: (e: MouseEvent) => e.preventDefault(),
        },
        [
          m("canvas", {
            class: "source",
            width: this.recording.width,
            height: this.recording.height,
          }),
          m("canvas", {
            class: "target",
            width: Math.floor(this.viewport.width * dpr),
            height: Math.floor(this.viewport.height * dpr),
            onwheel: (e: WheelEvent) => this.onContentWheel(e),
          }),
        ],
      ),
      m("aside.output", this.output()),
      m(".timeline", this.timeline()),
    ]);
  }

  private timeline(): m.Children {
    const percent = (t: number) => `${(t * 100) / this.duration}%`;
    const seconds = (t: number) => `${(t / 1000).toFixed(1)} s`;

    return [
      m(".timeline-controls", [
        m(Button, {
          title: this.isPlaying ? "Pause" : "Play",
          iconset: "material",
          icon: this.isPlaying ? "pause" : "play",
          primary: true,
          onclick: () => this.togglePlayPause(),
        }),
        m("span.time", `${seconds(this.playback.head)} / ${seconds(this.duration)}`),
        m(Button, {
          label: this.cutStart === undefined ? "Cut from here" : "Cut to here",
          icon: "",
          title: "Remove a section: click at its start, move to its end, click again",
          onclick: () => this.cut(),
        }),
        m(
          "span.hint",
          this.cutStart === undefined
            ? "Drag the red handles to trim. Click a striped section to restore it."
            : "Now move to where the cut should end and click Cut to here (or click again here to cancel).",
        ),
      ]),
      m(".track", [
        m("span.track-label", "Clip"),
        m(".playbar", [
          m("input", {
            type: "range",
            min: 0,
            max: `${this.duration}`,
            value: `${this.playback.head}`,
            disabled: this.isPlaying,
            oninput: (e: InputEvent) => this.onPlaybarInput(e),
          }),
          m(
            ".trim-bar",
            { style: { left: percent(this.trim.start), width: percent(this.trim.end - this.trim.start) } },
            [
              m(".trim-start", { onmousedown: (e: MouseEvent) => this.onTrimMouseDown("start", e) }),
              m(".trim-end", { onmousedown: (e: MouseEvent) => this.onTrimMouseDown("end", e) }),
            ],
          ),
          this.cuts.map((cut) =>
            m(".cut", {
              style: { left: percent(cut.start), width: percent(cut.end - cut.start) },
              title: "Cut out; click to restore",
              onclick: () => this.setCuts(this.cuts.filter((c) => c !== cut)),
            }),
          ),
          this.cutStart !== undefined && m(".cut-start", { style: { left: percent(this.cutStart) } }),
        ]),
      ]),
      m(
        ".lanes",
        this.overlays.length === 0
          ? m("p.hint", "Text and drawings you add get a row here: drag the ends of their bar to set when they show.")
          : this.overlays.map((overlay) =>
              m(".track", { class: overlay === this.selected ? "selected" : "" }, [
                m("button.track-label", { title: "Select", onclick: () => this.select(overlay) }, [
                  m(Icon, {
                    name: overlay.text !== undefined ? "octicons/typography" : "octicons/paintbrush",
                    size: 14,
                    color: "#333333",
                  }),
                  overlay.text ?? "Drawing",
                ]),
                m(".lane", [
                  m(
                    ".lane-bar",
                    {
                      style: {
                        left: percent(overlay.from),
                        width: percent(overlay.to - overlay.from),
                        background: overlay.color,
                      },
                      title: "Shown during this part; drag the ends to change",
                      onmousedown: (e: MouseEvent) => {
                        e.preventDefault();
                        this.select(overlay);
                      },
                    },
                    [
                      m(".lane-start", { onmousedown: (e: MouseEvent) => this.onLaneMouseDown(overlay, "from", e) }),
                      m(".lane-end", { onmousedown: (e: MouseEvent) => this.onLaneMouseDown(overlay, "to", e) }),
                    ],
                  ),
                  m(".playhead", { style: { left: percent(this.playback.head) } }),
                ]),
              ]),
            ),
      ),
    ];
  }

  private output(): m.Children {
    return [
      m("h4", "Output"),
      this.sizeSetting(),
      SETTINGS.map((setting) =>
        m("label.field", { title: setting.title }, [
          setting.label,
          m(
            "select",
            {
              name: setting.name,
              onchange: (e: Event) => {
                this.settings = { ...this.settings, [setting.name]: Number((e.target as HTMLSelectElement).value) };
                this.scheduleEstimate();
              },
            },
            setting.options.map((option) =>
              m(
                "option",
                { value: option.value, selected: option.value === this.settings[setting.name] },
                option.label,
              ),
            ),
          ),
        ]),
      ),
      m(
        ".field",
        {
          title:
            "Estimated GIF file size" +
            (this.estimate && !this.estimate.exact ? ", from a sample of frames" : "") +
            ". The percentage is the saving versus 100% size, 12 FPS, 256 colors and Normal compression.",
        },
        ["File size", m("span.estimate", this.estimateLabel())],
      ),
      m(Button, { label: "Render", icon: "gear", onclick: () => this.startRendering(), primary: true }),
      m(Button, { label: "Discard", icon: "trashcan", onclick: () => this.app.discardGif() }),
    ];
  }

  // drags when a text or drawing starts or stops showing, previewing that moment
  private onLaneMouseDown(overlay: Overlay, edge: "from" | "to", event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.pause();
    this.select(overlay);

    const width = this.playbar.clientWidth;
    const startX = event.screenX;
    const start = overlay[edge];

    drag(
      (e) => {
        const t = start + ((e.screenX - startX) * this.duration) / width;
        overlay[edge] =
          edge === "from"
            ? Math.max(0, Math.min(overlay.to - this.app.frameLength, t))
            : Math.max(overlay.from + this.app.frameLength, Math.min(this.duration, t));
        this.playback.head = edge === "from" ? overlay.from : overlay.to - 1;
        m.redraw();
      },
      () => this.scheduleEstimate(),
    );
  }

  private tools(): m.Children {
    const toolButton = (tool: Tool, icon: string, label: string) =>
      m(Button, { icon, label, primary: this.tool === tool, onclick: () => this.setTool(tool) });
    const selected = this.selected;
    const focus = (vnode: m.VnodeDOM) => {
      if (this.focusText) {
        this.focusText = false;
        (vnode.dom as HTMLInputElement).focus();
        (vnode.dom as HTMLInputElement).select();
      }
    };
    const hints = {
      crop: "Drag over the picture to crop. Scroll to zoom, right-drag to pan.",
      text: "Click to add text, drag text to move it.",
      draw: "Drag to draw. Strokes made one after another form one drawing.",
    };

    return [
      toolButton("crop", "screen-full", "Crop"),
      toolButton("text", "typography", "Text"),
      toolButton("draw", "paintbrush", "Draw"),
      this.tool !== "crop" && [
        COLORS.map((color) =>
          m("button.swatch", {
            class: color === this.color ? "active" : "",
            style: { background: color },
            title: "Color",
            onclick: () => this.setColor(color),
          }),
        ),
        m(
          "select",
          { title: "Size", onchange: (e: Event) => this.setSize(Number((e.target as HTMLSelectElement).value)) },
          ["Small", "Medium", "Large"].map((label, i) =>
            m("option", { value: i, selected: i === this.sizeIndex }, label),
          ),
        ),
      ],
      selected &&
        selected.text !== undefined &&
        m("input.overlay-text", {
          style: { width: "14em" }, // chota's input rules outrank class selectors
          value: selected.text,
          oncreate: focus,
          onupdate: focus,
          oninput: (e: InputEvent) => this.changed(() => (selected.text = (e.target as HTMLInputElement).value)),
        }),
      selected &&
        selected.strokes &&
        m(Button, { icon: "undo", title: "Undo last stroke", onclick: () => this.undoStroke() }),
      selected && m(Button, { icon: "x", title: "Delete", onclick: () => this.removeOverlay(selected) }),
      m("span.hint", hints[this.tool]),
    ];
  }

  // applies an edit to overlays, then updates the size estimate
  private changed(edit: () => void): void {
    edit();
    this.scheduleEstimate();
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.selected = undefined; // the next text or drawing starts fresh
  }

  private select(overlay: Overlay): void {
    this.selected = overlay;
    this.tool = overlay.text !== undefined ? "text" : "draw";

    if (this.playback.head < overlay.from || this.playback.head >= overlay.to) {
      this.pause();
      this.playback.head = overlay.from;
    }
  }

  private overlaySize(text: boolean): number {
    return Math.max(2, Math.round((text ? TEXT_SIZES : BRUSH_SIZES)[this.sizeIndex] * this.recording.height));
  }

  private setColor(color: string): void {
    this.color = color;
    const selected = this.selected;
    selected && this.changed(() => (selected.color = color));
  }

  private setSize(index: number): void {
    this.sizeIndex = index;
    const selected = this.selected;
    selected && this.changed(() => (selected.size = this.overlaySize(selected.text !== undefined)));
  }

  private undoStroke(): void {
    const selected = this.selected!;
    this.changed(() => selected.strokes!.pop());

    if (selected.strokes!.length === 0) {
      this.removeOverlay(selected);
    }
  }

  private removeOverlay(overlay: Overlay): void {
    this.changed(() => (this.overlays = this.overlays.filter((o) => o !== overlay)));
    this.selected = undefined;
  }

  private cut(): void {
    const head = this.playback.head;

    if (this.cutStart === undefined) {
      this.cutStart = head;
      return;
    }

    const cut = { start: Math.min(this.cutStart, head), end: Math.max(this.cutStart, head) };
    const cuts = mergeCuts([...this.cuts, cut]);
    this.cutStart = undefined;

    // clicking twice in place cancels; never cut away everything
    if (cut.end - cut.start >= this.app.frameLength && keptSegments(this.trim, cuts).length > 0) {
      this.setCuts(cuts);
    }
  }

  private setCuts(cuts: Range[]): void {
    this.cuts = cuts;

    if (this.isPlaying) {
      this.play(); // pick up the new sections
    }

    this.scheduleEstimate();
  }

  private sizeSetting(): m.Children {
    const size = outputSize(this.crop, this.settings.scale);

    return m("label.field", { title: "Output size as a percentage of the cropped area; keeps the aspect ratio" }, [
      "Size",
      m(".size-input", [
        m("input", {
          type: "number",
          name: "scale",
          style: { width: "6em" }, // chota's input rules outrank class selectors
          min: MIN_SCALE_PERCENT,
          max: MAX_SCALE_PERCENT,
          step: 1,
          value: this.scaleText,
          class: this.isScaleTextValid() ? "" : "invalid",
          oninput: (e: InputEvent) => this.onScaleInput((e.target as HTMLInputElement).value),
          onblur: () => (this.scaleText = formatPercent(this.settings.scale)),
        }),
        "%",
        m("span.output-size", `${size.width} × ${size.height}`),
      ]),
    ]);
  }

  private isScaleTextValid(): boolean {
    const percent = Number(this.scaleText);
    return this.scaleText.trim() !== "" && percent >= MIN_SCALE_PERCENT && percent <= MAX_SCALE_PERCENT;
  }

  // keeps the last valid size while the box is empty or out of range; blur restores it
  private onScaleInput(text: string): void {
    this.scaleText = text;

    if (this.isScaleTextValid() && Number(text) / 100 !== this.settings.scale) {
      this.settings = { ...this.settings, scale: Number(text) / 100 };
      this.scheduleEstimate();
    }
  }

  private estimateLabel(): string {
    if (this.estimating || !this.estimate) {
      return "Estimating size…";
    } else if (this.estimate.bytes === 0) {
      return "Nothing left to render";
    }

    const size = `${this.estimate.exact ? "" : "≈ "}${humanSize(this.estimate.bytes)}`;
    const saving = this.baseline ? Math.round((1 - this.estimate.bytes / this.baseline.bytes) * 100) : 0;
    return saving >= 1 && !isDefault(this.settings) ? `${size} (−${saving}%)` : size;
  }

  // (re)starts the file size estimate shortly after the last change, cancelling any in progress
  private scheduleEstimate(): void {
    clearTimeout(this.estimateTimeout);
    this.estimateToken && this.estimateToken.cancel();
    this.estimating = true;
    this.estimateTimeout = window.setTimeout(() => this.runEstimate(), ESTIMATE_DELAY);
  }

  private async runEstimate(): Promise<void> {
    const token = new EstimateToken();
    this.estimateToken = token;

    const options = this.renderOptions(this.settings);
    const estimate = await estimateSize(this.recording, options, this.app.frameLength, token);

    if (!estimate || token.cancelled) {
      return;
    }

    this.estimate = estimate;
    this.estimating = false;
    m.redraw();

    const baselineKey = JSON.stringify([options.trim, options.cuts, options.crop, options.overlays]);

    if (baselineKey !== this.baselineKey) {
      this.baseline = undefined;
      const baseline = isDefault(this.settings)
        ? estimate
        : await estimateSize(this.recording, this.renderOptions(DEFAULT_RENDER_SETTINGS), this.app.frameLength, token);

      if (!baseline || token.cancelled) {
        return;
      }

      this.baseline = baseline;
      this.baselineKey = baselineKey;
      m.redraw();
    }
  }

  onTrimMouseDown(handle: "start" | "end", event: MouseEvent) {
    event.preventDefault();

    const wasPlaying = this.isPlaying;
    const head = this.playback.head;
    this.pause();

    const start = {
      width: this.playbar.clientWidth,
      screenX: event.screenX,
      head: handle === "start" ? this.trim.start : this.trim.end,
      min: handle === "start" ? 0 : this.trim.start + this.app.frameLength,
      max: handle === "start" ? this.trim.end - this.app.frameLength : this.duration,
    };

    const onMouseMove = (e: MouseEvent) => {
      const diff = e.screenX - start.screenX;
      const head = start.head + Math.round((diff * this.duration) / start.width);
      this.playback.head = head;
      this.trim[handle] = Math.max(start.min, Math.min(start.max, head));

      m.redraw();
    };

    const onMouseUp = () => {
      document.body.removeEventListener("mousemove", onMouseMove);
      document.body.removeEventListener("mouseup", onMouseUp);

      this.playback.start = this.trim.start;
      this.playback.end = this.trim.end;

      if (wasPlaying) {
        this.playback.head = this.trim.start;
        this.play();
      } else {
        this.playback.head = Math.max(this.playback.start, Math.min(this.playback.end, head));
      }

      this.scheduleEstimate();
      m.redraw();
    };

    document.body.addEventListener("mousemove", onMouseMove);
    document.body.addEventListener("mouseup", onMouseUp);
  }

  onContentWheel(event: WheelEvent) {
    event.preventDefault();

    const scaleDelta = Math.pow(1.1, -event.deltaY / 90);
    this.setScale(this.viewport.scale * scaleDelta, this.mouse);
    this.drawFrame();
  }

  private setScale(
    scale: number,
    reference: Point = { x: this.viewport.width / 2, y: this.viewport.height / 2 },
  ): void {
    scale = Math.max(0.2, Math.min(3, scale));

    const delta = scale / this.viewport.scale;
    const M = this.matrix.inverse();
    const mouse = M.transformPoint({ x: reference.x * dpr, y: reference.y * dpr });

    this.ctx.translate(mouse.x, mouse.y);
    this.ctx.scale(delta, delta);
    this.ctx.translate(-mouse.x, -mouse.y);

    this.matrix = this.ctx.getTransform();
    this.viewport.scale = scale;
  }

  private onMouseMove(event: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = event.clientX - rect.left;
    this.mouse.y = event.clientY - rect.top;
  }

  private onMouseDown(event: MouseEvent) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) {
      this.onViewportMove(event);
    } else if (this.tool === "text") {
      this.onText(event);
    } else if (this.tool === "draw") {
      this.onDraw(event);
    } else {
      this.onCrop(event);
    }
  }

  // the canvas no longer starts at the page's top left, so measure from the canvas itself
  private canvasPoint(event: MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * dpr, y: (event.clientY - rect.top) * dpr };
  }

  private recordingPoint(event: MouseEvent): Point {
    const p = this.matrix.inverse().transformPoint(this.canvasPoint(event));
    return { x: p.x - this.viewport.left, y: p.y - this.viewport.top };
  }

  private isVisible(overlay: Overlay): boolean {
    return this.playback.head >= overlay.from && this.playback.head < overlay.to;
  }

  // click a visible text to select and drag it, or anywhere else to add one
  private onText(event: MouseEvent) {
    event.preventDefault();
    this.pause();

    const start = this.recordingPoint(event);
    const hit = this.overlays.find((o) => {
      if (o.text === undefined || !this.isVisible(o)) {
        return false;
      }

      this.ctx.font = overlayFont(o.size);
      const width = this.ctx.measureText(o.text).width;
      return start.x >= o.x && start.x <= o.x + width && start.y >= o.y && start.y <= o.y + o.size;
    });

    const overlay = hit ?? {
      text: "Text",
      color: this.color,
      size: this.overlaySize(true),
      x: start.x,
      y: start.y,
      from: this.playback.head,
      to: this.duration,
    };

    if (!hit) {
      this.overlays.push(overlay);
      this.focusText = true;
    }

    this.selected = overlay;
    const origin = { x: overlay.x, y: overlay.y };

    drag(
      (e) => {
        const p = this.recordingPoint(e);
        overlay.x = origin.x + p.x - start.x;
        overlay.y = origin.y + p.y - start.y;
        m.redraw();
      },
      () => this.scheduleEstimate(),
    );
  }

  // strokes go into the selected drawing while it is visible, else into a new one
  private onDraw(event: MouseEvent) {
    event.preventDefault();
    this.pause();

    const p = this.recordingPoint(event);
    let drawing = this.selected;

    if (!drawing || !drawing.strokes || !this.isVisible(drawing)) {
      drawing = {
        strokes: [],
        color: this.color,
        size: this.overlaySize(false),
        x: 0,
        y: 0,
        from: this.playback.head,
        to: this.duration,
      };
      this.overlays.push(drawing);
      this.selected = drawing;
    }

    const stroke = [p.x, p.y];
    drawing.strokes!.push(stroke);

    drag(
      (e) => {
        const q = this.recordingPoint(e);
        stroke.push(q.x, q.y);
        m.redraw();
      },
      () => this.scheduleEstimate(),
    );
  }

  private onCrop(event: MouseEvent) {
    const M = this.matrix.inverse();
    const point = (event: MouseEvent) => {
      const p = M.transformPoint(this.canvasPoint(event));

      return {
        x: Math.max(Math.min(Math.floor(p.x) - this.viewport.left, this.recording.width), 0),
        y: Math.max(Math.min(Math.floor(p.y) - this.viewport.top, this.recording.height), 0),
      };
    };

    const from = point(event);
    let didMove = false;

    const onMouseMove = (event: MouseEvent) => {
      const to = point(event);
      this.crop.top = Math.floor(Math.max(0, Math.min(from.y, to.y)));
      this.crop.left = Math.floor(Math.max(0, Math.min(from.x, to.x)));
      this.crop.width = Math.floor(Math.min(this.recording.width - this.crop.left, Math.abs(from.x - to.x)));
      this.crop.height = Math.floor(Math.min(this.recording.height - this.crop.top, Math.abs(from.y - to.y)));

      didMove = true;
      m.redraw();
    };

    const onMouseUp = (event: MouseEvent) => {
      event.preventDefault();
      document.body.removeEventListener("mousemove", onMouseMove);
      document.body.removeEventListener("mouseup", onMouseUp);

      if (!didMove || this.crop.width < 10 || this.crop.height < 10) {
        this.crop.top = 0;
        this.crop.left = 0;
        this.crop.width = this.recording.width;
        this.crop.height = this.recording.height;
      }

      this.scheduleEstimate();
      m.redraw();
    };

    event.preventDefault();
    document.body.addEventListener("mousemove", onMouseMove);
    document.body.addEventListener("mouseup", onMouseUp);
  }

  private onViewportMove(event: MouseEvent) {
    const M = this.matrix.inverse();
    const point = (event: MouseEvent) => {
      const p = M.transformPoint(this.canvasPoint(event));
      return { x: Math.floor(p.x), y: Math.floor(p.y) };
    };

    const start = {
      top: this.viewport.top,
      left: this.viewport.left,
      point: point(event),
    };

    const onMouseMove = (event: MouseEvent) => {
      const p = point(event);
      this.viewport.top = start.top + p.y - start.point.y;
      this.viewport.left = start.left + p.x - start.point.x;
      m.redraw();
    };

    const onMouseUp = (event: MouseEvent) => {
      event.preventDefault();
      document.body.removeEventListener("mousemove", onMouseMove);
      document.body.removeEventListener("mouseup", onMouseUp);
      m.redraw();
    };

    event.preventDefault();
    document.body.addEventListener("mousemove", onMouseMove);
    document.body.addEventListener("mouseup", onMouseUp);
  }

  onPlaybarInput(event: InputEvent) {
    this.playback.head = (event.target as HTMLInputElement).valueAsNumber;

    const index = getFrameIndex(this.recording.frames, this.playback.head);
    this.ctx.putImageData(this.recording.frames[index].imageData, 0, 0);
  }

  play() {
    this.playback.disposable();
    this.playback.disposable = noop;

    // play only the parts that aren't cut: map between time played and recording time
    const segments = keptSegments({ start: this.playback.start, end: this.playback.end }, this.cuts);
    const total = segments.reduce((sum, s) => sum + s.end - s.start, 0);
    const toPlayed = (t: number) => {
      let played = 0;

      for (const s of segments) {
        if (t < s.end) {
          return played + Math.max(0, t - s.start);
        }

        played += s.end - s.start;
      }

      return 0;
    };
    const fromPlayed = (played: number) => {
      for (const s of segments) {
        if (played < s.end - s.start) {
          return s.start + played;
        }

        played -= s.end - s.start;
      }

      return segments[0].start;
    };

    if (total <= 0) {
      return;
    }

    let handle: number | undefined = undefined;

    this.playback.offset = Date.now() - toPlayed(this.playback.head);

    const draw = () => {
      this.playback.head = fromPlayed((Date.now() - this.playback.offset) % total);

      m.redraw();
      handle = requestAnimationFrame(draw);
    };

    handle = requestAnimationFrame(draw);
    this.playback.disposable = () => cancelAnimationFrame(handle!);
  }

  onupdate(): void {
    if (this.didResize) {
      this.ctx.setTransform(this.matrix);
      this.didResize = false;
    }

    this.drawFrame();
  }

  private drawFrame(): void {
    if (!this.didDraw && this.initialScale !== 1) {
      this.setScale(this.initialScale);
    }

    const index = getFrameIndex(this.recording.frames, this.playback.head);
    this.sourceCtx.putImageData(this.recording.frames[index].imageData, 0, 0);

    const transform = this.ctx.getTransform();
    this.ctx.setTransform();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.setTransform(transform);
    this.ctx.drawImage(this.sourceCanvas, this.viewport.left, this.viewport.top);
    this.ctx.save();
    this.ctx.translate(this.viewport.left, this.viewport.top);
    drawOverlays(this.ctx, this.overlays, this.recording.frames[index].timestamp);
    this.ctx.restore();

    if (
      this.crop.top !== 0 ||
      this.crop.left !== 0 ||
      this.crop.width !== this.recording.width ||
      this.crop.height !== this.recording.height
    ) {
      this.ctx.beginPath();
      this.ctx.moveTo(this.viewport.left, this.viewport.top);
      this.ctx.lineTo(this.viewport.left + this.recording.width, this.viewport.top);
      this.ctx.lineTo(this.viewport.left + this.recording.width, this.viewport.top + this.recording.height);
      this.ctx.lineTo(this.viewport.left, this.viewport.top + this.recording.height);
      this.ctx.lineTo(this.viewport.left, this.viewport.top);
      this.ctx.closePath();
      this.ctx.moveTo(this.viewport.left + this.crop.left, this.viewport.top + this.crop.top);
      this.ctx.lineTo(this.viewport.left + this.crop.left, this.viewport.top + this.crop.top + this.crop.height);
      this.ctx.lineTo(
        this.viewport.left + this.crop.left + this.crop.width,
        this.viewport.top + this.crop.top + this.crop.height,
      );
      this.ctx.lineTo(this.viewport.left + this.crop.left + this.crop.width, this.viewport.top + this.crop.top);
      this.ctx.lineTo(this.viewport.left + this.crop.left, this.viewport.top + this.crop.top);
      this.ctx.closePath();
      this.ctx.fillStyle = "#00000055";
      this.ctx.fill();
    }

    this.didDraw = true;
  }

  pause() {
    this.playback.disposable();
    this.playback.disposable = noop;
  }

  togglePlayPause() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  private renderOptions(settings: RenderSettings): RenderOptions {
    return {
      ...settings,
      trim: {
        start: getFrameIndex(this.recording.frames, this.trim.start),
        end: getFrameIndex(this.recording.frames, this.trim.end),
      },
      cuts: this.cuts,
      crop: { ...this.crop },
      overlays: [...this.overlays],
    };
  }

  private startRendering(): void {
    const options = this.renderOptions(this.settings);

    if (outputFrames(this.recording.frames, options, this.app.frameLength).length === 0) {
      window.alert("Everything is cut out; restore a section first.");
      return;
    }

    this.app.startRendering(options);
  }
}
