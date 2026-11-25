/** Discord's permission bits as default_member_permissions takes them: who sees a command until a server says otherwise. */
export const ADMINISTRATOR = String(1n << 3n);
export const MODERATE_MEMBERS = String(1n << 40n);

/** Discord's command types: a slash command, and one on a message's context menu. */
const SLASH = 1;
const MESSAGE = 3;

/** The message command that reports a card (GDD 14.6). */
export const REPORT = "Report";

/**
 * The guild commands (GDD 17.1): the solo loop's four, the market, goals,
 * the guild, the party and the chronicle; the consoles of a server's staff
 * and admins (GDD 14.1); and Report on any message. The Activity's launch
 * entry point is the application's own global command; registering guild
 * commands leaves it in place, and the adapter answers it with the
 * launch-activity response.
 */
export const MANIFEST = [
  { type: SLASH, name: "play", description: "Open your hub in Wirelands" },
  { type: SLASH, name: "character", description: "Your kit, practice, standing and record" },
  { type: SLASH, name: "recipes", description: "The kinds you know how to make" },
  { type: SLASH, name: "map", description: "The map round you, with the six ways out" },
  {
    type: SLASH,
    name: "market",
    description: "The market here: the book, prices, gear and your orders",
  },
  {
    type: SLASH,
    name: "goals",
    description: "The notice board here: goals to meet, and posting one",
  },
  {
    type: SLASH,
    name: "guild",
    description: "Your guild: members, treasury, settlements and works",
  },
  {
    type: SLASH,
    name: "party",
    description: "Your party: who is in it, who is in reach, and its thread",
  },
  {
    type: SLASH,
    name: "chronicle",
    description: "The chronicle: what the world did yesterday, the arcs running, and why",
  },
  {
    type: SLASH,
    name: "staff",
    description: "The staff console: staff pools, staging, the moderation queue and the log",
    default_member_permissions: MODERATE_MEMBERS,
  },
  {
    type: SLASH,
    name: "admin",
    description: "The admin console: staging, musters, server settings, pins and the log",
    default_member_permissions: ADMINISTRATOR,
  },
  { type: MESSAGE, name: REPORT, description: "" },
] as const;

export type CommandName = (typeof MANIFEST)[number]["name"];
