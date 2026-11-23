import { cacheKey, capKey, costKey, failKey } from "./digest.ts";
import { costMicros, upperMicros } from "./prices.ts";
import {
  ModelTimeoutError,
  USES,
  type CheckReason,
  type DayLedger,
  type FallbackReason,
  type ModelCall,
  type ModelReply,
  type NarrateCtx,
  type Narrated,
  type NarrationModel,
  type NarrationStore,
  type Switch,
  type UseConfig,
  type UseId,
  type UseLedger,
  type UseSpec,
} from "./types.ts";
import {
  CAP_TTL_SECONDS,
  FAIL_TTL_SECONDS,
  INTERACTIVE_SHARE_PERCENT,
  LEDGER_TTL_SECONDS,
  USE_CONFIG,
} from "./uses.ts";

export interface NarratorDeps {
  model: NarrationModel | null;
  store: NarrationStore;
  switch: Switch;
  /** MMO_NARRATION_DAY_USD */
  dayUsd: number;
  /** One line per call or fallback; never text or keys. */
  log: (line: string) => void;
  /** Per-use changes to USE_CONFIG, for tests and the cost script. */
  config?: Partial<Record<UseId, Partial<UseConfig>>>;
}

type Outcome =
  | { ok: true; value: unknown }
  | { ok: false; reason: FallbackReason; check?: CheckReason };

const CHECK_REASONS: ReadonlySet<string> = new Set<CheckReason>([
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
]);

/** Fallbacks a repeat of the same input would most likely hit again, so they are remembered. */
const REMEMBERED: ReadonlySet<FallbackReason> = new Set(["check", "refused", "truncated"]);

const LATE = Symbol("late");

const LEDGER_FIELDS: Partial<Record<string, keyof Omit<UseLedger, "fallbacks">>> = {
  calls: "calls",
  hits: "hits",
  in: "input",
  out: "output",
  cr: "cacheRead",
  cw: "cacheWrite",
  usd: "usdMicros",
};

const emptyUse = (): UseLedger => ({
  calls: 0,
  hits: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  usdMicros: 0,
  fallbacks: {},
});

/**
 * The one pipeline every narrated use runs through: switch, cache, caps and
 * budget, one coalesced model call, the use's check, then the cache and the
 * ledger. Anything but checked text is a fallback, and the caller shows the
 * template it built first.
 */
export class Narrator {
  private readonly inFlight = new Map<string, Promise<Outcome>>();
  /** Upper estimates of calls still running, by world day, so concurrent calls share the budget. */
  private readonly reserved = new Map<number, number>();

  constructor(private readonly deps: NarratorDeps) {}

  /** The use's config, with any override. */
  config(use: UseId): UseConfig {
    return { ...USE_CONFIG[use], ...this.deps.config?.[use] };
  }

  async narrate<I, O>(spec: UseSpec<I, O>, input: I, ctx: NarrateCtx): Promise<Narrated<O>> {
    const { use } = spec;
    const { day } = ctx;
    const cfg = this.config(use);
    const store = this.deps.store;

    if (!(await this.switchOn(use, ctx.server))) return this.fallback(use, day, "off");

    let key: string;
    try {
      key = cacheKey(spec, input, cfg.model);
    } catch {
      return this.fallback(use, day, "error");
    }

    let hit: string | null;
    let failed: string | null;
    try {
      hit = await store.get(key);
      failed = hit === null ? await store.get(failKey(key)) : null;
    } catch {
      return this.fallback(use, day, "store");
    }
    if (hit !== null) {
      const res = this.accept(spec, input, hit);
      if (!res.ok) return this.fallback(use, day, res.reason, res.check);
      await this.count(day, { [`${use}.hits`]: 1 });
      return { ok: true, value: res.value as O, from: "cache" };
    }
    if (failed !== null) {
      const check = CHECK_REASONS.has(failed) ? (failed as CheckReason) : undefined;
      return this.fallback(use, day, "failed-before", check);
    }
    if (ctx.mode === "cached") return this.fallback(use, day, "off");
    const model = this.deps.model;
    if (!model) return this.fallback(use, day, "no-model");

    let prompt: { system: string; user: string };
    let stub: unknown;
    try {
      prompt = spec.prompt(input);
      stub = spec.stub(input);
    } catch {
      return this.fallback(use, day, "error");
    }
    const chars = prompt.system.length + prompt.user.length;
    if (chars > cfg.maxInputChars) return this.fallback(use, day, "too-large");

    let cap: string | null = null;
    const upper = upperMicros(cfg.model, chars, cfg.maxTokens);
    try {
      if (cfg.perDayCap !== null) {
        const who = cfg.capBy === "npc" ? ctx.npc : cfg.capBy === "player" ? ctx.player : undefined;
        if (!who) return this.fallback(use, day, "cap");
        cap = capKey(use, who, day);
        if (Number((await store.get(cap)) ?? 0) >= cfg.perDayCap) {
          return this.fallback(use, day, "cap");
        }
      }
      if (!this.inFlight.has(key)) {
        const spent = Number((await store.hgetall(costKey(day))).usd ?? 0);
        const dayMicros = Math.max(0, Math.round(this.deps.dayUsd * 1_000_000));
        const limit = cfg.interactive
          ? Math.floor((dayMicros * INTERACTIVE_SHARE_PERCENT) / 100)
          : dayMicros;
        if (spent + (this.reserved.get(day) ?? 0) + upper > limit) {
          return this.fallback(use, day, "budget");
        }
      }
    } catch {
      return this.fallback(use, day, "store");
    }

    let task = this.inFlight.get(key);
    const joining = task !== undefined;
    if (!task) {
      const call: ModelCall = {
        use,
        model: cfg.model,
        effort: cfg.effort,
        maxTokens: cfg.maxTokens,
        timeoutMs: cfg.timeoutMs,
        stream: cfg.stream,
        system: prompt.system,
        user: prompt.user,
        schema: spec.schema,
        stub,
      };
      this.reserve(day, upper);
      task = this.run(spec, input, ctx, cfg, model, call, key, cap).finally(() => {
        this.inFlight.delete(key);
        this.reserve(day, -upper);
      });
      this.inFlight.set(key, task);
    }

    const outcome = cfg.waitMs === null ? await task : await raceLate(task, cfg.waitMs);
    if (outcome === LATE) return this.fallback(use, day, "timeout");
    if (!outcome.ok) return this.fallback(use, day, outcome.reason, outcome.check, true);
    if (joining) {
      await this.count(day, { [`${use}.hits`]: 1 });
      return { ok: true, value: outcome.value as O, from: "cache" };
    }
    return { ok: true, value: outcome.value as O, from: "model" };
  }

  /** The day's spend and counts, as the ledger hash holds them. */
  async ledger(day: number): Promise<DayLedger> {
    const h = await this.deps.store.hgetall(costKey(day));
    const out: DayLedger = { day, usdMicros: Number(h.usd ?? 0), uses: {} };
    const uses: ReadonlySet<string> = new Set(USES);
    for (const [field, raw] of Object.entries(h)) {
      const dot = field.indexOf(".");
      if (dot < 0) continue;
      const use = field.slice(0, dot);
      if (!uses.has(use)) continue;
      const rest = field.slice(dot + 1);
      const u = (out.uses[use as UseId] ??= emptyUse());
      const n = Number(raw);
      if (rest.startsWith("fb.")) u.fallbacks[rest.slice(3) as FallbackReason] = n;
      else {
        const f = LEDGER_FIELDS[rest];
        if (f) u[f] = n;
      }
    }
    return out;
  }

  /** Resolves once every call in flight has finished and cached its result. */
  async drain(): Promise<void> {
    while (this.inFlight.size) await Promise.all([...this.inFlight.values()]);
  }

  private async run<I, O>(
    spec: UseSpec<I, O>,
    input: I,
    ctx: NarrateCtx,
    cfg: UseConfig,
    model: NarrationModel,
    call: ModelCall,
    key: string,
    cap: string | null,
  ): Promise<Outcome> {
    const { use } = spec;
    const { day } = ctx;
    const store = this.deps.store;

    let reply: ModelReply;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const answer = (async () => model.complete(call, ctrl.signal))();
      answer.catch(() => {});
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ctrl.abort();
          reject(new ModelTimeoutError());
        }, cfg.timeoutMs);
      });
      reply = await Promise.race([answer, timedOut]);
    } catch (e) {
      const reason = e instanceof ModelTimeoutError || ctrl.signal.aborted ? "timeout" : "error";
      this.deps.log(`mmo-narr use=${use} day=${day} model=${cfg.model} outcome=${reason}`);
      return { ok: false, reason };
    } finally {
      clearTimeout(timer);
    }

    try {
      const micros = costMicros(cfg.model, reply.usage);
      await store.hincr(
        costKey(day),
        {
          usd: micros,
          [`${use}.calls`]: 1,
          [`${use}.in`]: reply.usage.input,
          [`${use}.out`]: reply.usage.output,
          [`${use}.cr`]: reply.usage.cacheRead,
          [`${use}.cw`]: reply.usage.cacheWrite,
          [`${use}.usd`]: micros,
        },
        LEDGER_TTL_SECONDS,
      );
      if (cap) await store.incr(cap, CAP_TTL_SECONDS);
      const outcome = this.judge(spec, input, reply);
      if (outcome.ok) await store.set(key, reply.text, cfg.ttlSeconds);
      else if (REMEMBERED.has(outcome.reason)) {
        await store.set(failKey(key), outcome.check ?? outcome.reason, FAIL_TTL_SECONDS);
      }
      const u = reply.usage;
      const said = outcome.ok
        ? "model"
        : `${outcome.reason}${outcome.check ? `/${outcome.check}` : ""}`;
      this.deps.log(
        `mmo-narr use=${use} day=${day} model=${cfg.model} outcome=${said} in=${u.input} out=${u.output} cr=${u.cacheRead} cw=${u.cacheWrite} usdMicros=${micros}`,
      );
      return outcome;
    } catch {
      this.deps.log(`mmo-narr use=${use} day=${day} model=${cfg.model} outcome=store`);
      return { ok: false, reason: "store" };
    }
  }

  private judge<I, O>(spec: UseSpec<I, O>, input: I, reply: ModelReply): Outcome {
    if (reply.stop === "refusal") return { ok: false, reason: "refused" };
    if (reply.stop === "max_tokens") return { ok: false, reason: "truncated" };
    if (reply.stop !== "end") return { ok: false, reason: "error" };
    return this.accept(spec, input, reply.text);
  }

  private accept<I, O>(spec: UseSpec<I, O>, input: I, text: string): Outcome {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: "check", check: "schema" };
    }
    try {
      const res = spec.check(input, parsed);
      return res.ok
        ? { ok: true, value: res.value }
        : { ok: false, reason: "check", check: res.reason };
    } catch {
      return { ok: false, reason: "error" };
    }
  }

  private async switchOn(use: UseId, server?: string): Promise<boolean> {
    try {
      return await this.deps.switch.on(use, server);
    } catch {
      return false;
    }
  }

  private reserve(day: number, micros: number) {
    const left = (this.reserved.get(day) ?? 0) + micros;
    if (left > 0) this.reserved.set(day, left);
    else this.reserved.delete(day);
  }

  /** Ledger counts are best effort: a store that fails here already failed the narration. */
  private async count(day: number, fields: Record<string, number>) {
    try {
      await this.deps.store.hincr(costKey(day), fields, LEDGER_TTL_SECONDS);
    } catch {
      // The ledger misses a count; the reply shown is unaffected.
    }
  }

  private async fallback<O>(
    use: UseId,
    day: number,
    reason: FallbackReason,
    check?: CheckReason,
    logged = false,
  ): Promise<Narrated<O>> {
    await this.count(day, { [`${use}.fb.${reason}`]: 1 });
    if (reason !== "off" && !logged) {
      this.deps.log(
        `mmo-narr use=${use} day=${day} fallback=${reason}${check ? ` check=${check}` : ""}`,
      );
    }
    return check ? { ok: false, reason, check } : { ok: false, reason };
  }
}

/** The task, or LATE once `ms` pass; the task runs on either way. */
function raceLate<T>(task: Promise<T>, ms: number): Promise<T | typeof LATE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof LATE>((resolve) => {
    timer = setTimeout(() => resolve(LATE), ms);
  });
  return Promise.race([task, late]).finally(() => clearTimeout(timer));
}

/** A switch fixed on or off, for tests and the stubbed sitting. */
export function fixedSwitch(on: boolean): Switch {
  return { on: async () => on };
}
