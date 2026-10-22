// @vitest-environment jsdom
/**
 * Dropped folders: every batch of every nested directory, entries taken
 * before the first await, junk folders skipped, reader errors surfaced.
 */
import { describe, expect, it } from "vite-plus/test";

import {
  captureDrop,
  filesFromInput,
  hasDirectory,
  readAllEntries,
  readCapturedDrop,
} from "../read-drop";

type Entry = FileSystemEntry;
let readCalls = 0;

function file(name: string): Entry {
  return {
    name,
    isFile: true,
    isDirectory: false,
    file: (resolve: (f: File) => void) => queueMicrotask(() => resolve(new File([name], name))),
  } as unknown as Entry;
}

/** Hands back `batch` children per call, asynchronously, then [] forever. */
function dir(name: string, children: Entry[], batch = 3, fail = false): Entry {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let at = 0;
      return {
        readEntries: (resolve: (e: Entry[]) => void, reject: (e: Error) => void) => {
          readCalls++;
          setTimeout(() => {
            if (fail && at > 0) return reject(new Error("NotReadableError"));
            const out = children.slice(at, at + batch);
            at += batch;
            resolve(out);
          }, 0);
        },
      };
    },
  } as unknown as Entry;
}

/** A DataTransfer whose item list and entries go dead after the current task. */
function dataTransfer(entries: Entry[], files: File[] = []) {
  let alive = true;
  queueMicrotask(() => {
    alive = false;
  });
  return {
    get items() {
      return entries.map((entry) => ({
        kind: "file",
        webkitGetAsEntry: () => (alive ? entry : null),
      }));
    },
    get files() {
      return alive ? files : [];
    },
  } as unknown as DataTransfer;
}

describe("dropped folders", () => {
  it("reads three batches and the empty one in every nested folder", async () => {
    readCalls = 0;
    const leaves = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => file(`${prefix}${i}.md`));
    const tree = dir("Vault", [
      ...leaves("root", 7),
      dir("Notes", [...leaves("n", 8), dir("Deep", leaves("d", 9))]),
      dir(".obsidian", leaves("cfg", 4)),
      dir("__MACOSX", leaves("junk", 2)),
      file(".DS_Store"),
    ]);
    const captured = captureDrop(dataTransfer([tree]));
    // Taken synchronously: the transfer is dead by the time anything awaits.
    await Promise.resolve();
    expect(hasDirectory(captured)).toBe(true);
    const files = await readCapturedDrop(captured);
    const paths = files.map((f) => f.path);
    expect(paths.filter((p) => p.startsWith("Vault/root"))).toHaveLength(7);
    expect(paths.filter((p) => p.startsWith("Vault/Notes/n"))).toHaveLength(8);
    expect(paths.filter((p) => p.startsWith("Vault/Notes/Deep/d"))).toHaveLength(9);
    expect(
      paths.some(
        (p) => p.includes(".obsidian") || p.includes("__MACOSX") || p.endsWith(".DS_Store"),
      ),
    ).toBe(false);
    expect(files).toHaveLength(24);
    // Vault: 11 children → 4 batches + empty; Notes: 9 → 3 + empty; Deep: 9 → 3 + empty.
    // Skipped folders are never opened.
    expect(readCalls).toBe(5 + 4 + 4);
  });

  it("a folder with exactly one batch of children still asks again", async () => {
    readCalls = 0;
    const all = await readAllEntries(
      dir("D", [file("a"), file("b"), file("c")]) as FileSystemDirectoryEntry,
    );
    expect(all).toHaveLength(3);
    expect(readCalls).toBe(2);
  });

  it("an empty folder yields nothing", async () => {
    expect(await readCapturedDrop(captureDrop(dataTransfer([dir("Empty", [])])))).toEqual([]);
  });

  it("a reader error rejects instead of hanging or dropping files silently", async () => {
    const broken = dir("Broken", [file("a"), file("b"), file("c"), file("d")], 2, true);
    await expect(readCapturedDrop(captureDrop(dataTransfer([broken])))).rejects.toThrow(
      /NotReadable/,
    );
  });

  it("takes plain files when the browser has no entries API", async () => {
    const a = new File(["a"], "a.canvas");
    const transfer = { items: [{ kind: "file" }], files: [a] } as unknown as DataTransfer;
    const files = await readCapturedDrop(captureDrop(transfer));
    expect(files).toEqual([{ path: "a.canvas", file: a }]);
  });

  it("mixes a dropped folder with loose files", async () => {
    const captured = captureDrop(dataTransfer([dir("F", [file("x.md")]), file("y.canvas")]));
    const files = await readCapturedDrop(captured);
    expect(files.map((f) => f.path).sort()).toEqual(["F/x.md", "y.canvas"]);
  });

  it("the folder picker drops junk folders by their relative paths", () => {
    const pick = (path: string) => {
      const f = new File(["x"], path.split("/").pop()!);
      Object.defineProperty(f, "webkitRelativePath", { value: path });
      return f;
    };
    const out = filesFromInput([
      pick("V/a.md"),
      pick("V/.obsidian/w.json"),
      pick("V/.trash/b.md"),
      pick("V/sub/c.png"),
    ]);
    expect(out.map((f) => f.path)).toEqual(["V/a.md", "V/sub/c.png"]);
  });
});
