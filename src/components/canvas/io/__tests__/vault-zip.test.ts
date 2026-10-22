import { zipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";

import { CANVAS_IMPORT_LIMITS } from "@/lib/canvas/limits";

import { ImportRefusedError } from "../vault-import";
import { cleanZipPath, unzipVault, zipVault } from "../vault-zip";
import { enc, PNG } from "./vault-fixtures";

describe("vault zips", () => {
  it("round-trips files byte for byte", () => {
    const files = [
      { path: "Plan.canvas", bytes: enc('{"nodes":[],"edges":[]}') },
      { path: "Notes/日本語.md", bytes: enc("﻿a\r\nb  \n") },
      { path: "attachments/a.png", bytes: PNG },
    ];
    const { entries, ignored } = unzipVault(zipVault(files));
    expect(ignored).toBe(0);
    expect(entries.sort((a, b) => a.path.localeCompare(b.path))).toEqual(
      [...files].sort((a, b) => a.path.localeCompare(b.path)),
    );
  });

  it("skips macOS metadata, Obsidian's settings and trash, and dotfiles", () => {
    const zip = zipSync({
      "Vault/Plan.canvas": enc("{}"),
      "__MACOSX/Vault/._Plan.canvas": enc("x"),
      "Vault/.obsidian/app.json": enc("{}"),
      "Vault/.trash/old.md": enc("old"),
      "Vault/.DS_Store": enc("x"),
      "Vault/../escape.md": enc("x"),
    });
    const { entries, ignored } = unzipVault(zip);
    expect(entries.map((e) => e.path)).toEqual(["Vault/Plan.canvas"]);
    expect(ignored).toBe(5);
  });

  it("refuses a zip whose directory declares too much, without inflating", () => {
    const zip = zipSync({ "a.md": enc("a"), "b.md": enc("b") }, { level: 0 });
    // Rewrite each central-directory entry's uncompressed size to just over half the cap.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const half = Math.floor(CANVAS_IMPORT_LIMITS.maxUnzippedBytes / 2) + 1;
    for (let i = 0; i < zip.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, half, true);
    }
    expect(() => unzipVault(zip)).toThrow(ImportRefusedError);
    try {
      unzipVault(zip);
    } catch (error) {
      expect((error as ImportRefusedError).limit).toBe("maxUnzippedBytes");
      expect((error as ImportRefusedError).actual).toBe(half * 2);
    }
  });

  it("refuses more files than an import reads", () => {
    const tree: Record<string, Uint8Array> = {};
    for (let i = 0; i <= CANVAS_IMPORT_LIMITS.maxFiles; i++) tree[`n${i}.md`] = new Uint8Array();
    expect(() => unzipVault(zipSync(tree, { level: 0 }))).toThrow(/5,001 files/);
  });

  it("keeps names inside the vault", () => {
    expect(cleanZipPath("Vault\\Notes\\a.md")).toBe("Vault/Notes/a.md");
    expect(cleanZipPath("/abs/a.md")).toBe("abs/a.md");
    expect(cleanZipPath("a/../b.md")).toBeNull();
    expect(cleanZipPath("folder/")).toBeNull();
  });
});
