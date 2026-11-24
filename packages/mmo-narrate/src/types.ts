/** Every narrated use; the table under USE_CONFIG says how each one calls. */
export const USES = [
  "chronicle",
  "stage",
  "recap",
  "names",
  "screen",
  "voice",
  "summary",
  "pool",
  "proposals",
  "digest",
] as const;
export type UseId = (typeof USES)[number];
export type ModelId = "claude-haiku-5-5" | "claude-sonnet-5-5" | "claude-opus-5-5";
export type Effort = "low" | "medium" | "high";
export type JsonSchema = Record<string, unknown>;

export interface UseConfig {
  model: ModelId;
  effort: Effort;
  maxTokens: number;
  /** The SDK's per-request timeout. */
  timeoutMs: number;
  /** How long a press waits before showing the template; null waits for the call. */
  waitMs: number | null;
  /** null: kept forever. */
  ttlSeconds: number | null;
  /** Model calls per `capBy` per world day. */
  perDayCap: number | null;
  capBy: "player" | "npc" | null;
  /** Stops at the interactive share of the day's budget. */
  interactive: boolean;
  /** Larger prompts fall back as too-large. */
  maxInputChars: number;
  /** Output tokens the stub adds for thinking. */
  stubThinking: number;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelCall {
  use: UseId;
  model: ModelId;
  effort: Effort;
  maxTokens: number;
  timeoutMs: number;
  system: string;
  user: string;
  schema: JsonSchema;
  /** A reply the use's check accepts, built from the input with no model; only the stub reads it. */
  stub: unknown;
}

export interface ModelReply {
  text: string;
  stop: "end" | "refusal" | "max_tokens" | "other";
  usage: Usage;
}

export interface NarrationModel {
  complete(call: ModelCall, signal: AbortSignal): Promise<ModelReply>;
}

export class ModelTimeoutError extends Error {
  constructor(message = "The model call timed out") {
    super(message);
    this.name = "ModelTimeoutError";
  }
}

export const CHECK_REASONS = [
  "schema",
  "empty",
  "too-long",
  "number",
  "name",
  "mention",
  "markup",
  "uncited",
  "unknown-fact",
  "missing-fact",
  "bad-id",
  "bad-count",
  "word",
] as const;
export type CheckReason = (typeof CHECK_REASONS)[number];

export type CheckResult<O> =
  | { ok: true; value: O }
  | { ok: false; reason: CheckReason; detail: string };

export interface UseSpec<I, O> {
  use: UseId;
  /** Bump on any prompt, schema or style-guide change. */
  version: number;
  /** The canonical prompt input; the cache digest is taken over it. */
  input(i: I): unknown;
  prompt(i: I): { system: string; user: string };
  schema: JsonSchema;
  check(i: I, reply: unknown): CheckResult<O>;
  stub(i: I): unknown;
}

export type FallbackReason =
  | "off"
  | "uncached"
  | "no-model"
  | "budget"
  | "cap"
  | "timeout"
  | "error"
  | "refused"
  | "truncated"
  | "check"
  | "failed-before"
  | "too-large"
  | "store";

export type Narrated<O> =
  | { ok: true; value: O; from: "cache" | "model" }
  | { ok: false; reason: FallbackReason; check?: CheckReason };

export interface NarrateCtx {
  /** The world day the text is about; costs and caps are counted under it. */
  day: number;
  /** Guild id; the per-server switch. */
  server?: string;
  /** Discord user id; per-player caps. */
  player?: string;
  npc?: string;
  /** cached: never calls the model. */
  mode?: "call" | "cached";
}

export interface NarrationStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number | null): Promise<void>;
  incr(key: string, ttlSeconds: number): Promise<number>;
  hincr(key: string, fields: Record<string, number>, ttlSeconds: number): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  push(key: string, value: string, keep: number): Promise<void>;
  /** Sets key once: true when this call set it, false when it was already held. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
}

export interface Switch {
  on(use: UseId, server?: string): Promise<boolean>;
}

export interface UseLedger {
  calls: number;
  hits: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  usdMicros: number;
  fallbacks: Partial<Record<FallbackReason, number>>;
}

export interface DayLedger {
  day: number;
  usdMicros: number;
  uses: Partial<Record<UseId, UseLedger>>;
}
