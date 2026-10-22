// @vitest-environment jsdom
import { describe, expect, it } from "vite-plus/test";

import { captureDrop, filesFromInput, readCapturedDrop } from "../read-drop";

type FakeEntry = FileSystemEntry & { children?: FakeEntry[] };

function fileEntry(name: string): FakeEntry {
  return {
    name,
    isFile: true,
    isDirectory: false,
    file: (resolve: (f: File) => void) => setTimeout(() => resolve(new File([name], name)), 0),
  } as unknown as FakeEntry;
}

/** A directory whose reader hands back its children in batches, then nothing. */
function dirEntry(name: string, children: FakeEntry[], batch = 2): FakeEntry {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let at = 0;
      return {
        readEntries: (resolve: (entries: FileSystemEntry[]) => void) =>
          setTimeout(() => {
            resolve(children.slice(at, at + batch));
            at += batch;
          }, 0),
      };
    },
  } as unknown as FakeEntry;
}

/** A DataTransfer whose items empty themselves after the handler's first await. */
function fakeDrop(entries: FakeEntry[]): DataTransfer {
  let items: { kind: string; webkitGetAsEntry: () => FileSystemEntry }[] = entries.map((e) => ({
    kind: "file",
    webkitGetAsEntry: () => e,
  }));
  void Promise.resolve().then(() => {
    items = [];
  });
  return {
    get items() {
      return items;
    },
    files: [],
  } as unknown as DataTransfer;
}

describe("reading a dropped folder", () => {
  it("reads every batch of every nested folder, entries taken synchronously", async () => {
    const vault = dirEntry("Vault", [
      fileEntry("Plan.canvas"),
      dirEntry("Notes", [
        fileEntry("a.md"),
        fileEntry("b.md"),
        fileEntry("c.md"),
        fileEntry("d.md"),
        fileEntry("e.md"),
      ]),
      fileEntry("x.png"),
      dirEntry(".obsidian", [fileEntry("app.json")]),
      fileEntry("y.png"),
    ]);
    const transfer = fakeDrop([vault]);
    const captured = captureDrop(transfer);
    await Promise.resolve();
    expect(transfer.items).toHaveLength(0);

    const files = await readCapturedDrop(captured);
    expect(files.map((f) => f.path).sort()).toEqual([
      "Vault/Notes/a.md",
      "Vault/Notes/b.md",
      "Vault/Notes/c.md",
      "Vault/Notes/d.md",
      "Vault/Notes/e.md",
      "Vault/Plan.canvas",
      "Vault/x.png",
      "Vault/y.png",
    ]);
  });

  it("keeps a folder picker's relative paths", () => {
    const file = new File(["x"], "a.md");
    Object.defineProperty(file, "webkitRelativePath", { value: "Vault/Notes/a.md" });
    const hidden = new File(["x"], "w.json");
    Object.defineProperty(hidden, "webkitRelativePath", { value: "Vault/.obsidian/w.json" });
    expect(filesFromInput([file, hidden]).map((f) => f.path)).toEqual(["Vault/Notes/a.md"]);
  });
});
