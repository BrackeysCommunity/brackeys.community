/**
 * The canvas clipboard: what a copy writes, which type a paste reads from
 * every combination a clipboard can hold, hostile and browser-mangled HTML,
 * note bodies, and a copy → paste of every card type.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import {
  applyJsonCanvas,
  canvasNodes,
  docOnlyFields,
  docToJsonCanvas,
  type JsonCanvas,
} from "@/lib/canvas/json-canvas";
import { CANVAS_IMPORT_LIMITS } from "@/lib/canvas/limits";

import { selectionFragment } from "../../editor/use-canvas-commands";
import {
  escapeHtml,
  parseCanvasHtml,
  pasteOrigin,
  readCanvasClipboard,
  unescapeHtml,
  writeCanvasClipboard,
} from "../clipboard";

/** A small copy with a keyed image, an entity and a note, written as the editor writes it. */
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

const every: JsonCanvas = {
  nodes: [
    { id: "t", type: "text", text: "Text **md**", x: 0, y: 0, width: 200, height: 80, color: "3" },
    {
      id: "l",
      type: "link",
      url: 'https://example.com/?a=1&b="2"',
      x: 300,
      y: 0,
      width: 200,
      height: 80,
    },
    {
      id: "g",
      type: "group",
      label: "Group <one>",
      background: "bg.png",
      backgroundStyle: "repeat",
      x: -50,
      y: -50,
      width: 900,
      height: 700,
      color: "#123456",
    },
    {
      id: "f",
      type: "file",
      file: "Notes/Ideé.md",
      subpath: "#Head",
      x: 0,
      y: 200,
      width: 200,
      height: 80,
    },
    { id: "p", type: "file", file: "Docs/a.pdf", x: 300, y: 200, width: 200, height: 80 },
    {
      id: "i",
      type: "file",
      file: "attachments/boss.webp",
      x: 600,
      y: 0,
      width: 200,
      height: 200,
      jamsTeam: { type: "image", attachmentId: "att-1" },
    },
    {
      id: "e",
      type: "link",
      url: "https://jams.team/jams/x",
      x: 600,
      y: 300,
      width: 300,
      height: 200,
      jamsTeam: { type: "entity", entity: { kind: "jam", id: "jam-1" } },
    },
    {
      id: "x",
      type: "text",
      text: "with extra",
      x: 0,
      y: 400,
      width: 10,
      height: 10,
      myPlugin: { k: [1, 2] },
    },
  ],
  edges: [
    {
      id: "e1",
      fromNode: "t",
      fromSide: "right",
      fromEnd: "none",
      toNode: "i",
      toSide: "left",
      toEnd: "arrow",
      color: "2",
      label: "→ <&>",
    },
    { id: "e2", fromNode: "f", toNode: "e" },
  ],
};
const bodies = { f: { text: "# Idée\r\n\ttrailing  \r\n", bom: true } };

function sourceDoc() {
  const doc = new Y.Doc();
  applyJsonCanvas(doc, every, { mode: "whole", docFields: bodies });
  return doc;
}

function copyAll(
  doc = sourceDoc(),
  imageUrl: (id: string) => string | null = () => "https://jams.team/images/k",
) {
  const ids = new Set([...canvasNodes(doc).keys()]);
  return writeCanvasClipboard(selectionFragment(doc, ids), {
    fields: docOnlyFields(doc, ids),
    markdown: "outline",
    imageUrl,
  });
}

describe("writing a copy", () => {
  it("writes the Markdown outline as plain text and our payload as HTML", () => {
    const written = write();
    expect(written["text/plain"]).toBe("# Outline <&>");
    expect(written["text/html"]).toContain("data-jams-team-canvas=");
    expect(written["text/html"]).toContain("&lt;&amp;&gt;");
    expect(parseCanvasHtml(written["text/html"])).toEqual({ v: 1, canvas: fragment, fields });
  });
});

describe("paste precedence across every combination of present types", () => {
  const ours = copyAll();
  const foreignOurs = writeCanvasClipboard(
    {
      nodes: [{ id: "other", type: "text", text: "o", x: 0, y: 0, width: 1, height: 1 }],
      edges: [],
    },
    { fields: {}, markdown: "", imageUrl: () => null },
  );
  const image = new File([new Uint8Array(1)], "a.png", { type: "image/png" });
  const pdf = new File([new Uint8Array(1)], "a.pdf", { type: "application/pdf" });

  const obsidianOptions = [
    ["none", undefined],
    ["ours", ours["obsidian/canvas"]],
    [
      "real Obsidian",
      JSON.stringify({ nodes: [every.nodes[0]], edges: [], center: { x: 1, y: 2 } }),
    ],
    ["garbage", "{"],
    ["empty canvas", JSON.stringify({ nodes: [], edges: [] })],
  ] as const;
  const htmlOptions = [
    ["none", undefined],
    ["ours", ours["text/html"]],
    ["ours from another copy", foreignOurs["text/html"]],
    ["ordinary html", "<b>bold</b>"],
  ] as const;
  const plainOptions = [
    ["none", undefined],
    ["outline", "# outline"],
    ["json canvas", JSON.stringify({ nodes: [every.nodes[1]] })],
    ["url", "  https://example.com/x  "],
    ["blank", "   "],
  ] as const;
  const fileOptions = [
    ["none", [] as File[]],
    ["image", [image]],
    ["pdf", [pdf]],
  ] as const;

  type Expected = string | null;
  function oracle(o: string, h: string, p: string, f: string): Expected {
    const obsidian = o === "ours" || o === "real Obsidian";
    const htmlOurs = h === "ours" || h === "ours from another copy";
    const sameCopy = o === "ours" && h === "ours";
    if (obsidian && !sameCopy) return "obsidian";
    if (htmlOurs) return "jams-team";
    if (p === "json canvas") return "json";
    if (f === "image") return "images";
    if (p === "url") return "url";
    if (p === "outline") return "text";
    return null;
  }

  const cases: [string, Record<string, string>, File[], Expected][] = [];
  for (const [o, ov] of obsidianOptions)
    for (const [h, hv] of htmlOptions)
      for (const [p, pv] of plainOptions)
        for (const [f, fv] of fileOptions) {
          const data: Record<string, string> = {};
          if (ov !== undefined) data["obsidian/canvas"] = ov;
          if (hv !== undefined) data["text/html"] = hv;
          if (pv !== undefined) data["text/plain"] = pv;
          cases.push([
            `obsidian=${o} html=${h} plain=${p} files=${f}`,
            data,
            [...fv],
            oracle(o, h, p, f),
          ]);
        }

  it(`covers ${cases.length} combinations`, () => {
    expect(cases.length).toBe(5 * 4 * 5 * 3);
  });

  it.each(cases)("%s", (_label, data, files, expected) => {
    const read = readCanvasClipboard(getter(data), files);
    const got = read == null ? null : read.kind === "canvas" ? read.source : read.kind;
    expect(got).toBe(expected);
  });
});

describe("our HTML payload", () => {
  const nasty = [
    `"double" 'single' <tag> & &amp; &lt; &#39; &#x26; &nbsp;`,
    `</div><script>alert(1)</script>`,
    `data-jams-team-canvas="{}"`,
    "nbsp:  zwsp:​ rtl:‮ emoji:🧑‍💻 nul:\u0000",
    "line\r\nbreaks\n\ttabs",
  ];

  it.each(nasty)("round-trips text %j exactly", (text) => {
    const doc = new Y.Doc();
    applyJsonCanvas(
      doc,
      {
        nodes: [
          { id: "t", type: "text", text, x: 0, y: 0, width: 1, height: 1 },
          { id: "f", type: "file", file: "n.md", x: 0, y: 0, width: 1, height: 1 },
        ],
        edges: [],
      },
      { mode: "whole", docFields: { f: { text } } },
    );
    const written = writeCanvasClipboard(docToJsonCanvas(doc), {
      fields: docOnlyFields(doc),
      markdown: text,
      imageUrl: () => null,
    });
    // Only the one attribute is in the markup; nothing in the text closes it.
    expect(written["text/html"].match(/data-jams-team-canvas="/g)).toHaveLength(1);
    expect(written["text/html"]).not.toContain("<script>");
    const payload = parseCanvasHtml(written["text/html"])!;
    expect(payload.canvas.nodes[0]!.text).toBe(text);
    expect(payload.fields.f).toEqual({ text });
  });

  it("escape → unescape is the identity on any string", () => {
    let s = "";
    for (let c = 0; c < 0x300; c++) s += String.fromCharCode(c);
    s += "&amp;&#39;&quot;&#x3C;&bogus;&#xZZ;&;";
    expect(unescapeHtml(escapeHtml(s))).toBe(s);
    expect(escapeHtml(s)).not.toMatch(/["<>]/);
  });

  it("is found inside the wrappers browsers add (Windows CF_HTML, StartFragment comments)", () => {
    const html = copyAll()["text/html"];
    const wrapped = `Version:0.9\r\nStartHTML:0000000105\r\n<html><body>\r\n<!--StartFragment-->${html}<!--EndFragment-->\r\n</body></html>`;
    const payload = parseCanvasHtml(wrapped);
    expect(payload?.canvas.nodes).toHaveLength(every.nodes.length);
  });

  // A browser that re-serialises the markup (Chrome's sanitised read does)
  // writes U+00A0 in an attribute as `&nbsp;`, which unescapeHtml doesn't
  // know, so the pasted text would carry a literal "&nbsp;".
  it("survives a browser re-serialising the attribute (U+00A0 → &nbsp;, quotes kept)", () => {
    const doc = new Y.Doc();
    applyJsonCanvas(
      doc,
      {
        nodes: [{ id: "t", type: "text", text: "a b 'q' <x>", x: 0, y: 0, width: 1, height: 1 }],
      },
      { mode: "whole" },
    );
    const written = writeCanvasClipboard(docToJsonCanvas(doc), {
      fields: {},
      markdown: "",
      imageUrl: () => null,
    });
    // What DOM serialisation of the attribute produces: only &, ", and U+00A0 escaped.
    const value = unescapeHtml(/data-jams-team-canvas="([^"]*)"/.exec(written["text/html"])![1]!);
    const reserialised = `<div data-jams-team-canvas="${value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll(" ", "&nbsp;")}"></div>`;
    expect(parseCanvasHtml(reserialised)?.canvas.nodes[0]!.text).toBe("a b 'q' <x>");
  });

  it("ignores doc-only fields that don't belong to the card's type", () => {
    const html = writeCanvasClipboard(
      {
        nodes: [
          { id: "t", type: "text", text: "real", x: 0, y: 0, width: 1, height: 1 },
          { id: "f", type: "file", file: "n.md", x: 0, y: 0, width: 1, height: 1 },
        ],
        edges: [],
      },
      {
        fields: {
          t: { text: "smuggled", bom: true, plain: true },
          f: { text: 42 as unknown as string, bom: "yes" as unknown as boolean },
        },
        markdown: "",
        imageUrl: () => null,
      },
    )["text/html"];
    const read = readCanvasClipboard(getter({ "text/html": html }), []);
    if (read?.kind !== "canvas") throw new Error("expected a canvas");
    const doc = new Y.Doc();
    applyJsonCanvas(doc, read.canvas, { mode: "whole", docFields: read.fields });
    const t = canvasNodes(doc).get("t") as Y.Map<unknown>;
    expect((t.get("text") as Y.Text).toJSON()).toBe("real");
    expect(t.get("bom")).toBeUndefined();
    expect(docOnlyFields(doc)).toEqual({});
  });

  it("a payload that isn't JSON Canvas, or has no cards, is ignored", () => {
    for (const inner of ['{"v":1,"canvas":{"nodes":[]}}', '{"v":1}', "null", "[1]", "{"]) {
      const html = `<div data-jams-team-canvas="${escapeHtml(inner)}"></div>`;
      expect(parseCanvasHtml(html), inner).toBeNull();
    }
  });
});

describe("copy → paste of every card type", () => {
  it("is lossless between two of our canvases, bodies and BOM included", () => {
    const from = sourceDoc();
    const copied = copyAll(from);
    const read = readCanvasClipboard(getter(copied), []);
    if (read?.kind !== "canvas") throw new Error("expected a canvas");
    expect(read.source).toBe("jams-team");
    const to = new Y.Doc();
    const { ids } = applyJsonCanvas(to, read.canvas, {
      at: pasteOrigin(read.canvas, { x: 5_000, y: -3_000 }),
      docFields: read.fields,
    });
    const strip = (c: JsonCanvas, map?: Map<string, string>) => {
      const back = map ? new Map([...map].map(([a, b]) => [b, a])) : null;
      const rid = (id: string) => back?.get(id) ?? id;
      const minX = Math.min(...c.nodes.map((n) => n.x));
      const minY = Math.min(...c.nodes.map((n) => n.y));
      return {
        nodes: c.nodes
          .map((n) => ({ ...n, id: rid(n.id), x: n.x - minX, y: n.y - minY }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        edges: c.edges
          .map(({ id: _id, ...e }) => ({ ...e, fromNode: rid(e.fromNode), toNode: rid(e.toNode) }))
          .sort((a, b) => a.fromNode.localeCompare(b.fromNode)),
      };
    };
    expect(strip(docToJsonCanvas(to), ids)).toEqual(strip(docToJsonCanvas(from)));
    const body = docOnlyFields(to)[ids.get("f")!];
    expect(body).toEqual(bodies.f);
  });

  it("the obsidian/canvas type maps images to links that keep their key, everything else as exported", () => {
    const obsidian = JSON.parse(copyAll()["obsidian/canvas"]) as JsonCanvas & {
      center: { x: number; y: number };
    };
    const image = obsidian.nodes.find((n) => n.id === "i")!;
    expect(image).toMatchObject({ type: "link", url: "https://jams.team/images/k" });
    expect(image.jamsTeam).toEqual({ type: "image", attachmentId: "att-1" });
    // The path rides along so an Obsidian-only paste can export it as a file node again.
    expect(image.file).toBe("attachments/boss.webp");
    expect(obsidian.nodes.find((n) => n.id === "e")).toEqual(every.nodes.find((n) => n.id === "e"));
    expect(obsidian.nodes.find((n) => n.id === "f")).toEqual(every.nodes.find((n) => n.id === "f"));
    expect(JSON.stringify(obsidian)).not.toContain("trailing");
    // The bounding box of the selection, rounded.
    expect(obsidian.center).toEqual({ x: 425, y: 300 });
  });

  it("an image with no URL (under review) stays a file node with its key", () => {
    const obsidian = JSON.parse(copyAll(sourceDoc(), () => null)["obsidian/canvas"]) as JsonCanvas;
    expect(obsidian.nodes.find((n) => n.id === "i")).toMatchObject({
      type: "file",
      file: "attachments/boss.webp",
    });
  });

  // When only Obsidian's type survives (another browser, or a copy that went
  // through Obsidian), the image comes back keyed but with no path, and the
  // .canvas export then writes it as a file node with an empty `file`.
  it("an Obsidian-only paste of one of our images keeps a usable file path on export", () => {
    const read = readCanvasClipboard(
      getter({ "obsidian/canvas": copyAll()["obsidian/canvas"] }),
      [],
    );
    if (read?.kind !== "canvas") throw new Error("expected a canvas");
    const to = new Y.Doc();
    const { ids } = applyJsonCanvas(to, read.canvas, { at: { x: 0, y: 0 } });
    const node = docToJsonCanvas(to).nodes.find((n) => n.id === ids.get("i"))!;
    expect(node.jamsTeam).toEqual({ type: "image", attachmentId: "att-1" });
    expect(node.type).toBe("file");
    expect(node.file).not.toBe("");
  });

  it("a real Obsidian copy with center lands with its layout kept around the cursor", () => {
    const payload = `{"nodes":[{"id":"8f","x":-338,"y":-1140,"width":504,"height":294,"color":"6","type":"text","text":"# Purple"},{"id":"5b","x":151,"y":540,"width":250,"height":173,"type":"file","file":"Isolated note.md"}],"edges":[{"id":"e","fromNode":"8f","fromSide":"bottom","toNode":"5b","toSide":"top"}],"center":{"x":-50,"y":-200}}`;
    const read = readCanvasClipboard(getter({ "obsidian/canvas": payload }), []);
    if (read?.kind !== "canvas") throw new Error("expected a canvas");
    const cursor = { x: 10_000, y: 10_000 };
    const to = new Y.Doc();
    const { ids } = applyJsonCanvas(to, read.canvas, { at: pasteOrigin(read.canvas, cursor) });
    const out = docToJsonCanvas(to);
    const a = out.nodes.find((n) => n.id === ids.get("8f"))!;
    const b = out.nodes.find((n) => n.id === ids.get("5b"))!;
    expect([b.x - a.x, b.y - a.y]).toEqual([151 + 338, 540 + 1140]);
    const midX = (Math.min(a.x, b.x) + Math.max(a.x + a.width, b.x + b.width)) / 2;
    const midY = (Math.min(a.y, b.y) + Math.max(a.y + a.height, b.y + b.height)) / 2;
    expect(Math.abs(midX - cursor.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(midY - cursor.y)).toBeLessThanOrEqual(1);
    expect(out.edges[0]).toMatchObject({ fromSide: "bottom", toSide: "top" });
    expect(a.color).toBe("6");
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

  it("pasteOrigin puts the payload's center on the cursor", () => {
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
});

describe("plain text pasted onto the canvas (not into a card)", () => {
  it("becomes a text card with \\n line breaks, as a paste into a card does", () => {
    const read = readCanvasClipboard(
      (type) => (type === "text/plain" ? "one\r\ntwo\rthree" : ""),
      [],
    );
    expect(read).toEqual({ kind: "text", text: "one\ntwo\nthree" });
  });
});
