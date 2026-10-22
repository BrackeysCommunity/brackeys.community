import { describe, expect, it, vi } from "vite-plus/test";

import { canvasThumbnail } from "@/lib/canvas/thumbnail";
import { ogCard } from "@/lib/og/card";
import { renderOgPng } from "@/lib/og/render";

const publicCanvas = vi.fn();
vi.mock("@/orpc/client", () => ({
  client: { getPublicCanvas: (input: { canvasId: string }) => publicCanvas(input) },
  orpc: {},
}));

const snapshot = {
  nodes: [
    { id: "g", type: "group", x: 0, y: 0, width: 600, height: 400, color: "4" },
    { id: "a", type: "text", x: 20, y: 40, width: 240, height: 120, color: "2" },
    { id: "b", type: "text", x: 300, y: 60, width: 240, height: 160 },
    { id: "c", type: "text", x: 700, y: 100, width: 200, height: 200, color: "#5865f2" },
  ],
};

function canvas(visibility: "public" | "unlisted") {
  return {
    id: "c1",
    title: "Level ideas",
    visibility,
    nodeCount: 4,
    scope: { kind: "personal", owner: { displayName: "Alice" } },
    thumbnail: canvasThumbnail(snapshot),
  };
}

describe("canvasCard", () => {
  it("cards a public canvas with its layout as art", async () => {
    publicCanvas.mockResolvedValueOnce(canvas("public"));
    const { canvasCard } = await import("@/lib/og/data");
    const card = await canvasCard("c1");
    expect(card).toMatchObject({
      kind: "canvas",
      eyebrow: "Canvas",
      title: "Level ideas",
      stats: [
        { value: "4", label: "Cards" },
        { value: "Alice", label: "Owner" },
      ],
    });
    expect(card?.art?.dataUri).toMatch(/^data:image\/svg\+xml;base64,/);

    const png = await renderOgPng(ogCard(card!));
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    if (process.env.OG_DUMP) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(`${process.env.OG_DUMP}/canvas.png`, png);
    }
  }, 30_000);

  it("cards an unlisted canvas as noindex, and a public one without", async () => {
    const { canvasCard } = await import("@/lib/og/data");
    publicCanvas.mockResolvedValueOnce(canvas("unlisted"));
    expect(await canvasCard("c1")).toMatchObject({ kind: "canvas", noindex: true });
    publicCanvas.mockResolvedValueOnce(canvas("public"));
    expect(await canvasCard("c1")).toMatchObject({ kind: "canvas", noindex: false });
  });

  it("refuses missing canvases", async () => {
    const { canvasCard } = await import("@/lib/og/data");
    publicCanvas.mockRejectedValueOnce(new Error("NOT_FOUND"));
    expect(await canvasCard("c1")).toBeNull();
  });

  it("is what /og/canvas/<id>.png resolves to", async () => {
    publicCanvas.mockResolvedValueOnce(canvas("public"));
    const { resolveCard } = await import("@/routes/og.$");
    expect(await resolveCard("canvas/c1.png")).toMatchObject({ kind: "canvas" });
    expect(publicCanvas).toHaveBeenLastCalledWith({ canvasId: "c1" });
  });
});
