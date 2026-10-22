export interface Frame {
  readonly imageData: ImageData;
  readonly timestamp: number;
}

export interface Recording {
  readonly width: number;
  readonly height: number;
  readonly frames: Frame[];
}

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Range {
  start: number;
  end: number;
}

export interface RenderSettings {
  readonly scale: number;
  readonly fps: number;
  readonly colors: number;
  readonly loss: number;
}

// text or a drawing laid over the frames, in recording pixels
export interface Overlay {
  color: string;
  size: number; // font size or brush width
  x: number; // text: top left
  y: number;
  text?: string;
  strokes?: number[][]; // drawing: [x0, y0, x1, y1, …] per stroke
  from: number; // visible while from <= frame timestamp < to (ms)
  to: number;
}

export interface RenderOptions extends RenderSettings {
  readonly trim: Range; // frame indexes
  readonly cuts: Range[]; // removed sections, as timestamps (ms): start <= t < end
  readonly crop: Rect;
  readonly overlays: Overlay[];
}

export interface Gif {
  readonly blob: Blob;
  readonly url: string;
  readonly duration: number;
  readonly size: number;
  readonly width: number;
  readonly height: number;
}

export interface App {
  readonly frameLength: number;
  startRecording(): void;
  stopRecording(recording: Recording): void;
  openFile(file: File): void;
  finishImport(recording: Recording): void;
  cancelImport(): void;
  startRendering(renderOptions: RenderOptions): void;
  finishRendering(gif: Gif): void;
  cancelRendering(): void;
  editGif(): void;
  discardGif(): void;
}
