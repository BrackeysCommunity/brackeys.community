// @vitest-environment node
import { bitmapFontTextParser, Texture, TextureSource } from "pixi.js";
import { describe, expect, it } from "vite-plus/test";

import { bitmapFontOn } from "../asset-loader";

const FNT = [
  'info face="Mono" size=10',
  "common lineHeight=12 base=9 scaleW=32 scaleH=16 pages=1",
  'page id=0 file="mono.png"',
  "chars count=3",
  "char id=32 x=0 y=0 width=0 height=0 xoffset=0 yoffset=0 xadvance=4 page=0 chnl=15",
  "char id=65 x=1 y=0 width=5 height=11 xoffset=0 yoffset=0 xadvance=6 page=0 chnl=15",
  "char id=66 x=7 y=0 width=5 height=0 xoffset=0 yoffset=0 xadvance=6 page=0 chnl=15",
].join("\n");

describe("bitmapFontOn", () => {
  it("leaves pixel-less glyphs without a texture, keeping their advance and the page", () => {
    const page = new Texture({ source: new TextureSource({ width: 32, height: 16 }) });
    const font = bitmapFontOn(bitmapFontTextParser.parse(FNT), [page]);

    const space = font.chars[" "]!;
    expect(space.texture).toBeUndefined();
    expect(space.xAdvance).toBe(4);
    expect(font.chars.B!.texture).toBeUndefined();

    const a = font.chars.A!.texture!;
    expect(a.destroyed).toBe(false);
    expect([a.frame.x, a.frame.y, a.frame.width, a.frame.height]).toEqual([1, 0, 5, 11]);
    expect(page.destroyed).toBe(false);
    expect(page.source.destroyed).toBe(false);

    const drawn = Object.values(font.chars).flatMap((c) => (c.texture ? [c.texture.frame] : []));
    expect(drawn.every((f) => f.width > 0 && f.height > 0)).toBe(true);
    font.destroy();
  });
});
