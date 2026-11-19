/**
 * A component's custom_id: the action, its target and the character's
 * state version when the card was drawn (GDD 17.5). A press against a
 * version that has moved on re-renders the card instead of acting.
 */

const PREFIX = "mm";
const SEP = "|";
const MAX = 100;

const ACTIONS = [
  "buy",
  "cancel",
  "character",
  "choose",
  "consent",
  "craft",
  "craft-go",
  "craft-i",
  "craft-m",
  "craft-p",
  "craft-q",
  "craft-s",
  "crawl",
  "equip",
  "explore",
  "feed",
  "field",
  "fight",
  "follow",
  "forage",
  "gather",
  "gear-buy",
  "goals",
  "goto",
  "hub",
  "item",
  "list",
  "market",
  "mkt-l",
  "mkt-m",
  "mkt-o",
  "mkt-op",
  "mkt-os",
  "mkt-ou",
  "mkt-post",
  "mkt-sell",
  "mkt-take",
  "pick",
  "press",
  "recap",
  "recipes",
  "repair",
  "rest",
  "search",
  "sell",
  "sell-item",
  "start",
  "step",
  "talk",
  "travel",
  "where",
  "why",
  "withdraw",
] as const;
const actionSet = new Set<string>(ACTIONS);
export type Action = (typeof ACTIONS)[number];

export interface Id {
  action: Action;
  target: string;
  version: number;
}

export function encodeId(action: Action, target = "", version = 0): string {
  const id = [PREFIX, action, target, String(version)].join(SEP);
  if (id.length > MAX || action.includes(SEP) || target.includes(SEP)) {
    throw new Error(`custom_id too long or malformed: ${id}`);
  }
  return id;
}

export function decodeId(raw: string): Id | null {
  const parts = raw.split(SEP);
  if (parts.length !== 4 || parts[0] !== PREFIX || !actionSet.has(parts[1]!)) return null;
  const version = Number(parts[3]);
  if (!/^\d+$/.test(parts[3]!) || !Number.isSafeInteger(version) || raw.length > MAX) return null;
  return { action: parts[1] as Action, target: parts[2]!, version };
}

type Separator = ":" | "/" | "," | ".";

export function target(separator: Separator, ...parts: (string | number)[]): string {
  if (parts.some((part) => String(part).includes(separator))) {
    throw new Error(`a target field contains "${separator}"`);
  }
  return parts.join(separator);
}

export function fields(raw: string, separator: Separator, count: number): string[] | null {
  const parts = raw.split(separator);
  return parts.length === count && parts.every(Boolean) ? parts : null;
}

export function integerTarget(raw: string): number | undefined {
  const n = Number(raw);
  return /^-?\d+$/.test(raw) && Number.isSafeInteger(n) ? n : undefined;
}
