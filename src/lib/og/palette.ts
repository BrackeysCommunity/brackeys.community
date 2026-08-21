/**
 * The house palette for out-of-app surfaces — OG cards and email. One
 * module with no other imports so the email templates (compiled into the
 * notifications worker) can share it without dragging satori assets in.
 */

/**
 * Near-black with a trace of blue in it, rather than the app's flat
 * `--background`. These surfaces are looked at beside other content — a
 * card in a feed, an email in an inbox — where a true neutral reads as a
 * hole; the lift is two or three values and is the difference between
 * "dark" and "off".
 */
export const BG = "#0b0c12";
/** Very slightly warm, so headlines don't glare against that blue. */
export const FG = "#f7f5f1";
export const MUTED = "#a6a6b2";
export const DIM = "#71717f";

/** Used for the glow, the art hairline and the short rule under the title. */
export const OG_ACCENTS = {
  site: "#ffa949",
  jam: "#ffa949",
  project: "#5865f2",
  collab: "#d2356b",
  profile: "#5865f2",
  team: "#d2356b",
} as const;

/** The fill values above don't read as type at 16px on near-black. */
export const OG_ACCENT_TEXT = {
  site: "#ffbb6b",
  jam: "#ffbb6b",
  project: "#b3b9fc",
  collab: "#f892b2",
  profile: "#b3b9fc",
  team: "#f892b2",
} as const;

export type OgKind = keyof typeof OG_ACCENTS;
