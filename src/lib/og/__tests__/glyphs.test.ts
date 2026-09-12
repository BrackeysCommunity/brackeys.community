import { describe, expect, it } from "vite-plus/test";

import { isDrawable, ogName, ogText } from "@/lib/og/glyphs";

describe("og glyph coverage", () => {
  it("folds fullwidth Latin to ASCII", () => {
    expect(ogName("ＳＡＬＴＹＳＷＥＥＴ")).toBe("SALTYSWEET");
    expect(isDrawable("ＳＡＬＴＹ")).toBe(false);
  });

  it("keeps accented Latin and the punctuation the subset carries", () => {
    expect(ogName("Zoë O’Brien – café")).toBe("Zoë O’Brien – café");
  });

  it("omits a name the fold cannot rescue, and hands back the fallback", () => {
    expect(ogName("山田太郎")).toBeNull();
    expect(ogName("山田太郎", "A Brackeys member")).toBe("A Brackeys member");
    expect(ogName("cookie 🍪")).toBeNull();
    expect(ogName(null, "x")).toBe("x");
    expect(ogName("   ")).toBeNull();
  });

  it("strips undrawable characters from running text and keeps the words", () => {
    expect(ogText("Composer 🎵 and sound designer")).toBe("Composer and sound designer");
    expect(ogText("ｗｉｄｅ words")).toBe("wide words");
  });
});
