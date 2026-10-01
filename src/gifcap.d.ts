export interface Frame {
  readonly imageData: ImageData;
  readonly timestamp: number;
}

export interface Video {
  readonly blob: Blob;
  readonly url: string;
  readonly mimeType: string;
}

export interface Recording {
  readonly width: number;
  readonly height: number;
  readonly frames: Frame[];
  readonly video?: Video;
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
}

export interface RenderOptions extends RenderSettings {
  readonly trim: Range;
  readonly crop: Rect;
}

export interface Gif {
  readonly blob: Blob;
  readonly url: string;
  readonly duration: number;
  readonly size: number;
}

export interface App {
  readonly frameLength: number;
  startRecording(): void;
  stopRecording(recording: Recording): void;
  startRendering(renderOptions: RenderOptions): void;
  finishRendering(gif: Gif): void;
  cancelRendering(): void;
  editGif(): void;
  discardGif(): void;
}
