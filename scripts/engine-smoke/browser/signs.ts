/**
 * The sign run's fonts, scene and reads, shared by the page, the runner and
 * their tests. The runner adds two fonts to its copy of the engine project:
 * a text BMFont whose every glyph is a box cut from the `crates` atlas's
 * one-colour crate-0 frame, and Rubik (OFL-1.1, from the site's
 * `@fontsource-variable/rubik` dependency) as a WOFF2. The page draws a
 * world `text` sign in each and reads a grid of pixels over it.
 */
import { INSIDE_COLOUR } from "./sink";

/** Beside `art/crates.png`, so its one page resolves to that texture. */
export const SIGN_BITMAP_PATH = "art/sign-bitmap.fnt";
export const SIGN_WEB_PATH = "art/sign-web.woff2";

/** Where the runner reads the web font from, as a package path. */
export const SIGN_WEB_SOURCE = "@fontsource-variable/rubik/files/rubik-latin-wght-normal.woff2";
export const SIGN_WEB_LICENCE = "OFL-1.1";

export const SIGN_TEXT = "SIGN";

/** World px; 1 m is 100 px in the smoke game. */
export const SIGN_SIZE = 48;

/** The web sign's colour, which no other visual of the scene draws. */
export const SIGN_WEB_COLOUR = 0x40e0ff;

/** A bitmap glyph draws its page's pixels under a white tint: crate-0's colour. */
export const SIGN_BITMAP_COLOUR = INSIDE_COLOUR;

export type SignFont = "bitmap" | "web";

export const SIGNS: Readonly<
  Record<
    SignFont,
    {
      entity: string;
      at: readonly [x: number, y: number];
      colour: number;
      /** The world rectangle the camera frames while the sign is read, metres. */
      frame: { minX: number; minY: number; maxX: number; maxY: number };
    }
  >
> = {
  bitmap: {
    entity: "sign-bitmap",
    at: [3, 2],
    colour: SIGN_BITMAP_COLOUR,
    frame: { minX: 1.8, minY: 1.4, maxX: 4.2, maxY: 2.6 },
  },
  web: {
    entity: "sign-web",
    at: [3, 5],
    colour: SIGN_WEB_COLOUR,
    frame: { minX: 1.8, minY: 4.4, maxX: 4.2, maxY: 5.6 },
  },
};

/** Points read across a sign's frame, columns by rows. */
export const SIGN_GRID = [48, 24] as const;

/** How long the page waits for a sign's font to load and draw. */
export const SIGN_WAIT_MS = 15_000;

/** Glyph boxes inside crate-0's 16 px square, so every texel a glyph samples is its colour. */
const GLYPH = { width: 10, height: 12, advance: 12 } as const;

/** The bitmap sign's font: a text BMFont with a space and one box glyph per letter of `SIGN_TEXT`. */
export function signBmfont(): string {
  const letters = [...new Set(SIGN_TEXT)].map((c) => c.codePointAt(0)!);
  const char = (id: number, width: number, height: number, advance: number) =>
    `char id=${id} x=0 y=0 width=${width} height=${height} xoffset=0 yoffset=2 xadvance=${advance} page=0 chnl=15`;
  return [
    'info face="Smoke Sign" size=16 bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=0 aa=1 padding=0,0,0,0 spacing=1,1 outline=0',
    "common lineHeight=16 base=14 scaleW=32 scaleH=16 pages=1 packed=0 alphaChnl=0 redChnl=4 greenChnl=4 blueChnl=4",
    'page id=0 file="crates.png"',
    `chars count=${letters.length + 1}`,
    char(32, 0, 0, GLYPH.advance),
    ...letters.map((id) => char(id, GLYPH.width, GLYPH.height, GLYPH.advance)),
    "",
  ].join("\n");
}

/** The sign scene: both signs on markers in empty air, no physics; `fonts` are the two font assets' ids. */
export function signSceneJson(fonts: Readonly<Record<SignFont, string>>): Record<string, unknown> {
  const sign = (font: SignFont) => ({
    id: SIGNS[font].entity,
    type: "marker",
    at: [...SIGNS[font].at],
    behaviors: {
      text: {
        text: SIGN_TEXT,
        font: fonts[font],
        size: SIGN_SIZE,
        color: font === "web" ? SIGN_WEB_COLOUR : 0xffffff,
      },
    },
  });
  return {
    v: 5,
    name: "smoke-signs",
    bounds: [0, 0, 6, 7],
    settings: { physics: "none" },
    entities: [sign("bitmap"), sign("web")],
  };
}

/** The world points `SIGN_GRID` reads over `frame`, row by row, each at its cell's centre. */
export function signGrid(frame: (typeof SIGNS)[SignFont]["frame"]): { x: number; y: number }[] {
  const [cols, rows] = SIGN_GRID;
  const w = (frame.maxX - frame.minX) / cols;
  const h = (frame.maxY - frame.minY) / rows;
  const points: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      points.push({ x: frame.minX + (c + 0.5) * w, y: frame.minY + (r + 0.5) * h });
  return points;
}
