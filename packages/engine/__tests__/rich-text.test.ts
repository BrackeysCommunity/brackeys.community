import { describe, expect, it } from "vite-plus/test";

import type { FontMeta } from "../project/kinds/font";
import { measureText } from "../text/measure";
import { drawnText, escapeRich, parseRichText, plainText, type RichLine } from "../text/rich";

const one = (source: string, vars?: Record<string, string | number>) => {
  const { lines, warnings } = parseRichText(source, vars);
  expect(lines).toHaveLength(1);
  return { spans: lines[0]!, warnings };
};

describe("parseRichText", () => {
  it("gives plain text as one span", () => {
    expect(parseRichText("Hello")).toEqual({ lines: [[{ text: "Hello" }]], warnings: [] });
    expect(parseRichText("")).toEqual({ lines: [[]], warnings: [] });
  });

  it("reads every tag", () => {
    expect(one("a[b]b[/b]").spans).toEqual([{ text: "a" }, { text: "b", bold: true }]);
    expect(one("[i]x[/i]").spans).toEqual([{ text: "x", italic: true }]);
    expect(one("[color=#FF8000]x[/color]").spans).toEqual([{ text: "x", color: 0xff8000 }]);
    expect(one("[size=24]x[/size]").spans).toEqual([{ text: "x", size: 24 }]);
    expect(one("[size=10.5]x[/size]").spans).toEqual([{ text: "x", size: 10.5 }]);
    expect(one("[shake]x[/shake]").spans).toEqual([{ text: "x", effect: "shake" }]);
    expect(one("[wave]x[/wave]").spans).toEqual([{ text: "x", effect: "wave" }]);
    const { spans, warnings } = one("Press [icon=buttons:a-key] to jump");
    expect(spans).toEqual([
      { text: "Press " },
      { text: "", icon: { asset: "buttons", frame: "a-key" } },
      { text: " to jump" },
    ]);
    expect(warnings).toEqual([]);
  });

  it("nests tags, inner values winning, and closes them out of order", () => {
    expect(one("[b]a[color=#000010]b[size=8]c[/size][/color]d[/b]").spans).toEqual([
      { text: "a", bold: true },
      { text: "b", bold: true, color: 0x10 },
      { text: "c", bold: true, color: 0x10, size: 8 },
      { text: "d", bold: true },
    ]);
    expect(one("[shake]a[wave]b[/wave]c[/shake]").spans).toEqual([
      { text: "a", effect: "shake" },
      { text: "b", effect: "wave" },
      { text: "c", effect: "shake" },
    ]);
    expect(one("[b]a[i]b[/b]c[/i]").spans).toEqual([
      { text: "a", bold: true },
      { text: "b", bold: true, italic: true },
      { text: "c", italic: true },
    ]);
    expect(one("[b]a[b]b[/b]c[/b]d").spans).toEqual([{ text: "abc", bold: true }, { text: "d" }]);
  });

  it("styles an icon like the text around it", () => {
    expect(one("[color=#00ff00][icon=ui:coin][/color]").spans).toEqual([
      { text: "", color: 0x00ff00, icon: { asset: "ui", frame: "coin" } },
    ]);
  });

  it("splits lines, carrying open styles across them", () => {
    const { lines, warnings } = parseRichText("[b]one\ntwo[/b]\r\n\nthree");
    expect(lines).toEqual([
      [{ text: "one", bold: true }],
      [{ text: "two", bold: true }],
      [],
      [{ text: "three" }],
    ]);
    expect(warnings).toEqual([]);
  });

  it("escapes brackets, braces and backslashes", () => {
    expect(parseRichText("\\[b]not bold\\[/b]")).toEqual({
      lines: [[{ text: "[b]not bold[/b]" }]],
      warnings: [],
    });
    expect(parseRichText("\\{name} and \\\\", { name: "x" })).toEqual({
      lines: [[{ text: "{name} and \\" }]],
      warnings: [],
    });
    expect(one("a\\b").spans).toEqual([{ text: "a\\b" }]);
  });

  it("fills {name} from vars, as text and never as markup", () => {
    expect(one("Hi {player}, {count} coins", { player: "[b]Ada", count: 3 })).toEqual({
      spans: [{ text: "Hi [b]Ada, 3 coins" }],
      warnings: [],
    });
    expect(one("[b]{n}[/b]", { n: 0 }).spans).toEqual([{ text: "0", bold: true }]);
  });

  it("leaves a missing var as {name} with a warning", () => {
    const { spans, warnings } = one("Hi {player}!", { other: "x" });
    expect(spans).toEqual([{ text: "Hi {player}!" }]);
    expect(warnings).toEqual(["{player} has no value; it shows as written"]);
    expect(one("{toString}", {}).warnings).toHaveLength(1);
    expect(one("{ not a var }").warnings).toEqual([]);
  });

  it("keeps unknown and malformed tags literal, with a warning each", () => {
    const cases: [string, string][] = [
      ["[u]x[/u]", "[u]: unknown tag; it shows as written"],
      ["[color=red]x", "[color=red]: [color] needs #rrggbb; it shows as written"],
      ["[size=0]x", "[size=0]: [size] needs a number above 0, up to 512; it shows as written"],
      ["[size=big]x", "[size=big]: [size] needs a number above 0, up to 512; it shows as written"],
      ["[b=1]x", "[b=1]: [b] takes no value; it shows as written"],
      ["[icon=coin]x", "[icon=coin]: [icon] needs asset:frame; it shows as written"],
      ["x[/b]", "[/b]: it closes nothing; it shows as written"],
    ];
    for (const [source, warning] of cases) {
      const { lines, warnings } = parseRichText(source);
      expect(warnings[0], source).toBe(warning);
      expect(
        lines.flat().map((span) => span.text),
        source,
      ).toEqual([source]);
    }
    expect(parseRichText("[u]x[/u]").warnings).toHaveLength(2);
    expect(parseRichText("[not a tag] [B]").warnings).toEqual([]);
  });

  it("warns about a tag left open", () => {
    const { lines, warnings } = parseRichText("[b][wave]x");
    expect(lines).toEqual([[{ text: "x", bold: true, effect: "wave" }]]);
    expect(warnings).toEqual(["[b] is never closed", "[wave] is never closed"]);
  });
});

describe("plainText", () => {
  it("removes the markup and keeps lines, escapes and vars", () => {
    expect(
      plainText("[b]Hi[/b] [color=#ff0000]{who}[/color] [icon=ui:coin]\\[x]\n[wave]bye[/wave]", {
        who: "Ada",
      }),
    ).toBe("Hi Ada [x]\nbye");
    expect(plainText("[u]kept[/u] {gone}")).toBe("[u]kept[/u] {gone}");
  });
});

describe("drawnText", () => {
  it("leaves out markup, icons and placeholders, and keeps a malformed tag as it draws", () => {
    expect(drawnText("[b]Hi[/b] {who} [icon=ui:coin]\\{x}")).toBe("Hi  {x}");
    expect(drawnText("[color=red]a[/color]")).toBe("[color=red]a[/color]");
  });
});

describe("escapeRich", () => {
  it("escapes what the parser reads as markup, but what `except` keeps", () => {
    const source = "[b] {n} \\";
    expect(escapeRich(source)).toBe("\\[b] \\{n} \\\\");
    expect(parseRichText(escapeRich(source)).lines).toEqual([[{ text: source }]]);
    expect(plainText(escapeRich(source, "{"), { n: 1 })).toBe("[b] 1 \\");
  });
});

/** A hand-written BMFont face: 16 px, 20 px lines. */
const FACE: FontMeta & {
  size: number;
  advances: Record<string, number>;
  kerning: [number, number, number][];
} = {
  format: "bmfont",
  lineHeight: 20,
  pages: ["face_0.png"],
  size: 16,
  advances: { "32": 4, "65": 10, "86": 11, "84": 9, "111": 8, "87": 14, "128512": 16 },
  kerning: [
    [65, 86, -2],
    [86, 65, -2],
    [84, 111, -1],
  ],
};
const lines = (source: string): readonly RichLine[] => parseRichText(source).lines;

function expectMeasure(
  got: { width: number; height: number; exact: boolean },
  want: { width: number; height: number },
  exact: boolean,
): void {
  expect(got.width).toBeCloseTo(want.width, 9);
  expect(got.height).toBeCloseTo(want.height, 9);
  expect(got.exact).toBe(exact);
}

describe("measureText", () => {
  it("measures a BMFont face exactly: advances plus kerning", () => {
    expect(measureText(lines("AVA"), FACE, 16)).toEqual({
      width: 10 + 11 + 10 - 2 - 2,
      height: 20,
      exact: true,
    });
    expect(measureText(lines("To W"), FACE, 16)).toEqual({
      width: 9 + 8 - 1 + 4 + 14,
      height: 20,
      exact: true,
    });
    expect(measureText(lines("\u{1F600}"), FACE, 16).width).toBe(16);
  });

  it("scales advances, kerning and line height to the size", () => {
    expect(measureText(lines("AV"), FACE, 32)).toEqual({ width: 38, height: 40, exact: true });
    expect(measureText(lines("A[size=32]V[/size]"), FACE, 16)).toEqual({
      width: 10 + 22,
      height: 40,
      exact: true,
    });
    expect(measureText(lines("AV\nT\n"), FACE, 16)).toEqual({
      width: 19,
      height: 60,
      exact: true,
    });
  });

  it("applies kerning across spans of one size only", () => {
    expect(measureText(lines("A[b]V[/b]"), FACE, 16).width).toBe(19);
  });

  it("wraps greedily at spaces, dropping the spaces at a break", () => {
    const text = lines("AVA AVA AVA");
    expect(measureText(text, FACE, 16, 1000)).toEqual({
      width: 27 * 3 + 8,
      height: 20,
      exact: true,
    });
    expect(measureText(text, FACE, 16, 27 * 2 + 4)).toEqual({
      width: 27 * 2 + 4,
      height: 40,
      exact: true,
    });
    expect(measureText(text, FACE, 16, 20)).toEqual({ width: 27, height: 60, exact: true });
    expect(measureText(lines("W AVAVAVA"), FACE, 16, 20)).toEqual({
      width: 10 * 4 + 11 * 3 - 2 * 6,
      height: 40,
      exact: true,
    });
    expect(measureText(lines("AVA  "), FACE, 16, 1000).width).toBe(27 + 8);
    expect(measureText(lines("AVA  "), FACE, 16, 27).width).toBe(27);
    expect(measureText(lines(""), FACE, 16, 20)).toEqual({ width: 0, height: 20, exact: true });
  });

  it("estimates a glyph the face lacks and an inline icon, flagging the result", () => {
    expectMeasure(measureText(lines("Az"), FACE, 16), { width: 10 + 0.55 * 16, height: 20 }, false);
    expect(measureText(lines("A[icon=ui:coin]"), FACE, 16)).toEqual({
      width: 26,
      height: 20,
      exact: false,
    });
  });

  it("estimates a web font at 0.55 × size per character, flagged inexact", () => {
    const web: FontMeta = { format: "woff2" };
    expectMeasure(measureText(lines("Hello"), web, 20), { width: 55, height: 24 }, false);
    expectMeasure(measureText(lines("Hello"), null, 20), { width: 55, height: 24 }, false);
    expectMeasure(measureText(lines("aaaa aaaa"), null, 10, 40), { width: 22, height: 24 }, false);
  });

  it("ignores a BMFont meta without advances", () => {
    const bare: FontMeta = { format: "bmfont", lineHeight: 20, pages: ["face_0.png"] };
    expectMeasure(measureText(lines("AV"), bare, 10), { width: 11, height: 12 }, false);
    expect(measureText([], FACE, 16)).toEqual({ width: 0, height: 0, exact: true });
  });
});
