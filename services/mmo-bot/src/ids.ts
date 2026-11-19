/**
 * A component's custom_id: the action, its target and the character's
 * state version when the card was drawn (GDD 17.5). A press against a
 * version that has moved on re-renders the card instead of acting.
 */

const PREFIX = "mm";
const SEP = "|";
const MAX = 100;

export interface Id {
  action: string;
  target: string;
  version: number;
}

export function encodeId(action: string, target = "", version = 0): string {
  const id = [PREFIX, action, target, String(version)].join(SEP);
  if (id.length > MAX || action.includes(SEP) || target.includes(SEP)) {
    throw new Error(`custom_id too long or malformed: ${id}`);
  }
  return id;
}

export function decodeId(raw: string): Id | null {
  const parts = raw.split(SEP);
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  const version = Number(parts[3]);
  if (!Number.isInteger(version)) return null;
  return { action: parts[1]!, target: parts[2]!, version };
}
