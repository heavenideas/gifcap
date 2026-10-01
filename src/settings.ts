import { RenderSettings } from "./gifcap";

// frames are captured at this rate; output FPS can only go lower
export const CAPTURE_FPS = 12;

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  scale: 1,
  fps: CAPTURE_FPS,
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

// first option of each setting must match its default
export const SETTINGS: Setting[] = [
  {
    name: "scale",
    title: "Output size",
    options: [
      { value: 1, label: "Size: 100%" },
      { value: 0.75, label: "Size: 75%" },
      { value: 0.5, label: "Size: 50%" },
      { value: 0.33, label: "Size: 33%" },
    ],
  },
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
];

export function renderSettingsFrom(options: RenderSettings | undefined): RenderSettings {
  return options ? { scale: options.scale, fps: options.fps } : DEFAULT_RENDER_SETTINGS;
}
