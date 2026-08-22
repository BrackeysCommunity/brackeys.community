import { describe, expect, it } from "vite-plus/test";

import { htmlToParagraphs, htmlToPlainText } from "@/lib/html-text";

describe("htmlToParagraphs", () => {
  it("returns nothing for empty input", () => {
    expect(htmlToParagraphs(null)).toEqual([]);
    expect(htmlToParagraphs(undefined)).toEqual([]);
    expect(htmlToParagraphs("")).toEqual([]);
    expect(htmlToParagraphs("   \n  ")).toEqual([]);
  });

  it("splits on block boundaries and strips inline tags", () => {
    expect(
      htmlToParagraphs("<p>Make a <strong>game</strong> in a week.</p><p>Then rate.</p>"),
    ).toEqual(["Make a game in a week.", "Then rate."]);
  });

  it("treats <br> as a line break", () => {
    expect(htmlToParagraphs("one<br>two")).toEqual(["one", "two"]);
  });

  it("collapses source indentation inside a line", () => {
    expect(htmlToParagraphs("<p>\n  spread   over\n  lines\n</p>")).toEqual(["spread over lines"]);
  });

  it("drops the contents of non-prose elements entirely", () => {
    // A regex tag-strip alone would surface the script body as visible copy.
    expect(htmlToParagraphs('<p>real</p><script>alert("xss")</script>')).toEqual(["real"]);
    expect(htmlToParagraphs("<style>.a{color:red}</style><p>real</p>")).toEqual(["real"]);
  });

  it("drops comments", () => {
    expect(htmlToParagraphs("<!-- hidden --><p>shown</p>")).toEqual(["shown"]);
  });

  it("decodes the entities a sentence actually uses", () => {
    expect(htmlToParagraphs("<p>Rock&nbsp;&amp;&nbsp;roll &quot;jam&quot;</p>")).toEqual([
      'Rock & roll "jam"',
    ]);
  });

  it("does not double-decode an escaped entity into markup", () => {
    // `&amp;lt;` is the literal text "&lt;", not "<".
    expect(htmlToParagraphs("<p>&amp;lt;p&amp;gt;</p>")).toEqual(["&lt;p&gt;"]);
  });

  it("keeps list items as separate lines", () => {
    expect(htmlToParagraphs("<ul><li>one</li><li>two</li></ul>")).toEqual(["one", "two"]);
  });
});

describe("htmlToPlainText", () => {
  it("returns undefined rather than an empty string, so meta tags drop out", () => {
    expect(htmlToPlainText(null)).toBeUndefined();
    expect(htmlToPlainText("<p></p>")).toBeUndefined();
  });

  it("joins paragraphs into one line", () => {
    expect(htmlToPlainText("<p>one</p><p>two</p>")).toBe("one two");
  });

  it("leaves text under the limit untouched", () => {
    expect(htmlToPlainText("<p>short</p>", 20)).toBe("short");
  });

  it("clips on a word boundary near the limit", () => {
    const out = htmlToPlainText("<p>alpha beta gamma delta epsilon</p>", 16)!;
    expect(out).toBe("alpha beta…");
    expect(out.length).toBeLessThanOrEqual(17);
  });

  it("hard-clips when no space falls near the limit", () => {
    // A single long token must not gut the whole description.
    expect(htmlToPlainText(`<p>${"x".repeat(50)}</p>`, 10)).toBe("xxxxxxxxxx…");
  });
});
