/**
 * `.canvas` files in Obsidian's own layout that the fixtures don't cover:
 * awkward numbers, Unicode and escapes, CRLF inside a card, long text,
 * unknown keys, odd key orders and empty canvases. Each goes through a
 * `.canvas` import, a server-style store and a vault zip export.
 */
import { describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { docFromState, mergeStates } from "@/lib/canvas/doc-state";
import { docToJsonCanvas } from "@/lib/canvas/json-canvas";

import { runImportJob } from "../canvas-io-jobs";
import { finalizeCanvases, resolveImages } from "../import-flow";
import { buildVaultExport, serializeCanvas } from "../vault-export";
import { unzipVault, zipVault } from "../vault-zip";
import { entry, memoryScope, PNG } from "./vault-fixtures";

vi.mock("@/orpc/client", () => ({ client: {} }));

const EMPTY = Y.encodeStateAsUpdate(new Y.Doc());
const enc = (s: string) => new TextEncoder().encode(s);

/** Exactly how Obsidian writes a canvas: tab-indented, one item per line, no final newline. */
function obsidian(nodes: object[], edges: object[]): string {
  const list = (items: object[]) =>
    items.length ? `[\n${items.map((i) => `\t\t${JSON.stringify(i)}`).join(",\n")}\n\t]` : "[]";
  return `{\n\t"nodes":${list(nodes)},\n\t"edges":${list(edges)}\n}`;
}

async function importCanvas(path: string, text: string) {
  const scope = memoryScope();
  const result = await runImportJob({
    source: { files: [{ path, file: new Blob([enc(text) as Uint8Array<ArrayBuffer>]) }] },
    options: { mode: "new" },
  });
  if (result.kind !== "import") throw new Error("expected an import");
  const images = await resolveImages(result.canvases, result.images, scope.uploader);
  return {
    scope,
    result,
    finals: finalizeCanvases(result.canvases, result.images, images.resolved),
  };
}

const exportState = (state: Uint8Array) =>
  serializeCanvas(docToJsonCanvas(docFromState(mergeStates(EMPTY, state))));

const n = (id: string, extra: object) => ({
  id,
  x: 0,
  y: 0,
  width: 250,
  height: 60,
  ...extra,
});

const CASES: Record<string, string> = {
  "floats and negatives": obsidian(
    [
      {
        id: "a1b2c3d4e5f60718",
        type: "text",
        text: "f",
        x: -12.5,
        y: 0.30000000000000004,
        width: 250.25,
        height: 60,
      },
      {
        id: "a1b2c3d4e5f60719",
        type: "text",
        text: "g",
        x: -999999,
        y: 999999,
        width: 1,
        height: 100000,
      },
    ],
    [],
  ),
  "unicode and escapes": obsidian(
    [
      n("u1", { type: "text", text: 'Ünïcödé 🎮 "quoted" \\ back\tslash\n\nline sep </script>' }),
      n("u2", { type: "text", text: "名前\u0000ctrl\u001f" }),
    ],
    [
      {
        id: "e1",
        fromNode: "u1",
        fromSide: "right",
        toNode: "u2",
        toSide: "left",
        label: "→ émoji 🚀",
      },
    ],
  ),
  "CRLF inside a card": obsidian(
    [n("c1", { type: "text", text: "one\r\ntwo\r\n\r\nthree\rfour" })],
    [],
  ),
  "text past maxCardText": obsidian([n("l1", { type: "text", text: "x".repeat(25_000) })], []),
  "type-first key order and unknown keys": obsidian(
    [
      {
        type: "group",
        id: "g1",
        x: -100,
        y: -100,
        width: 800,
        height: 600,
        label: "Grp",
        background: "Art/bg.png",
        backgroundStyle: "cover",
        color: "#FF00AA",
      },
      {
        type: "link",
        id: "k1",
        url: "https://example.com/?a=1&b=2",
        x: 0,
        y: 0,
        width: 400,
        height: 300,
        styleAttributes: { shape: "pill" },
        custom: [1, { a: null }],
      },
      {
        type: "file",
        id: "f1",
        file: "Notes/Deep/Idea.md",
        subpath: "#Heading two",
        x: 10,
        y: 10,
        width: 400,
        height: 400,
        color: "3",
      },
    ],
    [
      {
        id: "e1",
        fromNode: "k1",
        toNode: "f1",
        toEnd: "none",
        fromEnd: "arrow",
        color: "#00ff00",
        styleAttributes: {},
      },
      { id: "e2", toNode: "k1", fromNode: "f1" },
    ],
  ),
  "nodes but no edges": obsidian([n("only", { type: "text", text: "alone" })], []),
  "empty canvas": obsidian([], []),
};

const IMAGES = obsidian(
  [
    {
      id: "p1",
      type: "file",
      file: "Art/pic.png",
      x: 0,
      y: 0,
      width: 400,
      height: 400,
    },
  ],
  [],
);

describe("Obsidian-layout .canvas files beyond the fixtures", { timeout: 60_000 }, () => {
  it.each(Object.entries(CASES))("%s exports byte for byte after a store", async (_name, text) => {
    const { finals } = await importCanvas("Board.canvas", text);
    expect(finals).toHaveLength(1);
    expect(exportState(finals[0]!.state)).toBe(text);
  });

  it("every case in one vault zip, with a note and an image, comes back byte for byte", async () => {
    const note = "# Idea\r\n\r\nWindows note with CRLF ✓\n";
    const entries = [
      ...Object.values(CASES).map((text, i) => entry(`Vault/Boards/Case ${i}.canvas`, text)),
      entry("Vault/Notes/Deep/Idea.md", note),
      entry("Vault/Boards/Images.canvas", IMAGES),
      entry("Vault/Art/pic.png", PNG),
      entry("Vault/Art/bg.png", PNG),
    ];
    const scope = memoryScope();
    const result = await runImportJob({
      source: { zip: new Blob([zipVault(entries) as Uint8Array<ArrayBuffer>]) },
      options: { mode: "new" },
    });
    if (result.kind !== "import") throw new Error("expected an import");
    const images = await resolveImages(result.canvases, result.images, scope.uploader);
    const finals = finalizeCanvases(result.canvases, result.images, images.resolved);
    expect(finals).toHaveLength(Object.keys(CASES).length + 1);

    const files = new Map<string, Uint8Array>();
    for (const final of finals) {
      const built = buildVaultExport(docFromState(mergeStates(EMPTY, final.state)), {
        canvasPath: final.targetPath,
        attachments: scope.attachments(),
      });
      for (const file of built.files) files.set(file.path, file.bytes ?? scope.bytesAt(file.url!)!);
    }
    // Through a real zip and back, as the member downloads it.
    const unzipped = unzipVault(zipVault([...files].map(([path, bytes]) => entry(path, bytes))));
    const out = new Map(unzipped.entries.map((e) => [e.path, e.bytes]));
    const text = (path: string) => new TextDecoder().decode(out.get(path));

    Object.values(CASES).forEach((source, i) => {
      expect(text(`Boards/Case ${i}.canvas`), `case ${i}`).toBe(source);
    });
    expect(text("Notes/Deep/Idea.md")).toBe(note);
    expect(text("Boards/Images.canvas")).toBe(IMAGES);
    expect([...out.get("Art/pic.png")!]).toEqual([...PNG]);
    // A group's background isn't uploaded: reported, and the group keeps its path.
    expect(out.has("Art/bg.png")).toBe(false);
    expect(result.report.skipped.map((s) => s.reason)).toContain(
      "Group background images aren't uploaded; the group keeps its path.",
    );
  });
});
