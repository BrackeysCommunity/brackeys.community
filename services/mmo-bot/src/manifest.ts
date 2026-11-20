/**
 * The guild commands (GDD 17.1): the solo loop's four, the market, goals
 * and the guild. The Activity's
 * launch entry point is the application's own global command; registering
 * guild commands leaves it in place, and the adapter answers it with the
 * launch-activity response.
 */
export const MANIFEST = [
  { type: 1, name: "play", description: "Open your hub in Wirelands" },
  { type: 1, name: "character", description: "Your kit, practice, standing and record" },
  { type: 1, name: "recipes", description: "The kinds you know how to make" },
  { type: 1, name: "map", description: "The map round you, with the six ways out" },
  {
    type: 1,
    name: "market",
    description: "The market here: the book, prices, gear and your orders",
  },
  { type: 1, name: "goals", description: "The notice board here: goals to meet, and posting one" },
  { type: 1, name: "guild", description: "Your guild: members, treasury, settlements and works" },
] as const;

export type CommandName = (typeof MANIFEST)[number]["name"];
