import { Video } from "./gifcap";

function pad(value: number, digits: number): string {
  return String(value).padStart(digits, "0");
}

export function downloadName(extension: string): string {
  const now = new Date();
  return `Recording ${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)} at ${pad(
    now.getHours(),
    2
  )}.${pad(now.getMinutes(), 2)}.${pad(now.getSeconds(), 2)}.${extension}`;
}

export function videoDownloadName(video: Video): string {
  return downloadName(video.mimeType.startsWith("video/mp4") ? "mp4" : "webm");
}
