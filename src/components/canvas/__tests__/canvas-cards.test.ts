import { describe, expect, it } from "vite-plus/test";

import {
  cardColor,
  cardFromJson,
  cardSizeLimits,
  detailLevelFor,
  entityArtLayout,
  hasMarkdown,
  ratioStepAllowed,
} from "../canvas-cards";

describe("cardFromJson", () => {
  it("maps our types back up from their JSON Canvas form", () => {
    expect(
      cardFromJson({
        id: "i",
        type: "file",
        file: "attachments/a.png",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        brackeys: { type: "image", attachmentId: "att" },
      }),
    ).toMatchObject({ type: "image", attachmentId: "att" });
    expect(cardFromJson({ id: "x", type: "pdf", x: 0, y: 0, width: 1, height: 1 })).toBeNull();
  });
});

describe("colors and detail", () => {
  it("maps presets to theme tokens and passes hex through", () => {
    expect(cardColor("4")).toBe("var(--success)");
    expect(cardColor("#aabbcc")).toBe("#aabbcc");
    expect(cardColor("red")).toBeNull();
  });

  it("drops detail as you zoom out", () => {
    expect([0.1, 0.3, 0.5, 1].map(detailLevelFor)).toEqual(["blocks", "far", "mid", "near"]);
  });
});

describe("entityArtLayout", () => {
  it("puts a banner on top of a roughly square card", () => {
    expect(entityArtLayout(300, 320, false).mode).toBe("top");
  });

  it("moves a banner beside the text once the card is wide and short", () => {
    expect(entityArtLayout(340, 140, false).mode).toBe("side");
  });

  it("keeps a top banner between 1.25:1 and 3:1", () => {
    const tall = entityArtLayout(200, 600, false);
    expect(tall.mode === "top" && 176 / tall.height).toBeCloseTo(1.25);
    expect(entityArtLayout(900, 220, false).mode).toBe("side");
  });

  it("drops the art when there's no room for it", () => {
    expect(entityArtLayout(160, 60, false).mode).toBe("none");
  });

  it("sets an avatar beside the name, or on top in a narrow, tall card", () => {
    expect(entityArtLayout(320, 150, true).mode).toBe("side");
    expect(entityArtLayout(180, 260, true).mode).toBe("top");
  });
});

describe("resize limits", () => {
  const ratio = cardSizeLimits({ type: "entity" }).ratio;

  it("keeps a live card tall enough for its kind line and text", () => {
    expect(cardSizeLimits({ type: "entity" }).minHeight).toBe(120);
  });

  it("refuses a step that stretches a live card past its ratio range", () => {
    expect(ratioStepAllowed(ratio, { w: 300, h: 200 }, { w: 900, h: 200 })).toBe(false);
    expect(ratioStepAllowed(ratio, { w: 300, h: 200 }, { w: 400, h: 200 })).toBe(true);
  });

  it("lets a card saved outside the range move back toward it", () => {
    expect(ratioStepAllowed(ratio, { w: 1000, h: 120 }, { w: 900, h: 120 })).toBe(true);
    expect(ratioStepAllowed(ratio, { w: 1000, h: 120 }, { w: 1100, h: 120 })).toBe(false);
  });

  it("leaves other cards' ratio free", () => {
    expect(
      ratioStepAllowed(cardSizeLimits({ type: "text" }).ratio, { w: 1, h: 1 }, { w: 99, h: 1 }),
    ).toBe(true);
  });
});

describe("hasMarkdown", () => {
  it("spots block and inline Markdown", () => {
    for (const text of [
      "## Boss",
      "- jump",
      "1. first",
      "> note",
      "```js",
      "a **b**",
      "see [[Plan]]",
      "[x](https://a.b)",
    ]) {
      expect(hasMarkdown(text), text).toBe(true);
    }
  });

  it("leaves plain text alone", () => {
    expect(hasMarkdown("this is some typing")).toBe(false);
    expect(hasMarkdown("3 - 2 = 1")).toBe(false);
  });

  it("gives Markdown text a larger minimum size", () => {
    expect(cardSizeLimits({ type: "text", text: "- a\n- b" })).toEqual({
      minWidth: 200,
      minHeight: 100,
    });
    expect(cardSizeLimits({ type: "text", text: "plain" })).toEqual({
      minWidth: 120,
      minHeight: 60,
    });
  });
});
