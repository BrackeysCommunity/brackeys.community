import { zipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";

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

  it("keeps names inside the vault", () => {
    expect(cleanZipPath("Vault\\Notes\\a.md")).toBe("Vault/Notes/a.md");
    expect(cleanZipPath("/abs/a.md")).toBe("abs/a.md");
    expect(cleanZipPath("a/../b.md")).toBeNull();
    expect(cleanZipPath("folder/")).toBeNull();
  });
  it("never lets a path escape the vault", () => {
    for (const bad of ["../x.md", "a/../../x.md", "a//b.md", "a/./../b.md", "..\\x.md"]) {
      expect(cleanZipPath(bad), bad).toBeNull();
    }
    expect(cleanZipPath("C:/x.md")).toBe("C:/x.md");
  });

  it("drops traversal names when unzipping, keeping the rest", () => {
    const zip = zipSync({ "ok.md": enc("ok"), "../evil.md": enc("x"), "dir/": new Uint8Array() });
    const { entries } = unzipVault(zip);
    expect(entries.map((e) => e.path)).toEqual(["ok.md"]);
  });

  it("refuses a zip that isn't one", () => {
    expect(() => unzipVault(enc("not a zip at all, just text"))).toThrow();
  });

  it("an entry whose directory under-declares its size never yields more bytes than declared", () => {
    const zip = zipSync({ "a.md": enc("x".repeat(1_000)) }, { level: 6 });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = 0; i < zip.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 10, true);
    }
    let result: ReturnType<typeof unzipVault> | null = null;
    try {
      result = unzipVault(zip);
    } catch {
      // Refusing is fine too.
    }
    if (result) expect(result.entries[0]!.bytes.length).toBeLessThanOrEqual(1_000);
  });

  it("an empty zip and a junk-only zip import nothing", () => {
    expect(unzipVault(zipSync({})).entries).toEqual([]);
    const junk = unzipVault(zipSync({ ".obsidian/app.json": enc("{}"), "__MACOSX/x": enc("y") }));
    expect(junk.entries).toEqual([]);
    expect(junk.ignored).toBe(2);
  });

  it("zipVault → unzipVault keeps CJK, NFD and space names exactly", () => {
    const names = ["日本語/メモ.md", "Résumé.md".normalize("NFD"), "a b/c d.md"];
    const { entries } = unzipVault(zipVault(names.map((path) => ({ path, bytes: enc(path) }))));
    expect(entries.map((e) => e.path).sort()).toEqual([...names].sort());
  });
});
