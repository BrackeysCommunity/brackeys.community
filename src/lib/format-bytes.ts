// Sizes and counts as people read them. Import-free, so the services that
// copy it need nothing else.

/** KiB-based, as the engine measures: "512 B", "32 KB", "1.4 MB", "256 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** A whole count with thousands separators: "2,000". */
export function formatCount(count: number): string {
  return Math.round(count).toLocaleString("en-US");
}
