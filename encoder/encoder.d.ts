interface GifEncoderEvent {
  progress: number;
  finished: Blob;
}

declare class GifEncoder {
  /** colors: max palette size per frame (2–256, default 256); loss: gifsicle lossy level (default 20) */
  constructor(opts: { width: number; height: number; colors?: number; loss?: number });
  on<E extends keyof GifEncoderEvent>(event: E, fn: (data: GifEncoderEvent[E]) => void): void;
  once<E extends keyof GifEncoderEvent>(event: E, fn: (data: GifEncoderEvent[E]) => void): void;
  addFrame(imageData: ImageData, delay: number): void;
  render(): void;
  abort(): void;
}