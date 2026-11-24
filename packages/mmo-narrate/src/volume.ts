import type { UseId } from "./types.ts";

/**
 * How many model calls each use makes a world day, as a stated assumption
 * until a real world runs: then `scripts/narration-ledger.ts` reads the
 * true counts from the ledger and they replace this table. A call here is
 * a model call; cache hits cost nothing and are not counted.
 */

/** A world's size: servers with the bot, and characters active a world day. */
export interface Scale {
  servers: number;
  players: number;
}

/** The two sizes the cost figure is given at. */
export const SCALES = {
  small: { servers: 1, players: 50 },
  large: { servers: 100, players: 5_000 },
} as const satisfies Record<string, Scale>;

export type ScaleId = keyof typeof SCALES;

export interface Volume {
  /** Calls a world day: fixed + perServer × servers + perPlayer × players. */
  fixed: number;
  perServer: number;
  perPlayer: number;
  /** The rule in words, S servers and P players. */
  formula: string;
  /** Where the rate comes from. */
  source: string;
}

const DAYS_A_WEEK = 7;
/** Season zero's length in world days, which proposals run once after. */
const SEASON_DAYS = 14;

export const VOLUME: Record<UseId, Volume> = {
  chronicle: {
    fixed: 0,
    perServer: 1,
    perPlayer: 0,
    formula: "S",
    source:
      "One post per closed world day per server (GDD 12.7). Servers whose ordered lines match share one call, so this is the worst case.",
  },
  stage: {
    fixed: 0.5,
    perServer: 0,
    perPlayer: 0,
    formula: "0.5",
    source:
      "Season zero decided 1 to 4 stages and lapsed 1 to 3 in a 14-day season (MM9 handover), plus the close and the finale. Each is told once and shared across servers.",
  },
  recap: {
    fixed: 0,
    perServer: 0,
    perPlayer: 0.5,
    formula: "0.5 P",
    source:
      "Since you left is told only on a return after 6 hours or more (RECAP_AWAY_HOURS) and at most once a player a world day (USE_CONFIG cap): about half the active players a day.",
  },
  voice: {
    fixed: 0,
    perServer: 0,
    perPlayer: 1.5,
    formula: "1.5 P",
    source:
      "Talks to notables and saved NPCs, cached per NPC, player and world day and capped at 5 a player a day (USE_CONFIG): about one and a half new conversations a player a day.",
  },
  names: {
    fixed: 2,
    perServer: 0,
    perPlayer: 0.01,
    formula: "0.01 P + 2",
    source:
      "Kinds a first maker discovers, about one player in a hundred a day, plus MM10's renamable promotions at emergence's need of about two a world day. Each is cached forever.",
  },
  screen: {
    fixed: 0,
    perServer: 0,
    perPlayer: 0.003,
    formula: "0.003 P",
    source:
      "Typed names (kinds, promotions, dungeons, guilds, settlements), cached by the normalised name: a few in a thousand players type one a day.",
  },
  summary: {
    fixed: 0,
    perServer: 0,
    perPlayer: 0.01,
    formula: "0.01 P",
    source:
      "An NPC whose memory passed its cap is summarised at most once a world day (GDD 15.2): about one NPC for every hundred active players.",
  },
  pool: {
    fixed: 0,
    perServer: 0,
    perPlayer: 0,
    formula: "0 (once a pack)",
    source:
      "The encounter pool is committed and regenerated offline by hand (scripts/encounter-pool.ts), not a daily cost.",
  },
  proposals: {
    fixed: 1 / SEASON_DAYS,
    perServer: 0,
    perPlayer: 0,
    formula: "1/14",
    source: "One offline run between seasons (scripts/arc-proposals.ts), a 14-day season.",
  },
  digest: {
    fixed: 1 / DAYS_A_WEEK,
    perServer: 0,
    perPlayer: 0,
    formula: "1/7",
    source: "The weekly balance digest (scripts/balance-digest.ts).",
  },
};

/** Calls a world day for a use at a scale. */
export function callsPerDay(use: UseId, scale: Scale): number {
  const v = VOLUME[use];
  return v.fixed + v.perServer * scale.servers + v.perPlayer * scale.players;
}
