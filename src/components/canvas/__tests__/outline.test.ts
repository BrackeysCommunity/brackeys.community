import { describe, expect, it } from "vite-plus/test";

import type { CanvasCard } from "../canvas-cards";
import { canvasOutline, flattenOutline, outlineMarkdown, readingOrder } from "../outline";

const card = (id: string, x: number, y: number, extra: Partial<CanvasCard> = {}): CanvasCard => ({
  id,
  type: "text",
  x,
  y,
  w: 100,
  h: 60,
  text: id,
  ...extra,
});

describe("readingOrder", () => {
  it("reads rows left to right, top to bottom, tolerating ragged tops", () => {
    const cards = [card("c", 0, 200), card("b", 300, 10), card("a", 0, 0), card("d", 300, 190)];
    expect(readingOrder(cards).map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("canvasOutline", () => {
  const cards = [
    card("outer", -50, -50, { type: "group", label: "Level 1", w: 1000, h: 1000, text: undefined }),
    card("inner", 0, 400, { type: "group", label: "Boss", w: 400, h: 300, text: undefined }),
    card("intro", 0, 0),
    card("fight", 20, 450),
    card("loose", 2000, 0),
  ];

  it("nests each card under the smallest group holding it", () => {
    const outline = canvasOutline(cards);
    expect(outline.map((i) => i.card.id)).toEqual(["outer", "loose"]);
    expect(outline[0]!.children.map((i) => i.card.id)).toEqual(["intro", "inner"]);
    expect(outline[0]!.children[1]!.children.map((i) => i.card.id)).toEqual(["fight"]);
    expect(flattenOutline(outline).map((c) => c.id)).toEqual([
      "outer",
      "intro",
      "inner",
      "fight",
      "loose",
    ]);
  });

  it("writes groups as headings and arrows as linked-to lines", () => {
    const md = outlineMarkdown(canvasOutline(cards), [
      { from: "intro", to: "fight", label: "leads to" },
    ]);
    expect(md).toBe(
      ["# Level 1", "intro", "→ linked to fight (leads to)", "## Boss", "fight", "loose"].join(
        "\n\n",
      ) + "\n",
    );
  });
});
