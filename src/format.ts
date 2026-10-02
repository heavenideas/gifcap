export function humanSize(size: number): string {
  if (size < 1024) {
    return "1 KB";
  }

  size = Math.round(size / 1024);
  return size < 1024 ? `${size} KB` : `${Math.floor((size / 1024) * 100) / 100} MB`;
}
