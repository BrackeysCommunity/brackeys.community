/**
 * Which paths in a zipped, dropped or picked vault are its content. Kept
 * apart from `vault-zip.ts` so the editor can filter a dropped folder
 * without loading fflate.
 */

/** Obsidian's settings, its trash, macOS metadata and other dotfiles. */
export function keepVaultPath(path: string): boolean {
  return !path
    .split("/")
    .some(
      (segment) =>
        segment === "__MACOSX" ||
        segment === ".obsidian" ||
        segment === ".trash" ||
        segment.startsWith("."),
    );
}
