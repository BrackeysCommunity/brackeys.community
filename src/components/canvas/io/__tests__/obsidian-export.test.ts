import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import {
  applyJsonCanvas,
  canvasNodes,
  docToJsonCanvas,
  type JsonCanvas,
} from "@/lib/canvas/json-canvas";

import {
  buildVaultExport,
  canvasFileForObsidian,
  type ExportEntities,
  vaultFolder,
} from "../vault-export";
import { docOf, importFiles } from "./import-harness";
import { enc, memoryScope, PNG } from "./vault-fixtures";

const at = { x: 0, y: 0, width: 200, height: 100 };

const canvas: JsonCanvas = {
  nodes: [
    { id: "n", type: "file", file: "Notes/Idea.md", ...at },
    {
      id: "i",
      type: "file",
      file: "attachments/ok.png",
      ...at,
      jamsTeam: { type: "image", attachmentId: "ok" },
    },
    {
      id: "q",
      type: "file",
      file: "attachments/bad.png",
      ...at,
      jamsTeam: { type: "image", attachmentId: "bad" },
    },
    {
      id: "j",
      type: "link",
      url: "https://jams.team/jams/gbjam-14",
      ...at,
      jamsTeam: { type: "entity", entity: { kind: "jam", id: "14" } },
    },
    {
      id: "p",
      type: "link",
      url: "https://jams.team/profile/gone",
      ...at,
      jamsTeam: { type: "entity", entity: { kind: "profile", id: "gone" } },
    },
  ],
  edges: [],
};

function doc(): Y.Doc {
  const d = new Y.Doc();
  applyJsonCanvas(d, canvas, { mode: "whole", docFields: { n: { text: "Body" } } });
  return d;
}

const attachments = {
  ok: { path: "attachments/ok.png", url: "/images/ok", quarantined: false },
  bad: { path: "attachments/bad.png", url: null, quarantined: true },
};

const entities: ExportEntities = new Map([
  [
    "jam:14",
    {
      title: "GBJAM [14]",
      subtitle: "Ends Sep 21",
      imageUrl: "https://img.itch.zone/banner.png",
      url: "https://jams.team/jams/gbjam-14",
    },
  ],
]);

const byId = (c: JsonCanvas, id: string) => c.nodes.find((n) => n.id === id)!;

describe("the zip for Obsidian", () => {
  const built = buildVaultExport(doc(), {
    canvasPath: "Boards/Plan.canvas",
    attachments,
    entities,
  });
  const written = JSON.parse(
    new TextDecoder().decode(built.files.find((f) => f.path === "Plan/Boards/Plan.canvas")!.bytes),
  ) as JsonCanvas;

  it("puts everything in one folder named for the canvas, and points the cards into it", () => {
    expect(built.files.map((f) => f.path).sort()).toEqual([
      "Plan/Boards/Plan.canvas",
      "Plan/Notes/Idea.md",
      "Plan/attachments/ok.png",
    ]);
    expect(byId(written, "n").file).toBe("Plan/Notes/Idea.md");
    expect(byId(written, "i").file).toBe("Plan/attachments/ok.png");
    // Left out of the zip, so it still names the path it had.
    expect(byId(written, "q").file).toBe("attachments/bad.png");
  });

  it("writes site cards as Markdown that links to their pages, keeping the key", () => {
    const jam = byId(written, "j");
    expect(jam.type).toBe("text");
    expect(jam.text).toBe(
      [
        "### [GBJAM \\[14\\]](<https://jams.team/jams/gbjam-14>)",
        "Jam · Ends Sep 21",
        "",
        "![](<https://img.itch.zone/banner.png>)",
      ].join("\n"),
    );
    expect(jam.url).toBe("https://jams.team/jams/gbjam-14");
    expect(jam.jamsTeam).toEqual({ type: "entity", entity: { kind: "jam", id: "14" } });
    // One the lookup missed still links to its page.
    expect(byId(written, "p").text).toBe("### [Member](<https://jams.team/profile/gone>)");
  });

  it("names the folder safely", () => {
    expect(vaultFolder("a/b: c?.canvas")).toBe("b- c-");
    expect(vaultFolder("..canvas")).toBe("Canvas");
  });
});

describe("the .canvas file on its own", () => {
  const file = canvasFileForObsidian(docToJsonCanvas(doc()), entities);

  it("shows a placeholder for each image, carrying its path and key", () => {
    const image = byId(file, "i");
    expect(image.type).toBe("text");
    expect(image.text).toContain("**ok.png**");
    expect(image.file).toBe("attachments/ok.png");
    expect(image.jamsTeam).toEqual({ type: "image", attachmentId: "ok" });
    expect(byId(file, "j").type).toBe("text");
  });

  it("imports back as the same image and site cards", () => {
    const back = new Y.Doc();
    applyJsonCanvas(back, file, { mode: "whole" });
    const nodes = canvasNodes(back);
    expect(nodes.get("i")!.get("type")).toBe("image");
    expect(nodes.get("i")!.get("attachmentId")).toBe("ok");
    expect(nodes.get("i")!.get("file")).toBe("attachments/ok.png");
    expect(nodes.get("j")!.get("type")).toBe("entity");
    expect(nodes.get("j")!.get("url")).toBe("https://jams.team/jams/gbjam-14");
    // What made them readable in Obsidian doesn't come back as stray keys.
    expect(nodes.get("i")!.get("extra")).toBeUndefined();
    expect(nodes.get("j")!.get("extra")).toBeUndefined();
  });
});

describe("the zip, imported back", () => {
  it("takes its folder off again: the canvas path and every card's file", async () => {
    const scope = memoryScope();
    const source: JsonCanvas = {
      nodes: [
        { id: "n", type: "file", file: "Notes/Idea.md", ...at },
        { id: "i", type: "file", file: "Art/pic.png", ...at },
      ],
      edges: [],
    };
    const first = await importFiles(scope, [
      { path: "Plan.canvas", bytes: enc(JSON.stringify(source)) },
      { path: "Notes/Idea.md", bytes: enc("Body") },
      { path: "Art/pic.png", bytes: PNG },
    ]);
    const built = buildVaultExport(docOf(first.finals[0]!.state), {
      canvasPath: "Plan.canvas",
      attachments: scope.attachments(),
    });
    const entries = built.files.map((f) => ({
      path: f.path,
      bytes: f.bytes ?? scope.bytesAt(f.url!)!,
    }));
    expect(entries.every((e) => e.path.startsWith("Plan/"))).toBe(true);

    const second = await importFiles(scope, entries);
    expect(second.finals[0]!.targetPath).toBe("Plan.canvas");
    const nodes = canvasNodes(docOf(second.finals[0]!.state));
    expect(nodes.get("n")!.get("file")).toBe("Notes/Idea.md");
    expect(nodes.get("i")!.get("type")).toBe("image");
    expect(nodes.get("i")!.get("file")).not.toMatch(/^Plan\//);
  });
});
