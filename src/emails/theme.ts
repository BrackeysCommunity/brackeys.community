import type { NotificationCategory } from "../lib/notification-copy";
/**
 * Email design tokens — the same palette the OG renderer draws with
 * (`src/lib/og/palette.ts`), never a retyped copy. Type follows the house
 * rules: Rubik for headings and prose, mono reserved for the micro-label
 * voice (masthead, button caps). The unsub confirmation page shares these
 * so the out-of-app surfaces can't drift apart.
 */
import { BG, DIM, FG, MUTED, OG_ACCENT_TEXT, OG_ACCENTS } from "../lib/og/palette";

export { BG, DIM, FG, MUTED };

/** The app's `--primary` (blurple) — buttons and other filled accents. */
export const ACCENT = OG_ACCENTS.project;
/** Accent lifted for small text on near-black; fills don't read as type. */
export const ACCENT_TEXT = "#b3b9fc";
/** Hairline rules between rows and above footers. */
export const HAIRLINE = "#26262f";
/** The Well: content sits on a slightly lifted card, like the app's panels. */
export const CARD_BG = "#12131b";

/** The OG cards' spine, left to right — the brand's three-colour signature. */
export const SPINE = [OG_ACCENTS.project, OG_ACCENTS.collab, OG_ACCENTS.jam] as const;

/**
 * Category micro-labels use the text-safe accent for their surface, same
 * mapping the OG cards draw from. Moderation borrows the jam amber — a
 * caution colour, and the only one left that isn't already claimed.
 */
export const CATEGORY_ACCENT_TEXT: Record<NotificationCategory, string> = {
  collab: OG_ACCENT_TEXT.collab,
  teams: OG_ACCENT_TEXT.team,
  jams: OG_ACCENT_TEXT.jam,
  comments: OG_ACCENT_TEXT.project,
  moderation: OG_ACCENT_TEXT.jam,
};

/**
 * Rubik loads via `<Font>` in clients that honour web fonts (Apple Mail,
 * iOS Mail, Thunderbird); everywhere else this stack falls through to the
 * platform sans instead of the platform's Courier.
 */
export const FONT_SANS = "Rubik, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
/** Micro-label voice only — never body copy or headings. */
export const FONT_MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

/** Rubik is a variable font; 400 and 700 share one latin woff2. */
export const RUBIK_WOFF2_URL =
  "https://fonts.gstatic.com/s/rubik/v31/iJWKBXyIfDnIV7nBrXyw023e.woff2";

// ── Shared style objects ────────────────────────────────────────────────────

export const headingStyle = {
  fontFamily: FONT_SANS,
  fontSize: "20px",
  fontWeight: 700,
  color: FG,
  margin: "8px 0 16px",
} as const;

export const textStyle = {
  fontFamily: FONT_SANS,
  fontSize: "14px",
  color: MUTED,
  margin: "8px 0",
  lineHeight: 1.6,
} as const;

export const microLabelStyle = {
  fontFamily: FONT_MONO,
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.2em",
  textTransform: "uppercase" as const,
  color: FG,
  margin: 0,
} as const;

export const buttonStyle = {
  backgroundColor: ACCENT,
  color: "#ffffff",
  fontFamily: FONT_SANS,
  fontSize: "14px",
  fontWeight: 700,
  padding: "12px 24px",
  borderRadius: "8px",
  textDecoration: "none",
} as const;

export const hrStyle = { borderColor: HAIRLINE, margin: "24px 0" } as const;

export const footerStyle = {
  fontFamily: FONT_SANS,
  fontSize: "12px",
  color: DIM,
  lineHeight: 1.6,
  margin: "8px 0 0",
} as const;

export const linkStyle = { color: ACCENT_TEXT, textDecoration: "underline" } as const;
