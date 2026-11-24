import type { UseConfig, UseId } from "./types.ts";

const DAY = 86_400;
const BOT_INPUT = 60_000;
const OFFLINE_INPUT = 200_000;

/**
 * How each use calls the model: a small fast model for narration and voices,
 * a larger one for names, summaries and the digest, the largest for the
 * offline jobs. Every number the pipeline reads lives here.
 */
export const USE_CONFIG: Record<UseId, UseConfig> = {
  chronicle: {
    model: "claude-haiku-5-5",
    effort: "low",
    maxTokens: 2_000,
    timeoutMs: 30_000,
    waitMs: null,
    ttlSeconds: 30 * DAY,
    perDayCap: null,
    capBy: null,
    interactive: false,
    maxInputChars: BOT_INPUT,
    stubThinking: 75,
  },
  stage: {
    model: "claude-haiku-5-5",
    effort: "low",
    maxTokens: 1_000,
    timeoutMs: 30_000,
    waitMs: null,
    ttlSeconds: 30 * DAY,
    perDayCap: null,
    capBy: null,
    interactive: false,
    maxInputChars: BOT_INPUT,
    stubThinking: 70,
  },
  recap: {
    model: "claude-haiku-5-5",
    effort: "low",
    maxTokens: 1_500,
    timeoutMs: 20_000,
    waitMs: 4_000,
    ttlSeconds: 2 * DAY,
    perDayCap: 1,
    capBy: "player",
    interactive: true,
    maxInputChars: BOT_INPUT,
    stubThinking: 75,
  },
  names: {
    model: "claude-sonnet-5-5",
    effort: "medium",
    maxTokens: 1_500,
    timeoutMs: 30_000,
    waitMs: 4_000,
    ttlSeconds: null,
    perDayCap: null,
    capBy: null,
    interactive: true,
    maxInputChars: BOT_INPUT,
    stubThinking: 200,
  },
  screen: {
    model: "claude-haiku-5-5",
    effort: "low",
    maxTokens: 300,
    timeoutMs: 5_000,
    waitMs: 5_000,
    ttlSeconds: 30 * DAY,
    perDayCap: 20,
    capBy: "player",
    interactive: true,
    maxInputChars: BOT_INPUT,
    stubThinking: 15,
  },
  voice: {
    model: "claude-haiku-5-5",
    effort: "low",
    maxTokens: 1_500,
    timeoutMs: 20_000,
    waitMs: 4_000,
    ttlSeconds: 2 * DAY,
    perDayCap: 5,
    capBy: "player",
    interactive: true,
    maxInputChars: BOT_INPUT,
    stubThinking: 100,
  },
  summary: {
    model: "claude-sonnet-5-5",
    effort: "medium",
    maxTokens: 1_000,
    timeoutMs: 30_000,
    waitMs: null,
    ttlSeconds: 30 * DAY,
    perDayCap: 1,
    capBy: "npc",
    interactive: false,
    maxInputChars: BOT_INPUT,
    stubThinking: 150,
  },
  pool: {
    model: "claude-opus-5-5",
    effort: "high",
    maxTokens: 16_000,
    timeoutMs: 600_000,
    waitMs: null,
    ttlSeconds: 30 * DAY,
    perDayCap: null,
    capBy: null,
    interactive: false,
    maxInputChars: OFFLINE_INPUT,
    stubThinking: 9_000,
  },
  proposals: {
    model: "claude-opus-5-5",
    effort: "high",
    maxTokens: 32_000,
    timeoutMs: 900_000,
    waitMs: null,
    ttlSeconds: 30 * DAY,
    perDayCap: null,
    capBy: null,
    interactive: false,
    maxInputChars: OFFLINE_INPUT,
    stubThinking: 7_000,
  },
  digest: {
    model: "claude-sonnet-5-5",
    effort: "medium",
    maxTokens: 4_000,
    timeoutMs: 120_000,
    waitMs: null,
    ttlSeconds: 30 * DAY,
    perDayCap: null,
    capBy: null,
    interactive: false,
    maxInputChars: OFFLINE_INPUT,
    stubThinking: 1_000,
  },
};

/** The recap is narrated only on return after this many hours away (GDD 15.2). */
export const RECAP_AWAY_HOURS = 6;
/** Interactive uses stop here, so the chronicle always has room in the day's budget. */
export const INTERACTIVE_SHARE_PERCENT = 70;
/** A failed check is remembered this long, so a bad input is not paid for again. */
export const FAIL_TTL_SECONDS = DAY;
/** Per-player and per-NPC call counts outlive their world day by a margin. */
export const CAP_TTL_SECONDS = 3 * DAY;
/** The day ledger is kept for a year and a little. */
export const LEDGER_TTL_SECONDS = 400 * DAY;
