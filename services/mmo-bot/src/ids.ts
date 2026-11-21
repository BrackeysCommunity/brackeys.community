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
  "carry",
  "character",
  "choose",
  "classes",
  "cls-choose",
  "cls-mark",
  "cls-take",
  "consent",
  "craft",
  "craft-go",
  "craft-i",
  "craft-m",
  "craft-p",
  "craft-q",
  "craft-s",
  "crawl",
  "d-name",
  "d-named",
  "dg-leave",
  "dungeon",
  "equip",
  "explore",
  "feed",
  "field",
  "fight",
  "follow",
  "forage",
  "g-amount",
  "g-cap",
  "g-deliver",
  "g-drafts",
  "g-form",
  "g-haul",
  "g-least",
  "g-name",
  "g-narrow",
  "g-page",
  "g-party",
  "g-pledge",
  "g-post",
  "g-reward",
  "g-target",
  "g-verb",
  "g-wd",
  "gather",
  "gear-buy",
  "gld-act",
  "gld-appr",
  "gld-chart",
  "gld-dep",
  "gld-draw",
  "gld-found",
  "gld-give",
  "gld-invite",
  "gld-join",
  "gld-leave",
  "gld-member",
  "gld-mend",
  "gld-name",
  "gld-new",
  "gld-pay",
  "gld-raise",
  "gld-rwd",
  "gld-take",
  "gld-work",
  "goal",
  "goals",
  "goto",
  "guild",
  "help",
  "h-press",
  "hub",
  "hunt",
  "item",
  "launch",
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
  "p-card",
  "p-follow",
  "p-invite",
  "p-join",
  "p-leave",
  "p-machine",
  "p-pick",
  "p-unfollow",
  "party",
  "pick",
  "press",
  "push",
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

/** The cards that lead into the Activity (GDD 17.7). */
const LAUNCH_CARDS = [
  "beat",
  "hub",
  "where",
  "talk",
  "character",
  "party",
  "fork",
  "hunt",
] as const;
export type LaunchCard = (typeof LAUNCH_CARDS)[number];

/** A launch button's target: the card it sits on, and on a talk card the NPC spoken to. */
export interface Launch {
  from: LaunchCard;
  npc?: string;
}

export function launchTarget(from: LaunchCard, npc?: string): string {
  return npc ? target("/", from, npc) : from;
}

export function launchOf(raw: string): Launch | null {
  const [from, npc, ...rest] = raw.split("/");
  if (rest.length || !LAUNCH_CARDS.includes(from as LaunchCard)) return null;
  if ((from === "talk") !== !!npc) return null;
  return npc ? { from: from as LaunchCard, npc } : { from: from as LaunchCard };
}

export function integerTarget(raw: string): number | undefined {
  const n = Number(raw);
  return /^-?\d+$/.test(raw) && Number.isSafeInteger(n) ? n : undefined;
}
