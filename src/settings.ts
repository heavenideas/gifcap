import { Rect, RenderSettings } from "./gifcap";

// frames are captured at this rate; output FPS can only go lower
export const CAPTURE_FPS = 12;

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  scale: 1,
  fps: CAPTURE_FPS,
  colors: 256,
  loss: 20,
};

export interface SettingOption {
  readonly value: number;
  readonly label: string;
}

export interface Setting {
  readonly name: keyof RenderSettings;
  readonly title: string;
  readonly options: SettingOption[];
}

// output size is a free percentage of the crop (keeps the aspect ratio)
export const MIN_SCALE_PERCENT = 1;
export const MAX_SCALE_PERCENT = 100;

// GIF dimensions for a crop at a scale; used by both the editor display and the renderer
export function outputSize(crop: Rect, scale: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(crop.width * scale)),
    height: Math.max(1, Math.round(crop.height * scale)),
  };
}

// dropdown settings; first option of each must match its default
export const SETTINGS: Setting[] = [
  {
    name: "fps",
    title: "Frames per second",
    options: [
      { value: CAPTURE_FPS, label: `${CAPTURE_FPS} FPS` },
      { value: 10, label: "10 FPS" },
      { value: 8, label: "8 FPS" },
      { value: 5, label: "5 FPS" },
    ],
  },
  {
    name: "colors",
    title: "Maximum colors per frame",
    options: [
      { value: 256, label: "256 colors" },
      { value: 128, label: "128 colors" },
      { value: 64, label: "64 colors" },
      { value: 32, label: "32 colors" },
    ],
  },
  {
    name: "loss",
    title: "Lossy compression level: higher is smaller but noisier",
    options: [
      { value: 20, label: "Compression: Normal" },
      { value: 60, label: "Compression: High" },
      { value: 120, label: "Compression: Max" },
    ],
  },
];

export function renderSettingsFrom(options: RenderSettings | undefined): RenderSettings {
  return options
    ? { scale: options.scale, fps: options.fps, colors: options.colors, loss: options.loss }
    : DEFAULT_RENDER_SETTINGS;
}
