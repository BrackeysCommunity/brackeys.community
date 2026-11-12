import { DEFAULT_ZIP_TARGET, exportTarget, exportTargetNames } from "@jams/engine/export";

/** Each target this engine builds, read from its row: whether it is a PWA, whether its files are checked. */
export function targetRows() {
  return {
    rows: exportTargetNames().map((name) => {
      const row = exportTarget(name)!;
      return { name, pwa: row.pwa, layoutChecked: row.layout !== null };
    }),
    // A name `release:v1` reserves but this engine doesn't build has no row.
    desktop: exportTarget("desktop") ?? null,
    zipDefault: DEFAULT_ZIP_TARGET,
  };
}
