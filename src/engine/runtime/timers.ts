import type { SavedTimer } from "../game/save-file";
import { ticksFor } from "../game/time";
import type {
  CoroutineYield,
  Delay,
  EngineContext,
  JsonValue,
  TimerAction,
  Timers,
} from "../game/types";

/** A pending timer a world save can't hold: a function-form timer or a coroutine. */
export type UnsaveableTimer = { kind: "timer" | "coroutine"; id: number; owner?: string };

/** The emit-form timers a world save holds, and the id the next timer gets. */
export type TimersCapture = { timers: SavedTimer[]; next: number };

/** A runtime's timers: `EngineContext.timers` plus what the tick, the load and the lifecycle call. */
export type RuntimeTimers = Timers & {
  /** The tick's timer phase: runs what falls due, by due tick then creation. */
  run(): void;
  /** Advances the timer clock by `ticks` before tick 0, running what falls due in order. */
  seek(ticks: number): void;
  /** Cancels every timer and coroutine `id` owns. */
  cancelOwner(id: string): void;
  /** Pauses or resumes what `id` owns, keeping the ticks remaining. */
  pauseOwner(id: string, paused: boolean): void;
  /** Cancels everything and sets the clock back to 0; at unload. */
  reset(): void;
  /** The pending function-form timers and coroutines, by id. */
  unsaveable(): UnsaveableTimer[];
  /**
   * The emit-form timers between ticks, each `due` on the tick it fires
   * (a paused one as if its owner were enabled now, at `tick`).
   */
  capture(tick: number): TimersCapture;
  /**
   * Replaces every timer with `saved`, on a clock whose next phase is
   * `tick`; one whose owner is disabled waits paused. Ids carry on from `next`.
   */
  restore(saved: readonly SavedTimer[], tick: number, next: number): void;
};

type Base = {
  id: number;
  owner: string | undefined;
  /** The timer phase it next runs in; for a coroutine waiting on a predicate, the first phase it checks. */
  due: number;
  /** While its owner is disabled: the ticks left after the next phase, restored on resume. */
  paused: number | null;
};

type TimerEntry = Base & {
  kind: "timer";
  action: TimerAction;
  /** Ticks between runs for `every`; null for `after`. */
  period: number | null;
  /** Runs left for `every` with `times`. */
  left: number | null;
};

type CoroutineEntry = Base & {
  kind: "coroutine";
  make: () => Generator<CoroutineYield, void, void>;
  gen: Generator<CoroutineYield, void, void> | null;
  until: (() => boolean) | null;
};

type Entry = TimerEntry | CoroutineEntry;

function checkTicks(ticks: number, what: string): number {
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new RangeError(`${what} must be a whole number of ticks (0 or more), got ${ticks}`);
  }
  return ticks;
}

/**
 * The runtime's timers and coroutines, on a clock of timer phases: one per
 * simulated tick (step 6 of the tick), plus the phases a seek runs before
 * tick 0. Nothing advances while a turns or event game idles.
 */
export function createTimers(ctx: EngineContext): RuntimeTimers {
  const entries = new Map<number, Entry>();
  let nextId = 1;
  /** Phases sought before tick 0, so phase = `ctx.tick + offset` once stepping. */
  let offset = 0;
  /** The phase a seek is running, or null. */
  let seekPhase: number | null = null;
  /** The last phase run (or running); -1 before the first. */
  let lastPhase = -1;

  const now = () => seekPhase ?? ctx.tick + offset;
  /** The first phase something created now can run in: this tick's unless it has begun. */
  const nextPhase = () => {
    const base = now();
    return lastPhase >= base ? base + 1 : base;
  };
  const dueIn = (ticks: number) => Math.max(now() + ticks, nextPhase());

  function ticksOf(delay: Delay, what: string): number {
    if (typeof delay === "number") return checkTicks(delay, what);
    if (!Number.isFinite(delay.ms) || delay.ms < 0) {
      throw new RangeError(`${what} must be 0 ms or more, got ${delay.ms}`);
    }
    return ticksFor(delay.ms, ctx.time);
  }

  function add<E extends Entry>(entry: Omit<E, "id" | "paused">): number {
    const id = nextId++;
    const owner = entry.owner;
    const paused = owner !== undefined && ctx.exists(owner) && !ctx.enabled(owner);
    const full = { ...entry, id, paused: null } as unknown as E;
    if (paused) full.paused = Math.max(0, full.due - nextPhase());
    entries.set(id, full);
    return id;
  }

  function fire(action: TimerAction): void {
    if (typeof action === "function") {
      action();
      return;
    }
    const pose = action.entityId === undefined ? undefined : ctx.poses.get(action.entityId);
    ctx.emit({
      type: action.emit,
      at: pose ? { x: pose.x, y: pose.y } : { x: 0, y: 0 },
      ...(action.entityId === undefined ? {} : { entityId: action.entityId }),
      ...(action.data === undefined ? {} : { data: action.data }),
    });
  }

  function runTimer(e: TimerEntry, phase: number): void {
    if (e.period === null || e.left === 1) entries.delete(e.id);
    else {
      e.due = phase + Math.max(1, e.period);
      if (e.left !== null) e.left--;
    }
    fire(e.action);
  }

  /** Resumes `e` until its next wait, or drops it when it returns or throws. */
  function runCoroutine(e: CoroutineEntry, phase: number): void {
    if (e.until) {
      if (!e.until()) return;
      e.until = null;
    }
    let step: IteratorResult<CoroutineYield, void>;
    try {
      e.gen ??= e.make();
      step = e.gen.next();
    } catch (err) {
      entries.delete(e.id);
      throw err;
    }
    if (!entries.has(e.id)) return;
    if (step.done) {
      entries.delete(e.id);
      return;
    }
    const value = step.value;
    if (typeof value === "function") {
      e.until = value;
      e.due = phase + 1;
      return;
    }
    let ticks: number;
    try {
      ticks = ticksOf(value, "a coroutine's yielded delay");
    } catch (err) {
      entries.delete(e.id);
      throw err;
    }
    e.due = phase + Math.max(1, ticks);
  }

  function runPhase(phase: number): void {
    lastPhase = phase;
    if (entries.size === 0) return;
    const ready: Entry[] = [];
    for (const e of entries.values()) if (e.paused === null && e.due <= phase) ready.push(e);
    ready.sort((a, b) => a.due - b.due || a.id - b.id);
    for (const e of ready) {
      // An earlier action may have cancelled or paused it.
      if (entries.get(e.id) !== e || e.paused !== null) continue;
      if (e.kind === "timer") runTimer(e, phase);
      else runCoroutine(e, phase);
    }
  }

  return {
    after(delay, action, opts) {
      return add<TimerEntry>({
        kind: "timer",
        owner: opts?.owner,
        due: dueIn(ticksOf(delay, "an after delay")),
        action,
        period: null,
        left: null,
      });
    },
    every(period, action, opts) {
      const ticks = ticksOf(period, "an every period");
      const times = opts?.times;
      if (times !== undefined && (!Number.isInteger(times) || times < 1)) {
        throw new RangeError(`every's times must be a whole number of 1 or more, got ${times}`);
      }
      return add<TimerEntry>({
        kind: "timer",
        owner: opts?.owner,
        due: dueIn(ticks),
        action,
        period: ticks,
        left: times ?? null,
      });
    },
    start(co, opts) {
      return add<CoroutineEntry>({
        kind: "coroutine",
        owner: opts?.owner,
        due: nextPhase(),
        make: co,
        gen: null,
        until: null,
      });
    },
    cancel(id) {
      entries.delete(id);
    },
    get size() {
      return entries.size;
    },
    run() {
      runPhase(ctx.tick + offset);
    },
    seek(ticks) {
      checkTicks(ticks, "a seek");
      const start = now();
      try {
        for (let i = 0; i < ticks; i++) {
          seekPhase = start + i;
          runPhase(seekPhase);
        }
      } finally {
        seekPhase = null;
        offset += ticks;
      }
    },
    cancelOwner(id) {
      for (const [key, e] of entries) if (e.owner === id) entries.delete(key);
    },
    pauseOwner(id, paused) {
      const next = nextPhase();
      for (const e of entries.values()) {
        if (e.owner !== id) continue;
        if (paused && e.paused === null) e.paused = Math.max(0, e.due - next);
        else if (!paused && e.paused !== null) {
          e.due = next + e.paused;
          e.paused = null;
        }
      }
    },
    reset() {
      entries.clear();
      nextId = 1;
      offset = 0;
      seekPhase = null;
      lastPhase = -1;
    },
    unsaveable() {
      const out: UnsaveableTimer[] = [];
      for (const e of entries.values()) {
        if (e.kind === "timer" && typeof e.action !== "function") continue;
        out.push({ kind: e.kind, id: e.id, ...(e.owner !== undefined ? { owner: e.owner } : {}) });
      }
      return out;
    },
    capture(tick) {
      const timers: SavedTimer[] = [];
      for (const e of entries.values()) {
        if (e.kind !== "timer" || typeof e.action === "function") continue;
        const { emit, entityId, data } = e.action;
        timers.push({
          id: e.id,
          due: e.paused === null ? e.due - offset : tick + e.paused,
          ...(e.period !== null ? { period: Math.max(1, e.period) } : {}),
          ...(e.left !== null ? { times: e.left } : {}),
          emit,
          ...(entityId !== undefined ? { entityId } : {}),
          ...(data !== undefined ? { data: data as JsonValue } : {}),
          ...(e.owner !== undefined ? { owner: e.owner } : {}),
        });
      }
      return { timers, next: nextId };
    },
    restore(saved, tick, next) {
      entries.clear();
      offset = 0;
      seekPhase = null;
      lastPhase = tick - 1;
      let top = 0;
      for (const t of saved) {
        const owner = t.owner;
        const paused = owner !== undefined && ctx.exists(owner) && !ctx.enabled(owner);
        entries.set(t.id, {
          kind: "timer",
          id: t.id,
          owner,
          due: t.due,
          paused: paused ? Math.max(0, t.due - tick) : null,
          action: {
            emit: t.emit,
            ...(t.entityId !== undefined ? { entityId: t.entityId } : {}),
            ...(t.data !== undefined ? { data: structuredClone(t.data) } : {}),
          },
          period: t.period ?? null,
          left: t.times ?? null,
        });
        top = Math.max(top, t.id);
      }
      nextId = Math.max(next, top + 1, 1);
    },
  };
}
