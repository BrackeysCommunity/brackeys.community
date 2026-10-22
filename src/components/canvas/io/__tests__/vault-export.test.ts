import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { applyJsonCanvas, type JsonCanvas } from "@/lib/canvas/json-canvas";

import { canvasOutline, outlineMarkdown } from "../../outline";
import { leftOutSummary } from "../export-actions";
import { buildVaultExport, canvasMarkdown, serializeCanvas } from "../vault-export";

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
