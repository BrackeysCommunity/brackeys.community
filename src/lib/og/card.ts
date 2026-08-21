import { BG, DIM, FG, MUTED, OG_ACCENT_TEXT, OG_ACCENTS, type OgKind } from "./palette";

export { OG_ACCENTS, OG_ACCENT_TEXT, type OgKind } from "./palette";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface OgNode {
  type: string;
  props: Record<string, unknown>;
}

type Child = OgNode | string | null | false | undefined;

function h(type: string, style: Record<string, unknown>, ...children: Child[]): OgNode {
  const kept = children.filter((child): child is OgNode | string => Boolean(child));
  return {
    type,
    props: {
      // Satori defaults to `block`, which it only partially implements.
      style: { display: "flex", ...style },
      children: kept.length === 1 ? kept[0] : kept,
    },
  };
}

/** Source and box are real props, not style — satori renders nothing if they land in `style`. */
function img(
  src: string,
  width: number,
  height: number,
  style: Record<string, unknown> = {},
): OgNode {
  return { type: "img", props: { src, width, height, style } };
}

/** The spine's colours, top to bottom. Constant across every card. */
const SPINE = [OG_ACCENTS.project, OG_ACCENTS.collab, OG_ACCENTS.jam] as const;
const SPINE_WIDTH = 12;

/** Where the content column starts. */
const PAD_X = 76;

function dataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** The bracket mark, in whatever colour the surface needs. */
function markSvg(fill: string): string {
  const bar = (x: number, y: number, w: number, hgt: number) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${hgt}" fill="${fill}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><g transform="translate(128,128) rotate(-45)">${bar(-80, -80, 45, 160)}${bar(-80, -80, 75, 40)}${bar(-80, 40, 75, 40)}${bar(35, -80, 45, 160)}${bar(5, -80, 75, 40)}${bar(5, 40, 75, 40)}</g></svg>`;
}

const MARK_DATA_URI = dataUri(markSvg(FG));

/**
 * The whole background — base, corner glow, a soft disc and the app's dot
 * field — as one full-bleed SVG image.
 *
 * All of it is here for the same reason: satori's own CSS is not up to any
 * of it. There is no `background-repeat`, so the dot field could never be a
 * tiled background; and its gradients rasterize with a hard terminating
 * edge, so an accent wash came out as a smudge with a straight line across
 * the card. Handing the rasterizer real SVG gets a tiled pattern and a
 * smooth falloff from the one thing in this pipeline that is good at both.
 */
function glowStops(accent: string): string {
  return [
    [0, 0.3],
    [0.3, 0.13],
    [0.6, 0.04],
    [1, 0],
  ]
    .map(
      ([offset, opacity]) =>
        `<stop offset="${offset}" stop-color="${accent}" stop-opacity="${opacity}"/>`,
    )
    .join("");
}

function backgroundDataUri(accent: string): string {
  const glow = glowStops(accent);

  return dataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">` +
      `<defs>` +
      `<radialGradient id="glow" cx="0.06" cy="-0.1" r="0.9">${glow}</radialGradient>` +
      // Flat white at 3% still draws a crisp arc across the card; the disc
      // has to fade out at its own edge to read as light rather than as a
      // shape somebody put there.
      `<radialGradient id="disc" cx="0.5" cy="0.5" r="0.5">` +
      `<stop offset="0" stop-color="#ffffff" stop-opacity="0.05"/>` +
      `<stop offset="0.6" stop-color="#ffffff" stop-opacity="0.028"/>` +
      `<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>` +
      `</radialGradient>` +
      `</defs>` +
      `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${BG}"/>` +
      // A single large disc off the top-right corner. Almost invisible on
      // its own; what it does is stop the unlit half of the card from being
      // a flat rectangle, which is what made the first cut read as bland.
      `<circle cx="1010" cy="70" r="380" fill="url(#disc)"/>` +
      `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#glow)"/>` +
      `</svg>`,
  );
}

/**
 * The app's dot field, painted *over* the art rather than behind it.
 *
 * Behind, it stopped dead at the art's left edge and drew a vertical seam
 * down the card. Over everything, it is one surface — which is what the
 * dots are for on the site too.
 */
const DOT_FIELD_DATA_URI = dataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">` +
    `<defs><pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">` +
    `<circle cx="1.6" cy="1.6" r="1.6" fill="#ffffff" fill-opacity="0.06"/>` +
    `</pattern></defs>` +
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#dots)"/>` +
    `</svg>`,
);

/**
 * What sits between full-bleed cover art and the text: a near-opaque wash
 * of the background colour, slightly more open on the right, where no
 * text goes, so the cover stays recognisable there instead of reading as
 * a stain. Pass an accent to add the house glow on top; letterboxed jam
 * banners skip it — their backdrop is the jam's own colour, and the glow
 * would sit on it as a foreign smudge.
 */
function artDimDataUri(accent: string | null): string {
  const glow = accent
    ? `<radialGradient id="glow" cx="0.06" cy="-0.1" r="0.9">${glowStops(accent)}</radialGradient>`
    : "";
  const glowRect = accent
    ? `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#glow)"/>`
    : "";
  return dataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">` +
      `<defs>` +
      `<linearGradient id="dim" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0" stop-color="${BG}" stop-opacity="0.97"/>` +
      `<stop offset="0.55" stop-color="${BG}" stop-opacity="0.92"/>` +
      `<stop offset="1" stop-color="${BG}" stop-opacity="0.78"/>` +
      `</linearGradient>` +
      glow +
      `</defs>` +
      `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#dim)"/>` +
      glowRect +
      `</svg>`,
  );
}

export interface OgStat {
  value: string;
  label: string;
}

export interface OgArt {
  /** A data URI. Remote URLs are fetched and inlined before we get here. */
  dataUri: string;
  /**
   * A `panel` cover dims into the full-bleed background; a `letterbox`
   * banner keeps its own aspect against `backdrop`, the way the app's jam
   * cards letterbox against the itch theme colour; a person is a disc.
   */
  shape: "panel" | "circle" | "letterbox";
  /** Fill behind a letterboxed banner — the jam page's own colour. */
  backdrop?: string;
}

export interface OgCardInput {
  kind: OgKind;
  /** The small coloured word above the title — "GAME JAM", "OPEN ROLE". */
  eyebrow: string;
  title: string;
  subtitle?: string | null;
  /** Up to three; anything past that is dropped rather than crowded in. */
  stats?: OgStat[];
  art?: OgArt | null;
}

/** Cuts on a word boundary when there is one nearby, else mid-word. */
function clamp(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Titles run from "IO" to a 90-character jam name, and a single size makes
 * one of those look lost and the other overflow.
 */
function titleSize(title: string): number {
  if (title.length <= 22) return 78;
  if (title.length <= 46) return 64;
  if (title.length <= 78) return 52;
  return 44;
}

export function ogCard(input: OgCardInput): OgNode {
  const accent = OG_ACCENTS[input.kind];
  const accentText = OG_ACCENT_TEXT[input.kind];
  const bleeding = input.art?.shape === "panel";
  const letterboxed = input.art?.shape === "letterbox";
  const disc = input.art?.shape === "circle";
  const columnWidth = disc ? 700 : OG_WIDTH - PAD_X * 2;
  const title = clamp(input.title, 96);
  const stats = (input.stats ?? []).slice(0, 3);

  return h(
    "div",
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      backgroundColor: BG,
      fontFamily: "Rubik",
      position: "relative",
    },

    // Cover art is the whole background, dimmed; the plain background
    // stands in everywhere else.
    input.art && letterboxed
      ? letterboxArt(input.art)
      : input.art && bleeding
        ? bleedArt(input.art, accent)
        : h(
            "div",
            { position: "absolute", top: 0, left: 0 },
            img(backgroundDataUri(accent), OG_WIDTH, OG_HEIGHT),
          ),

    // With no art the right half is empty, and at this size empty reads as
    // unfinished. The mark bleeds off the corner so it stays a watermark
    // rather than looking like a second logo placed in the composition.
    !input.art
      ? h(
          "div",
          { position: "absolute", top: 214, left: 902, opacity: 0.05 },
          img(MARK_DATA_URI, 470, 470),
        )
      : null,

    h(
      "div",
      { position: "absolute", top: 0, left: 0 },
      img(DOT_FIELD_DATA_URI, OG_WIDTH, OG_HEIGHT),
    ),

    // The spine: the one element identical on every card, and the reason a
    // Brackeys link is identifiable before any of the words are read.
    h("div", {
      position: "absolute",
      top: 0,
      left: 0,
      width: SPINE_WIDTH,
      height: OG_HEIGHT,
      backgroundImage: `linear-gradient(180deg, ${SPINE[0]} 0%, ${SPINE[1]} 52%, ${SPINE[2]} 100%)`,
    }),

    h(
      "div",
      {
        flexDirection: "column",
        justifyContent: "space-between",
        width: OG_WIDTH,
        height: OG_HEIGHT,
        padding: `62px ${PAD_X}px 58px ${PAD_X}px`,
      },

      h(
        "div",
        // Centred in the space the wordmark leaves, rather than pinned to
        // the top: top-aligned, the block sat in the upper third and left
        // half the card visibly empty under it.
        { flexDirection: "column", justifyContent: "center", flex: 1, width: columnWidth },

        h(
          "div",
          {
            fontFamily: "JetBrains Mono",
            fontSize: 16,
            fontWeight: 500,
            letterSpacing: "0.26em",
            color: accentText,
          },
          clamp(input.eyebrow.toUpperCase(), 34),
        ),

        h(
          "div",
          {
            fontSize: titleSize(title),
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: "-0.022em",
            color: FG,
            marginTop: 26,
          },
          title,
        ),

        // The short rule under the headline. Small, and it does most of the
        // work of making the block read as composed rather than stacked.
        h("div", {
          width: 84,
          height: 5,
          borderRadius: 3,
          backgroundColor: accent,
          marginTop: 30,
        }),

        // A narrower measure than the headline gets, for two reasons: 24px
        // across the full column is an uncomfortably long line to read, and
        // without the cap the second line ran under the corner watermark.
        input.subtitle
          ? h(
              "div",
              {
                fontSize: 24,
                lineHeight: 1.45,
                color: MUTED,
                marginTop: 26,
                maxWidth: 840,
              },
              clamp(input.subtitle, 165),
            )
          : null,

        // Under the subtitle rather than down beside the wordmark: pinned to
        // the bottom it left a third of the card empty, and it reads as a
        // caption on the headline anyway.
        stats.length > 0 ? h("div", { marginTop: 34 }, statLine(stats)) : null,
      ),

      // The disc sits in the gutter the narrow column leaves, vertically
      // centred against the whole card rather than against the text.
      input.art && disc ? discArt(input.art, accent) : null,

      h(
        "div",
        { alignItems: "center" },
        img(MARK_DATA_URI, 27, 27, { marginRight: 13 }),
        h("div", { fontSize: 22, fontWeight: 700, color: FG }, "brackeys.community"),
      ),
    ),
  );
}

/**
 * The facts as one line — "1,204 ENTRIES · 8,912 RATINGS · VOTING" — rather
 * than the three bordered columns this started as. Same information, and it
 * sits under the headline as a caption instead of competing with it for the
 * bottom of the card.
 */
function statLine(stats: OgStat[]): OgNode {
  const parts: OgNode[] = [];
  stats.forEach((stat, index) => {
    if (index > 0) {
      parts.push(h("div", { color: DIM, fontSize: 18, margin: "0 14px" }, "·"));
    }
    parts.push(
      h(
        "div",
        { alignItems: "baseline" },
        h("div", { fontSize: 21, fontWeight: 700, color: FG }, stat.value),
        h(
          "div",
          {
            fontFamily: "JetBrains Mono",
            fontSize: 14,
            letterSpacing: "0.2em",
            color: DIM,
            marginLeft: 9,
          },
          stat.label.toUpperCase(),
        ),
      ),
    );
  });
  return h("div", { alignItems: "baseline" }, ...parts);
}

/**
 * Cover art as the card's whole background. The right-edge crop this
 * replaces gambled on the cover's composition — a banner with its title in
 * the centre arrived beheaded. Full-bleed and dimmed, any cover reads as
 * texture and colour, and none of them can break the layout.
 */
function bleedArt(art: OgArt, accent: string): OgNode {
  return h(
    "div",
    { position: "absolute", top: 0, left: 0, width: OG_WIDTH, height: OG_HEIGHT },
    img(art.dataUri, OG_WIDTH, OG_HEIGHT, { objectFit: "cover" }),
    h(
      "div",
      { position: "absolute", top: 0, left: 0 },
      img(artDimDataUri(accent), OG_WIDTH, OG_HEIGHT),
    ),
  );
}

/**
 * A jam banner at its own aspect against the jam page's colour — the same
 * composition as the app's jam cards and the jam's own itch header —
 * dimmed, with no glow: the backdrop already is the jam's colour.
 */
function letterboxArt(art: OgArt): OgNode {
  return h(
    "div",
    {
      position: "absolute",
      top: 0,
      left: 0,
      width: OG_WIDTH,
      height: OG_HEIGHT,
      backgroundColor: art.backdrop ?? BG,
    },
    img(art.dataUri, OG_WIDTH, OG_HEIGHT, { objectFit: "contain" }),
    h(
      "div",
      { position: "absolute", top: 0, left: 0 },
      img(artDimDataUri(null), OG_WIDTH, OG_HEIGHT),
    ),
  );
}

/** An avatar, ringed in the accent so a borrowed image still belongs to the card. */
function discArt(art: OgArt, accent: string): OgNode {
  const size = 270;
  return h(
    "div",
    {
      position: "absolute",
      top: (OG_HEIGHT - size) / 2,
      left: OG_WIDTH - PAD_X - size,
      width: size,
      height: size,
      borderRadius: 999,
      overflow: "hidden",
      border: `3px solid ${accent}66`,
      backgroundColor: "#17171d",
    },
    img(art.dataUri, size, size, { objectFit: "cover" }),
  );
}
