/**
 * Who else is on a live canvas: each client's awareness state, its color,
 * and the parser that turns another client's state (anything a peer sent)
 * into something safe to draw.
 */

export interface PresenceColor {
  /** Carets, cursors, outlines, and the fill behind white name tags. */
  color: string;
  /** Text selections in CodeMirror, under the text. */
  colorLight: string;
}

/**
 * Eight colors, each at least 4.5:1 against white (name tags carry white
 * text, and light themes draw them on white) and 3:1 against the dark
 * theme's background. `presence.test.ts` checks both.
 */
export const PRESENCE_COLORS: readonly PresenceColor[] = [
  "#e11d48",
  "#c2410c",
  "#b45309",
  "#15803d",
  "#0e7490",
  "#2563eb",
  "#7c3aed",
  "#a21caf",
].map((color) => ({ color, colorLight: `${color}33` }));

/** The same person gets the same color everywhere, on every canvas. */
export function presenceColor(userId: string): PresenceColor {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return PRESENCE_COLORS[(hash >>> 0) % PRESENCE_COLORS.length]!;
}

export interface PresenceUser extends PresenceColor {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface PeerState {
  user: PresenceUser;
  /** Flow coordinates; null while their pointer is off the canvas. */
  pointer: { x: number; y: number } | null;
  /** Card ids. */
  selection: readonly string[];
  /** The card whose text they have open. */
  editing: string | null;
}

const MAX_NAME = 80;
const MAX_ID = 100;
const MAX_URL = 2048;
const MAX_SELECTION = 200;

const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_ID;

const isCoordinate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e7;

function parsePointer(value: unknown): PeerState["pointer"] {
  if (typeof value !== "object" || value === null) return null;
  const { x, y } = value as Record<string, unknown>;
  return isCoordinate(x) && isCoordinate(y) ? { x, y } : null;
}

function parseAvatar(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_URL) return null;
  return /^https:\/\//.test(value) || value.startsWith("/") ? value : null;
}

/**
 * A peer's awareness state, or null when it isn't one of ours (no user, or
 * a client that only publishes a caret). The color is always derived from
 * the id, never taken from the peer, so it can't be styled into something
 * else; long or odd fields are dropped or clipped.
 */
export function parsePeerState(raw: unknown): PeerState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const state = raw as Record<string, unknown>;
  const user = state.user as Record<string, unknown> | null | undefined;
  if (typeof user !== "object" || user === null || !isId(user.id)) return null;
  const name =
    typeof user.name === "string" && user.name.trim()
      ? user.name.trim().slice(0, MAX_NAME)
      : "Member";
  const selection = Array.isArray(state.selection)
    ? state.selection.filter(isId).slice(0, MAX_SELECTION)
    : [];
  return {
    user: { id: user.id, name, avatarUrl: parseAvatar(user.avatarUrl), ...presenceColor(user.id) },
    pointer: parsePointer(state.pointer),
    selection,
    editing: isId(state.editing) ? state.editing : null,
  };
}

/** "Mara", "Mara and Rin", "Mara, Rin and 2 others". */
export function namesHere(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}
