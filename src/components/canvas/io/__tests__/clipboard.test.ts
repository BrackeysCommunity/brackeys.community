import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import {
  applyJsonCanvas,
  docOnlyFields,
  docToJsonCanvas,
  type JsonCanvas,
} from "@/lib/canvas/json-canvas";
import { CANVAS_IMPORT_LIMITS } from "@/lib/canvas/limits";

import {
  escapeHtml,
  parseCanvasHtml,
  pasteOrigin,
  readCanvasClipboard,
  stateBytesWith,
  stateOverCap,
  unescapeHtml,
  writeCanvasClipboard,
} from "../clipboard";

const fragment: JsonCanvas = {
  nodes: [
    { id: "t", type: "text", text: `He said "hi" <b> & 'bye'`, x: 0, y: 0, width: 100, height: 50 },
    {
      id: "i",
      type: "file",
      file: "attachments/boss.webp",
      x: 200,
      y: 0,
      width: 100,
      height: 100,
      jamsTeam: { type: "image", attachmentId: "att-1" },
    },
    {
      id: "e",
      type: "link",
      url: "https://jams.team/jams/x",
      x: 0,
      y: 200,
      width: 300,
      height: 200,
      jamsTeam: { type: "entity", entity: { kind: "jam", id: "jam-1" } },
    },
    { id: "f", type: "file", file: "Notes/Idea.md", x: 400, y: 200, width: 100, height: 100 },
  ],
  edges: [{ id: "x", fromNode: "t", toNode: "i" }],
};
const fields = { f: { text: "# Idea\r\n", bom: true } };

const write = () =>
  writeCanvasClipboard(fragment, {
    fields,
    markdown: "# Outline <&>",
    imageUrl: (id) => (id === "att-1" ? "https://jams.team/images/k" : null),
  });

const getter = (data: Partial<Record<string, string>>) => (type: string) => data[type] ?? "";

describe("writeCanvasClipboard", () => {
  it("writes Obsidian's type with images as links that keep their key and path, plus center", () => {
    const obsidian = JSON.parse(write()["obsidian/canvas"]) as JsonCanvas;
    expect(obsidian.center).toEqual({ x: 250, y: 200 });
    expect(obsidian.nodes[1]).toEqual({
      id: "i",
      type: "link",
      url: "https://jams.team/images/k",
      file: "attachments/boss.webp",
      x: 200,
      y: 0,
      width: 100,
      height: 100,
      jamsTeam: { type: "image", attachmentId: "att-1" },
    });
    expect(obsidian.nodes[3]).toEqual(fragment.nodes[3]);
  });

  it("writes the Markdown outline as plain text and our payload as HTML", () => {
    const written = write();
    expect(written["text/plain"]).toBe("# Outline <&>");
    expect(written["text/html"]).toContain("data-jams-team-canvas=");
    expect(written["text/html"]).toContain("&lt;&amp;&gt;");
    expect(parseCanvasHtml(written["text/html"])).toEqual({ v: 1, canvas: fragment, fields });
  });

  it("escapes attributes so quotes, < and & round-trip", () => {
    const value = `"quoted" <tag> & 'single' &amp;`;
    expect(unescapeHtml(escapeHtml(value))).toBe(value);
    expect(escapeHtml(value)).not.toMatch(/["<>]/);
  });

  it("finds the payload inside the wrapper a browser adds", () => {
    const html = `<html><body><!--StartFragment-->${write()["text/html"]}<!--EndFragment--></body></html>`;
    expect(parseCanvasHtml(html)?.canvas).toEqual(fragment);
  });
});

describe("readCanvasClipboard: the plan's order", () => {
  const ours = write();
  const obsidianOnly = JSON.stringify({
    ...fragment,
    nodes: [fragment.nodes[0]],
    center: { x: 1, y: 1 },
  });
  const plainJson = JSON.stringify({ nodes: [fragment.nodes[3]], edges: [] });
  const image = new File([new Uint8Array(1)], "a.png", { type: "image/png" });

  const cases: [string, Partial<Record<string, string>>, File[], string][] = [
    ["our copy: every type, the lossless one wins", ours, [image], "jams-team"],
    ["Obsidian's own copy", { "obsidian/canvas": obsidianOnly }, [], "obsidian"],
    [
      "Obsidian beats an unrelated HTML payload",
      { "obsidian/canvas": obsidianOnly, "text/html": ours["text/html"] },
      [],
      "obsidian",
    ],
    [
      "our HTML without Obsidian's type",
      { "text/html": ours["text/html"], "text/plain": "x" },
      [image],
      "jams-team",
    ],
    ["JSON Canvas as plain text", { "text/plain": plainJson }, [image], "json"],
    ["an image", { "text/plain": "" }, [image], "images"],
    ["a URL", { "text/plain": " https://example.com/a " }, [], "url"],
    ["text", { "text/plain": "hello" }, [], "text"],
  ];

  it.each(cases)("%s", (_label, data, files, expected) => {
    const read = readCanvasClipboard(getter(data), files);
    expect(read?.kind === "canvas" ? read.source : read?.kind).toBe(expected);
  });

  it("nothing usable is null", () => {
    expect(readCanvasClipboard(getter({ "text/plain": "  " }), [])).toBeNull();
    expect(readCanvasClipboard(getter({ "obsidian/canvas": "{not json" }), [])).toBeNull();
  });
});

describe("copy → paste between canvases", () => {
  it("is lossless for every card type, note bodies included", () => {
    const from = new Y.Doc();
    applyJsonCanvas(from, fragment, { mode: "whole", docFields: fields });
    const copied = writeCanvasClipboard(docToJsonCanvas(from), {
      fields: docOnlyFields(from),
      markdown: "",
      imageUrl: () => "https://jams.team/images/k",
    });
    const read = readCanvasClipboard(getter(copied), []);
    if (read?.kind !== "canvas") throw new Error("expected a canvas");
    const to = new Y.Doc();
    applyJsonCanvas(to, read.canvas, { mode: "whole", docFields: read.fields });
    expect(docToJsonCanvas(to)).toEqual(docToJsonCanvas(from));
    expect(docOnlyFields(to)).toEqual(docOnlyFields(from));
  });

  it("an Obsidian-only paste still brings the image back as an image card", () => {
    const from = new Y.Doc();
    applyJsonCanvas(from, fragment, { mode: "whole" });
    const copied = writeCanvasClipboard(docToJsonCanvas(from), {
      fields: {},
      markdown: "",
      imageUrl: () => "https://jams.team/images/k",
    });
    const read = readCanvasClipboard(getter({ "obsidian/canvas": copied["obsidian/canvas"] }), []);
    if (read?.kind !== "canvas") throw new Error("expected a canvas");
    const to = new Y.Doc();
    const { ids } = applyJsonCanvas(to, read.canvas, { at: { x: 0, y: 0 } });
    const image = to.getMap<Y.Map<unknown>>("nodes").get(ids.get("i")!);
    expect(image?.get("type")).toBe("image");
    expect(image?.get("attachmentId")).toBe("att-1");
    const entity = to.getMap<Y.Map<unknown>>("nodes").get(ids.get("e")!);
    expect(entity?.get("entity")).toEqual({ kind: "jam", id: "jam-1" });
  });

  it("a real Obsidian payload lands centred on the cursor, layout kept", () => {
    const payload = {
      nodes: [
        { id: "a", type: "text", text: "A", x: 100, y: 100, width: 200, height: 100 },
        { id: "b", type: "text", text: "B", x: 400, y: 300, width: 200, height: 100 },
      ],
      edges: [{ id: "ab", fromNode: "a", toNode: "b" }],
      center: { x: 350, y: 250 },
    };
    const read = readCanvasClipboard(getter({ "obsidian/canvas": JSON.stringify(payload) }), []);
    if (read?.kind !== "canvas") throw new Error("expected a canvas");
    const origin = pasteOrigin(read.canvas, { x: 1000, y: 1000 });
    expect(origin).toEqual({ x: 750, y: 850 });
    const to = new Y.Doc();
    const { ids } = applyJsonCanvas(to, read.canvas, { at: origin });
    const out = docToJsonCanvas(to);
    const a = out.nodes.find((n) => n.id === ids.get("a"))!;
    const b = out.nodes.find((n) => n.id === ids.get("b"))!;
    expect([a.x, a.y, b.x - a.x, b.y - a.y]).toEqual([750, 850, 300, 200]);
    expect(out.edges).toHaveLength(1);
  });
});

describe("note bodies on paste", () => {
  const fileCanvas: JsonCanvas = {
    nodes: [{ id: "f", type: "file", file: "n.md", x: 0, y: 0, width: 1, height: 1 }],
    edges: [],
  };

  it("leaves out a body over the per-note cap, keeping the card", () => {
    const big = "é".repeat(CANVAS_IMPORT_LIMITS.maxMarkdownBytes / 2 + 1);
    const html = writeCanvasClipboard(fileCanvas, {
      fields: { f: { text: big, bom: true } },
      markdown: "",
      imageUrl: () => null,
    })["text/html"];
    const payload = parseCanvasHtml(html)!;
    expect(payload.canvas.nodes).toHaveLength(1);
    expect(payload.fields.f).toEqual({ bom: true });
  });

  it("keeps a body within the cap byte for byte", () => {
    const html = writeCanvasClipboard(fileCanvas, {
      fields: { f: { text: "a\r\nb  \n" } },
      markdown: "",
      imageUrl: () => null,
    })["text/html"];
    expect(parseCanvasHtml(html)!.fields.f).toEqual({ text: "a\r\nb  \n" });
  });

  it("measures the saved state with a fragment in it, bodies included", () => {
    const at = { x: 0, y: 0 };
    const small = stateBytesWith(new Y.Doc(), fileCanvas, { at });
    const withBody = stateBytesWith(new Y.Doc(), fileCanvas, {
      at,
      docFields: { f: { text: "x".repeat(10_000) } },
    });
    expect(withBody - small).toBeGreaterThanOrEqual(10_000);
  });

  it("leaves the doc it measures untouched", () => {
    const doc = new Y.Doc();
    const before = Y.encodeStateAsUpdate(doc);
    stateBytesWith(doc, fileCanvas, { at: { x: 0, y: 0 } });
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });
});

describe("stateOverCap", () => {
  const cards = (n: number, edges: boolean): JsonCanvas => {
    const nodes = Array.from({ length: n }, (_, i) => ({
      id: `n${i}`,
      type: "text" as const,
      text: `card ${i}`,
      x: i,
      y: 0,
      width: 10,
      height: 10,
    }));
    return {
      nodes,
      edges: edges
        ? nodes.slice(1).map((m, i) => ({ id: `e${i}`, fromNode: nodes[i]!.id, toNode: m.id }))
        : [],
    };
  };
  const docAt = (clock: number) => {
    const doc = new Y.Doc();
    doc.clientID = 2 ** 32 - 3;
    applyJsonCanvas(doc, cards(20, false));
    if (clock) {
      doc.getText("big").insert(0, "x".repeat(clock));
      doc.getText("big").delete(0, clock);
    }
    return doc;
  };

  it.each([0, 20_000, 2_200_000])("decides like the exact measure at clock %i", (clock) => {
    const doc = docAt(clock);
    const at = { x: 0, y: 0 };
    for (const fragment of [cards(1, false), cards(5, true), cards(200, false), cards(200, true)]) {
      const exact = stateBytesWith(doc, fragment, { at });
      for (const cap of [exact - 1, exact, exact + 1, exact * 4, exact * 10]) {
        expect(stateOverCap(doc, fragment, { at }, cap)).toBe(exact > cap ? exact : null);
      }
    }
  });
});
