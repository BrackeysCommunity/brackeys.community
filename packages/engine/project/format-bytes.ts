// The one byte formatter: the export budget, the editor and the site (and the
// services that copy the site's) all format sizes with it.

const MiB = 1024 * 1024;

/** A byte count as people read it, KiB-based as the engine measures: `512 B`, `14 KB`, `2.3 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MiB) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / MiB) * 10) / 10} MB`;
}
