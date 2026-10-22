/**
 * `.canvas` files keep Obsidian's own layout (tab-indented, one item per
 * line, its key order) through an import, the server's store, live merges,
 * edits and a vault export.
 */
import { describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { docFromState, mergeStates } from "@/lib/canvas/doc-state";
import {
  applyJsonCanvas,
  canvasNodes,
  docToJsonCanvas,
  type JsonCanvas,
} from "@/lib/canvas/json-canvas";

import { buildVaultExport, serializeCanvas } from "../vault-export";
import { unzipVault, zipVault } from "../vault-zip";
import { exportVault, importFiles, OBSIDIAN_WRITTEN, obsidianLayout, raw } from "./import-harness";
import { enc, entry, memoryScope, PNG } from "./vault-fixtures";

vi.mock("@/orpc/client", () => ({ client: {} }));

const EMPTY = Y.encodeStateAsUpdate(new Y.Doc());
const exportDoc = (doc: Y.Doc) => serializeCanvas(docToJsonCanvas(doc));
/** As createCanvas stores it. */
const exportState = (state: Uint8Array) => exportDoc(docFromState(mergeStates(EMPTY, state)));
const obsidian = (nodes: object[], edges: object[]) => obsidianLayout({ nodes, edges });

async function importCanvas(path: string, text: string | Uint8Array) {
  return importFiles(memoryScope(), [{ path, bytes: typeof text === "string" ? enc(text) : text }]);
}

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

describe("Obsidian .canvas layout", { timeout: 60_000 }, () => {
  it("covers every fixture Obsidian wrote", () => {
    expect(OBSIDIAN_WRITTEN).toHaveLength(11);
  });

  it.each(OBSIDIAN_WRITTEN)("%s exports byte for byte after the server stores it", async (name) => {
    const { finals } = await importCanvas(name, raw(name));
    // As createCanvas stores it, then as canvas-sync merges a second client's (empty) state in.
    const stored = mergeStates(EMPTY, finals[0]!.state);
    const reloaded = docFromState(mergeStates(stored, Y.encodeStateAsUpdate(new Y.Doc())));
    expect(exportDoc(reloaded)).toBe(raw(name).toString("utf8"));
  });

  it("every Obsidian-written fixture in one vault zip comes back byte for byte", async () => {
    const zip = zipVault(OBSIDIAN_WRITTEN.map((name) => entry(`Vault/Boards/${name}`, raw(name))));
    const scope = memoryScope();
    const { finals } = await importFiles(scope, zip);
    expect(finals).toHaveLength(OBSIDIAN_WRITTEN.length);
    for (const final of finals) {
      const built = buildVaultExport(docFromState(final.state), {
        canvasPath: final.targetPath,
        attachments: scope.attachments(),
      });
      const name = final.targetPath.split("/").pop()!;
      const out = built.files.find((f) => f.path === final.targetPath)!;
      expect(new TextDecoder().decode(out.bytes!), name).toBe(raw(name).toString("utf8"));
    }
  });

  it("edits after the import keep Obsidian's layout and land in the JSON", async () => {
    const name = "obsidiantools-crazywall.canvas";
    const { finals } = await importCanvas(name, raw(name));
    const doc = docFromState(finals[0]!.state);
    const source = JSON.parse(raw(name).toString("utf8")) as JsonCanvas;
    const nodes = canvasNodes(doc);
    const plain = source.nodes.find((n) => n.color === undefined)!;
    const colored = source.nodes.find((n) => n.color !== undefined)!;
    nodes.get(plain.id)!.set("color", "3");
    nodes.get(colored.id)!.delete("color");
    nodes.get(source.nodes[0]!.id)!.set("x", source.nodes[0]!.x + 7);
    const added = applyJsonCanvas(doc, {
      nodes: [{ id: "new", type: "text", text: "added\nline", x: 1, y: 2, width: 3, height: 4 }],
    }).created[0]!;

    const text = exportDoc(doc);
    const lines = text.split("\n");
    expect(lines[0]).toBe("{");
    expect(lines.at(-1)).toBe("}");
    const nodeLines = lines.filter((l) => l.startsWith("\t\t"));
    for (const line of nodeLines) expect(() => JSON.parse(line.replace(/,$/, ""))).not.toThrow();
    expect(nodeLines).toHaveLength(source.nodes.length + 1 + (source.edges?.length ?? 0));

    const out = JSON.parse(text) as JsonCanvas;
    const byId = new Map(out.nodes.map((n) => [n.id, n]));
    expect(byId.get(plain.id)!.color).toBe("3");
    expect(byId.get(colored.id)!.color).toBeUndefined();
    expect(byId.get(source.nodes[0]!.id)!.x).toBe(source.nodes[0]!.x + 7);
    expect(byId.get(added)).toMatchObject({ type: "text", text: "added\nline" });
    // Untouched cards keep their exact source line.
    const untouched = source.nodes.filter(
      (n) => ![plain.id, colored.id, source.nodes[0]!.id].includes(n.id),
    );
    for (const node of untouched) {
      expect(text).toContain(`\t\t${JSON.stringify(node)}`);
    }
  });

  it("a malformed key order in the doc never loses or invents a field", () => {
    const doc = new Y.Doc();
    applyJsonCanvas(
      doc,
      {
        nodes: [{ id: "a", type: "text", text: "t", x: 1, y: 2, width: 3, height: 4, color: "1" }],
        edges: [],
      },
      { mode: "whole" },
    );
    const node = canvasNodes(doc).get("a")!;
    for (const keys of [
      "id,type",
      [1, null, "__proto__", "nope", "color", "id"],
      ["color", "color", "id"],
      {},
      [],
    ]) {
      node.set("keys", keys);
      const out = JSON.parse(exportDoc(doc)) as JsonCanvas;
      expect(out.nodes[0]).toEqual({
        id: "a",
        type: "text",
        text: "t",
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        color: "1",
      });
    }
  });

  it("stores no key order for a card already in our own order", () => {
    const doc = new Y.Doc();
    applyJsonCanvas(
      doc,
      {
        nodes: [{ id: "a", type: "text", text: "t", x: 1, y: 2, width: 3, height: 4 }],
        edges: [],
      },
      { mode: "whole" },
    );
    expect(canvasNodes(doc).get("a")!.has("keys")).toBe(false);
  });

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
    const { result, finals } = await importFiles(scope, zipVault(entries));
    expect(finals).toHaveLength(Object.keys(CASES).length + 1);
    const { files } = exportVault(scope, finals);
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
