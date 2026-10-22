import { describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { applyJsonCanvas, canvasNodes, type JsonCanvas } from "@/lib/canvas/json-canvas";

import { canvasOutline, outlineMarkdown } from "../../outline";
import { runExportJob } from "../canvas-io-jobs";
import { leftOutSummary } from "../export-actions";
import { buildVaultExport, canvasMarkdown, serializeCanvas } from "../vault-export";
import { unzipVault } from "../vault-zip";
import { enc } from "./vault-fixtures";

const canvas: JsonCanvas = {
  nodes: [
    { id: "g", type: "group", label: "Ideas", x: -50, y: -50, width: 900, height: 400 },
    { id: "n1", type: "file", file: "Notes/Idea.md", x: 0, y: 0, width: 200, height: 100 },
    {
      id: "n2",
      type: "file",
      file: "Notes/Idea.md",
      subpath: "#Two",
      x: 300,
      y: 0,
      width: 200,
      height: 100,
    },
    {
      id: "i1",
      type: "file",
      file: "attachments/ok.png",
      x: 600,
      y: 0,
      width: 100,
      height: 100,
      jamsTeam: { type: "image", attachmentId: "ok" },
    },
    {
      id: "i2",
      type: "file",
      file: "attachments/bad.png",
      x: 0,
      y: 500,
      width: 100,
      height: 100,
      jamsTeam: { type: "image", attachmentId: "bad" },
    },
    { id: "t", type: "text", text: "Plain", x: 300, y: 500, width: 100, height: 100 },
  ],
  edges: [{ id: "e", fromNode: "n1", toNode: "t", label: "see" }],
};

function doc(): Y.Doc {
  const d = new Y.Doc();
  applyJsonCanvas(d, canvas, {
    mode: "whole",
    docFields: {
      n1: { text: "\r\nBody one  \r\n", bom: true },
      n2: { text: "\r\nBody one  \r\n" },
    },
  });
  return d;
}

const attachments = {
  ok: { path: "attachments/ok.png", url: "/images/ok", quarantined: false },
  bad: { path: "attachments/bad.png", url: null, quarantined: true },
};

describe("buildVaultExport", () => {
  it("never writes a note body into the .canvas file", () => {
    const { files } = buildVaultExport(doc(), { canvasPath: "Plan.canvas", attachments });
    const text = new TextDecoder().decode(files[0]!.bytes);
    expect(files[0]!.path).toBe("Plan.canvas");
    expect(text).not.toContain("Body one");
    expect(text).not.toContain('"bom"');
    expect(JSON.parse(text).nodes[1]).toEqual(canvas.nodes[1]);
    expect(text).toBe(serializeCanvas(JSON.parse(text)));
  });

  it("writes a note referenced twice once, with its byte order mark", () => {
    const { files } = buildVaultExport(doc(), { canvasPath: "Plan.canvas", attachments });
    const notes = files.filter((f) => f.path === "Notes/Idea.md");
    expect(notes).toHaveLength(1);
    expect([...notes[0]!.bytes!.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(notes[0]!.bytes!.slice(3))).toBe(
      "\r\nBody one  \r\n",
    );
  });

  it("fetches live images and leaves quarantined ones out, saying so", () => {
    const { files, leftOut } = buildVaultExport(doc(), { canvasPath: "Plan.canvas", attachments });
    expect(files.filter((f) => f.url)).toEqual([{ path: "attachments/ok.png", url: "/images/ok" }]);
    expect(leftOut).toEqual([
      { path: "attachments/bad.png", reason: "The image is under review." },
    ]);
  });

  it("reports an image whose attachment isn't in the scope", () => {
    const { leftOut } = buildVaultExport(doc(), { canvasPath: "Plan.canvas", attachments: {} });
    expect(leftOut.map((l) => l.path)).toEqual(["attachments/ok.png", "attachments/bad.png"]);
  });
});

describe("canvasMarkdown", () => {
  it("is the outline, with each note's body in place of its link", () => {
    const md = canvasMarkdown(doc());
    expect(md).toContain("# Ideas");
    expect(md).toContain("Body one");
    expect(md).not.toContain("[[Notes/Idea.md]]");
    expect(md).toContain("→ linked to Plain (see)");
    const cards = canvas.nodes.map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      w: n.width,
      h: n.height,
      type: (n.jamsTeam ? "image" : n.type) as "text",
      text: n.id.startsWith("n") ? "\r\nBody one  \r\n" : n.text,
      file: n.file,
      subpath: n.subpath,
      label: n.label,
      attachmentId: n.jamsTeam ? "x" : undefined,
    }));
    expect(md).toBe(outlineMarkdown(canvasOutline(cards), [{ from: "n1", to: "t", label: "see" }]));
  });
});

describe("leftOutSummary", () => {
  const items = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ path: `a/${i}.png`, reason: "quarantined" }));

  it("lists a short list in full", () => {
    expect(leftOutSummary(items(2))).toBe(
      "Left out of the zip: a/0.png (quarantined); a/1.png (quarantined)",
    );
  });

  it("names the first three and counts the rest", () => {
    const line = leftOutSummary(items(40));
    expect(line).toContain("a/2.png");
    expect(line).not.toContain("a/3.png");
    expect(line.endsWith("; and 37 more")).toBe(true);
  });
});

describe("buildVaultExport: paths it won't write", () => {
  it("a note path that could escape the vault is left out and reported", () => {
    const doc = new Y.Doc();
    const nodes = canvasNodes(doc);
    for (const [id, file] of [
      ["a", "../escape.md"],
      ["b", "/abs.md"],
      ["c", "ok/fine.md"],
    ] as const) {
      const n = new Y.Map<unknown>();
      n.set("type", "file");
      n.set("file", file);
      n.set("text", new Y.Text("body"));
      n.set("x", 0);
      n.set("y", 0);
      n.set("w", 1);
      n.set("h", 1);
      nodes.set(id, n);
    }
    const out = buildVaultExport(doc, { canvasPath: "c.canvas", attachments: {} });
    expect(out.files.map((f) => f.path).sort()).toEqual(["c.canvas", "ok/fine.md"]);
    expect(out.leftOut.map((l) => l.path).sort()).toEqual(["../escape.md", "/abs.md"]);
  });

  it("two cards with different text for the same note: the first is written, the clash reported", () => {
    const doc = new Y.Doc();
    const nodes = canvasNodes(doc);
    for (const [id, text] of [
      ["a", "one"],
      ["b", "two"],
    ] as const) {
      const n = new Y.Map<unknown>();
      n.set("type", "file");
      n.set("file", "n.md");
      n.set("text", new Y.Text(text));
      n.set("z", id);
      nodes.set(id, n);
    }
    const out = buildVaultExport(doc, { canvasPath: "c.canvas", attachments: {} });
    expect(out.files.filter((f) => f.path === "n.md")).toHaveLength(1);
    expect(out.leftOut).toHaveLength(1);
  });

  it("a note whose path is the canvas's own path is not written over the canvas", () => {
    const doc = new Y.Doc();
    const n = new Y.Map<unknown>();
    n.set("type", "file");
    n.set("file", "Plan.canvas");
    n.set("text", new Y.Text("not json"));
    canvasNodes(doc).set("a", n);
    const out = buildVaultExport(doc, { canvasPath: "Plan.canvas", attachments: {} });
    expect(out.files.filter((f) => f.path === "Plan.canvas")).toHaveLength(1);
    expect(new TextDecoder().decode(out.files[0]!.bytes!)).toMatch(/^\{/);
  });
});

describe("the export job", () => {
  it("an image that can't be downloaded is left out of the zip and reported", async () => {
    const fetchMock = vi.fn(async () => new Response("no", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { zip, leftOut } = await runExportJob({
        files: [
          { path: "c.canvas", bytes: enc("{}") },
          { path: "a.png", url: "/images/a" },
        ],
      });
      expect(unzipVault(zip).entries.map((e) => e.path)).toEqual(["c.canvas"]);
      expect(leftOut).toEqual([{ path: "a.png", reason: "The image couldn't be downloaded." }]);
      expect(fetchMock).toHaveBeenCalledWith("/images/a", { credentials: "same-origin" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
