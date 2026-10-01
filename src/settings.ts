import { RenderSettings } from "./gifcap";

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  scale: 1,
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
];

export function renderSettingsFrom(options: RenderSettings | undefined): RenderSettings {
  return options ? { scale: options.scale } : DEFAULT_RENDER_SETTINGS;
}
