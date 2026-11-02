import { describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { docToJsonCanvas } from "@/lib/canvas/json-canvas";

import { readCanvasClipboard } from "../clipboard";
import { excalidrawToCanvas, parseExcalidraw } from "../excalidraw";
import { presetFor } from "../preset-color";
import { importVault, scanVault } from "../vault-import";
import { entry, PNG } from "./vault-fixtures";

vi.mock("@/orpc/client", () => ({ client: {} }));

const PNG_URL = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;

/** An element as Excalidraw writes it, trimmed to the fields that matter here. */
function el(type: string, id: string, fields: Record<string, unknown> = {}) {
  return {
    id,
    type,
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    groupIds: [],
    frameId: null,
    isDeleted: false,
    boundElements: null,
    link: null,
    locked: false,
    ...fields,
  };
}

const scene = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [
    el("frame", "frame", { x: -50, y: -50, width: 700, height: 400, name: "Level flow" }),
    el("rectangle", "start", {
      backgroundColor: "#ffc9c9",
      boundElements: [{ id: "start-text", type: "text" }],
    }),
    el("text", "start-text", {
      text: "Title\nscreen",
      originalText: "Title screen",
      containerId: "start",
    }),
    el("diamond", "boss", { x: 400, y: 0, strokeColor: "#1971c2" }),
    el("text", "note", { x: 0, y: 200, width: 40, height: 25, text: "Hi", strokeColor: "#2f9e44" }),
    el("arrow", "go", {
      x: 100,
      y: 30,
      width: 300,
      height: 0,
      points: [
        [0, 0],
        [300, 0],
      ],
      startBinding: { elementId: "start", focus: 0, gap: 1 },
      endBinding: { elementId: "boss", focus: 0, gap: 1 },
      startArrowhead: null,
      endArrowhead: "arrow",
      boundElements: [{ id: "go-label", type: "text" }],
    }),
    el("text", "go-label", { text: "press start", containerId: "go" }),
    el("line", "both-ways", {
      x: 450,
      y: 60,
      points: [
        [0, 0],
        [-426, 128],
      ],
      startBinding: { elementId: "boss" },
      endBinding: { elementId: "note" },
      startArrowhead: "triangle",
      endArrowhead: null,
    }),
    el("arrow", "loose", {
      points: [
        [0, 0],
        [10, 10],
      ],
      startBinding: null,
      endBinding: null,
    }),
    el("freedraw", "doodle"),
    el("freedraw", "doodle-2"),
    el("image", "pic", { x: 700, fileId: "abc123" }),
    el("image", "missing-pic", { fileId: "gone" }),
    el("embeddable", "video", { link: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
    el("rectangle", "deleted", { isDeleted: true }),
  ],
  appState: { viewBackgroundColor: "#ffffff" },
  files: { abc123: { id: "abc123", mimeType: "image/png", dataURL: PNG_URL } },
};

describe("parseExcalidraw", () => {
  it("reads a saved scene and Excalidraw's clipboard JSON", () => {
    expect(parseExcalidraw(JSON.stringify(scene))?.elements).toHaveLength(15);
    const copied = { type: "excalidraw/clipboard", elements: [el("rectangle", "a")] };
    expect(parseExcalidraw(JSON.stringify(copied))?.elements).toHaveLength(1);
  });

  it("turns down anything else", () => {
    expect(parseExcalidraw("")).toBeNull();
    expect(parseExcalidraw("excalidraw is great")).toBeNull();
    expect(parseExcalidraw(JSON.stringify({ nodes: [], edges: [] }))).toBeNull();
    expect(parseExcalidraw(JSON.stringify({ type: "excalidrawlib", elements: [] }))).toBeNull();
  });
});

describe("presetFor", () => {
  it("maps Excalidraw's palette to the nearest preset and drops greys", () => {
    expect(presetFor("#e03131")).toBe("1");
    expect(presetFor("#ffc9c9")).toBe("1");
    expect(presetFor("#f08c00")).toBe("3");
    expect(presetFor("#ffec99")).toBe("2");
    expect(presetFor("#2f9e44")).toBe("4");
    expect(presetFor("#1971c2")).toBe("5");
    expect(presetFor("#9c36b5")).toBe("6");
    expect(presetFor("#1e1e1e")).toBeUndefined();
    expect(presetFor("#ced4da")).toBeUndefined();
    expect(presetFor("transparent")).toBeUndefined();
  });
});

describe("excalidrawToCanvas", () => {
  const converted = excalidrawToCanvas(
    parseExcalidraw(JSON.stringify(scene))!,
    "Plans/Boss.canvas",
  );
  const node = (id: string) => converted.canvas.nodes.find((n) => n.id === id);

  it("turns shapes into text cards holding their bound text", () => {
    expect(node("start")).toMatchObject({ type: "text", text: "Title screen", color: "1" });
    expect(node("boss")).toMatchObject({ type: "text", text: "", x: 400, color: "5" });
    expect(node("start-text")).toBeUndefined();
    expect(node("deleted")).toBeUndefined();
  });

  it("gives free text room around its glyphs", () => {
    expect(node("note")).toMatchObject({ type: "text", text: "Hi", color: "4" });
    expect(node("note")!.width).toBeGreaterThanOrEqual(80);
    expect(node("note")!.height).toBeGreaterThanOrEqual(48);
  });

  it("puts frames first as groups, and keeps images and linked embeds", () => {
    expect(converted.canvas.nodes[0]).toMatchObject({
      id: "frame",
      type: "group",
      label: "Level flow",
    });
    expect(node("pic")).toMatchObject({ type: "file", file: "Plans/Boss images/abc123.png" });
    expect(converted.images).toEqual([{ path: "Plans/Boss images/abc123.png", dataUrl: PNG_URL }]);
    expect(node("video")).toMatchObject({ type: "link", url: expect.stringContaining("youtube") });
  });

  it("turns joined arrows and lines into edges with sides, ends and labels", () => {
    expect(converted.canvas.edges).toEqual([
      {
        id: "go",
        fromNode: "start",
        fromSide: "right",
        toNode: "boss",
        toSide: "left",
        label: "press start",
      },
      {
        id: "both-ways",
        fromNode: "boss",
        fromSide: "bottom",
        fromEnd: "arrow",
        toNode: "note",
        toSide: "top",
        toEnd: "none",
      },
    ]);
  });

  it("counts what it leaves out", () => {
    expect(converted.skipped.map((s) => s.path)).toEqual([
      "2 freehand drawings",
      "1 arrow or line",
      "1 image",
    ]);
  });
});

describe("importing a .excalidraw file", () => {
  const file = () => entry("Boss.excalidraw", JSON.stringify(scene));

  it("scans as the canvas it becomes", () => {
    expect(scanVault([file()]).canvases).toEqual([
      { sourcePath: "Boss.canvas", nodes: 6, valid: true },
    ]);
  });

  it("imports cards, edges and its images, reporting what was left out on that canvas", () => {
    const result = importVault([file()], { mode: "new" });
    expect(result.canvases.map((c) => c.targetPath)).toEqual(["Boss.canvas"]);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, result.canvases[0]!.state);
    const canvas = docToJsonCanvas(doc);
    expect(canvas.nodes).toHaveLength(6);
    expect(canvas.edges).toHaveLength(2);

    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({ path: "Boss images/abc123.png" });
    expect([...result.images[0]!.bytes]).toEqual([...PNG]);
    expect(result.report.skipped).toEqual([
      expect.objectContaining({ path: "2 freehand drawings", canvas: "Boss.canvas" }),
      expect.objectContaining({ path: "1 arrow or line", canvas: "Boss.canvas" }),
      expect.objectContaining({ path: "1 image", canvas: "Boss.canvas" }),
    ]);
  });

  it("doesn't collide with a .canvas of the same name", () => {
    const sibling = entry("Boss.canvas", JSON.stringify({ nodes: [], edges: [] }));
    const paths = scanVault([sibling, file()]).canvases.map((c) => c.sourcePath);
    expect(paths).toEqual(["Boss (Excalidraw).canvas", "Boss.canvas"]);
  });

  it("reports a file that isn't a scene", () => {
    const result = importVault([entry("Broken.excalidraw", "{nope")], { mode: "new" });
    expect(result.canvases).toEqual([]);
    expect(result.report.skipped).toEqual([
      { path: "Broken.canvas", reason: "Not a readable Excalidraw file." },
    ]);
  });

  it("leaves a deselected scene's images out of the report", () => {
    const other = entry("Other.canvas", JSON.stringify({ nodes: [], edges: [] }));
    const result = importVault([file(), other], { mode: "new", selected: ["Other.canvas"] });
    expect(result.report.skipped).toEqual([]);
  });
});

describe("pasting from Excalidraw", () => {
  it("reads Excalidraw's copied JSON as its own kind", () => {
    const text = JSON.stringify({ type: "excalidraw/clipboard", elements: [el("ellipse", "a")] });
    const read = readCanvasClipboard((type) => (type === "text/plain" ? text : ""), []);
    expect(read).toEqual({ kind: "excalidraw", text });
  });
});
