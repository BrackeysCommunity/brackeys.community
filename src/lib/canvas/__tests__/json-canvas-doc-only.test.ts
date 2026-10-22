/**
 * The doc-only fields (note body, `bom`, `plain`) and the image key on a
 * `link` node, at the JSON Canvas boundary.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import {
  applyJsonCanvas,
  canvasNodes,
  deriveSnapshot,
  docOnlyFields,
  type DocOnlyFields,
  docToJsonCanvas,
  fileBodyOf,
  type JsonCanvas,
  sanitizeSnapshot,
} from "../json-canvas";
import { CANVAS_LIMITS } from "../limits";

const load = (canvas: unknown, docFields?: Record<string, DocOnlyFields>) => {
  const doc = new Y.Doc();
  applyJsonCanvas(doc, canvas, { mode: "whole", docFields });
  return doc;
};

const imageLink = {
  id: "i",
  type: "link",
  url: "https://jams.team/images/k",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  jamsTeam: { type: "image", attachmentId: "att-1" },
};

describe("an image key on a link node", () => {
  it("becomes an image card, and exports as a file node with the key", () => {
    const doc = load({ nodes: [imageLink] });
    const node = canvasNodes(doc).get("i") as Y.Map<unknown>;
    expect(node.get("type")).toBe("image");
    expect(node.get("attachmentId")).toBe("att-1");
    expect(node.get("url")).toBeUndefined();
    const out = docToJsonCanvas(doc).nodes[0]!;
    expect(out).toMatchObject({ type: "file", jamsTeam: { type: "image", attachmentId: "att-1" } });
  });

  it("the legacy brackeys key on a link node reads the same", () => {
    const { jamsTeam, ...rest } = imageLink;
    const doc = load({ nodes: [{ ...rest, brackeys: jamsTeam }] });
    expect((canvasNodes(doc).get("i") as Y.Map<unknown>).get("type")).toBe("image");
  });

  it("an entity key on a file node is not an entity card", () => {
    const doc = load({
      nodes: [
        {
          id: "x",
          type: "file",
          file: "a.md",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          jamsTeam: { type: "entity", entity: { kind: "jam", id: "j" } },
        },
      ],
    });
    expect((canvasNodes(doc).get("x") as Y.Map<unknown>).get("type")).toBe("file");
  });

  it("sanitizeSnapshot keeps the key on a link node and drops a malformed one", () => {
    const out = sanitizeSnapshot({ nodes: [imageLink], edges: [] } as unknown as JsonCanvas);
    expect(out.nodes[0]!.jamsTeam).toEqual({ type: "image", attachmentId: "att-1" });
    const bad = sanitizeSnapshot({
      nodes: [{ ...imageLink, jamsTeam: { type: "image", attachmentId: 5 } }],
      edges: [],
    } as unknown as JsonCanvas);
    expect(bad.nodes[0]!.jamsTeam).toBeUndefined();
  });
});

describe("doc-only fields", () => {
  const canvas = {
    nodes: [
      { id: "f", type: "file", file: "n.md", subpath: "#a", x: 0, y: 0, width: 1, height: 1 },
      {
        id: "i",
        type: "file",
        file: "a.png",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        jamsTeam: { type: "image", attachmentId: "att" },
      },
      { id: "t", type: "text", text: "visible", x: 0, y: 0, width: 1, height: 1 },
    ],
  };
  const fields = {
    f: { text: "BODY\r\n", bom: true },
    i: { plain: true, text: "not for images" },
    t: { text: "smuggled", bom: true },
  };

  it("land only on the card type they belong to", () => {
    const doc = load(canvas, fields);
    expect(fileBodyOf(canvasNodes(doc).get("f") as Y.Map<unknown>)).toEqual({
      text: "BODY\r\n",
      bom: true,
    });
    const image = canvasNodes(doc).get("i") as Y.Map<unknown>;
    expect(image.get("plain")).toBe(true);
    expect(image.get("text")).toBeUndefined();
    const text = canvasNodes(doc).get("t") as Y.Map<unknown>;
    expect(String(text.get("text"))).toBe("visible");
    expect(text.get("bom")).toBeUndefined();
    expect(docOnlyFields(doc)).toEqual({ f: { text: "BODY\r\n", bom: true }, i: { plain: true } });
  });

  it("never reach JSON Canvas, the snapshot, or the vault form", () => {
    const doc = load(canvas, fields);
    for (const json of [
      docToJsonCanvas(doc),
      deriveSnapshot(doc),
      docToJsonCanvas(doc, { vault: true }),
    ]) {
      const text = JSON.stringify(json);
      expect(text).not.toContain("BODY");
      expect(text).not.toContain('"bom"');
      expect(text).not.toContain('"plain"');
    }
  });

  it("the vault form drops the key only for plain images", () => {
    const doc = load(
      {
        nodes: [
          canvas.nodes[1],
          { ...canvas.nodes[1], id: "k", jamsTeam: { type: "image", attachmentId: "att2" } },
        ],
      },
      { i: { plain: true } },
    );
    const vault = docToJsonCanvas(doc, { vault: true }).nodes;
    expect(vault.find((n) => n.id === "i")!.jamsTeam).toBeUndefined();
    expect(vault.find((n) => n.id === "k")!.jamsTeam).toEqual({
      type: "image",
      attachmentId: "att2",
    });
    expect(docToJsonCanvas(doc).nodes.every((n) => n.jamsTeam)).toBe(true);
  });

  it("an edit to the body is a Y.Text edit, and a body-less file card has none", () => {
    const doc = load(canvas, fields);
    const body = (canvasNodes(doc).get("f") as Y.Map<unknown>).get("text") as Y.Text;
    body.insert(0, "x");
    expect(fileBodyOf(canvasNodes(doc).get("f") as Y.Map<unknown>)!.text).toBe("xBODY\r\n");
    const bare = load({ nodes: [canvas.nodes[0]] });
    expect(fileBodyOf(canvasNodes(bare).get("f") as Y.Map<unknown>)).toBeUndefined();
    expect(docOnlyFields(bare)).toEqual({});
  });

  // A third-party file node that carries a `text` key has it read as a known
  // key and dropped, rather than kept in `extra` (true before this slice too).
  it("a foreign `text` key on a file node round-trips", () => {
    const source = { nodes: [{ ...canvas.nodes[0], text: "plugin data" }], edges: [] };
    expect(docToJsonCanvas(load(source)).nodes[0]!.text).toBe("plugin data");
  });
});

describe("applying cards with long note bodies", () => {
  it("splits transactions by bytes as well as by card count", () => {
    const body = "x".repeat(200_000);
    const nodes = Array.from({ length: 6 }, (_, i) => ({
      id: `f${i}`,
      type: "file",
      file: `n${i}.md`,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }));
    const doc = new Y.Doc();
    const sizes: number[] = [];
    doc.on("update", (update: Uint8Array) => sizes.push(update.length));
    applyJsonCanvas(
      doc,
      { nodes, edges: [] },
      {
        mode: "fragment",
        at: { x: 0, y: 0 },
        docFields: Object.fromEntries(nodes.map((n) => [n.id, { text: body }])),
      },
    );
    expect(canvasNodes(doc).size).toBe(6);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(CANVAS_LIMITS.maxMessageBytes);
    expect(sizes.length).toBeGreaterThan(2);
  });
});
