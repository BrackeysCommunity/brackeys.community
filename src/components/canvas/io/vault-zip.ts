/**
 * Vault zips in and out, with fflate's synchronous API: this runs inside
 * the `canvas-io` worker already, and fflate's async API would start
 * workers of its own.
 */
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";

import { CANVAS_IMPORT_LIMITS } from "@/lib/canvas/limits";
import { pathKind } from "@/lib/canvas/paths";

import { checkEntryLimits, refusal, type VaultEntry } from "./vault-import";
import { keepVaultPath } from "./vault-paths";

/** A zip's name as a vault path, or null for one that could escape the vault. */
export function cleanZipPath(name: string): string | null {
  const path = name.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!path || path.endsWith("/")) return null;
  if (path.split("/").some((s) => s === ".." || s === "")) return null;
  return path;
}

export interface UnzippedVault {
  entries: VaultEntry[];
  /** Files left out: Obsidian's settings, the trash, macOS metadata, dotfiles, unsafe names. */
  ignored: number;
}

/**
 * Unzips a vault. The caps are checked against the zip's own directory
 * before a single byte is inflated, so a zip bomb is refused up front; the
 * real sizes are checked again after, in case the directory lied.
 */
export function unzipVault(zip: Uint8Array): UnzippedVault {
  const L = CANVAS_IMPORT_LIMITS;
  if (zip.length > L.maxZipBytes) throw refusal("maxZipBytes", zip.length, L.maxZipBytes);

  let declared = 0;
  let files = 0;
  let skipped = 0;
  // First pass: read the directory only; returning false inflates nothing.
  unzipSync(zip, {
    filter: (info) => {
      if (info.name.endsWith("/")) return false;
      const path = cleanZipPath(info.name);
      if (!path || !keepVaultPath(path)) {
        skipped++;
        return false;
      }
      files++;
      declared += info.originalSize;
      return false;
    },
  });
  checkEntryLimits(files, declared);

  const inflated = unzipSync(zip, {
    filter: (info) => {
      const path = cleanZipPath(info.name);
      return path != null && keepVaultPath(path);
    },
  });
  const entries: VaultEntry[] = [];
  let actual = 0;
  for (const [name, bytes] of Object.entries(inflated)) {
    const path = cleanZipPath(name);
    if (!path) continue;
    actual += bytes.length;
    entries.push({ path, bytes });
  }
  checkEntryLimits(entries.length, actual);
  return { entries, ignored: skipped };
}

/** Zips files for a vault: images stored as they are, text compressed. */
export function zipVault(
  files: readonly { path: string; bytes: Uint8Array | string }[],
): Uint8Array {
  const tree: Zippable = {};
  for (const file of files) {
    const bytes = typeof file.bytes === "string" ? strToU8(file.bytes) : file.bytes;
    tree[file.path] = [bytes, { level: pathKind(file.path) === "image" ? 0 : 6 }];
  }
  return zipSync(tree);
}
