import type { BehaviorName } from "../game/behaviors";
import type { EntityTypeName } from "../scene/types";
import { createRunTiming, type RunTiming, type TimingScope } from "./timing";

/** A step's phases, in tick order; the tick counter's own increment isn't timed. */
export const TICK_PHASES = [
  "systems-before",
  "game-before",
  "physics",
  "systems-after",
  "behaviors",
  "timers",
  "dispatch-1",
  "game-after",
  "destroy",
  "dispatch-2",
  "commit",
] as const;

export type TickPhase = (typeof TICK_PHASES)[number];

/** Milliseconds per tick over a window: the mean and the worst. */
export type TimingStat = { mean: number; max: number };

/**
 * Where the last window's ticks went, wall-clock milliseconds. Never part of
 * state, a recording, a save or a digest: two runs never report the same.
 */
export type RuntimeTimings = {
  /** Ticks in the window these numbers cover. */
  ticks: number;
  /** Mean and worst ms per tick, per phase, over the window. */
  phases: Readonly<Record<TickPhase, TimingStat>>;
  systems: Readonly<Record<EntityTypeName, TimingStat>>;
  behaviors: Readonly<Record<BehaviorName, TimingStat>>;
  /** Shell only: render and the frame's presentation work. */
  frame?: { render: TimingStat; present: TimingStat };
};

/** A millisecond clock, such as `performance.now`. */
export type Clock = () => number;

/** Ticks a `RuntimeTimings` window covers unless the host asks otherwise. */
export const DEFAULT_TIMINGS_WINDOW = 120;

/** `SceneRuntimeOptions.timings`. */
export type TimingsOptions = {
  clock: Clock;
  /** Ticks per window; default `DEFAULT_TIMINGS_WINDOW`. */
  window?: number;
  /** Read at each step's start: false skips timing that step. Default always on. */
  enabled?: () => boolean;
  /**
   * Until a window fills, `view()` gives the ticks timed so far instead of
   * null: for a run that may end before its first window, as `runStats`'s.
   */
  partial?: boolean;
};

/**
 * A windowed view over one `RunTiming` collector. The runtime opens each
 * step with `begin` and laps it by part name (`input`, `system.<type>.<hook>`,
 * `behavior.<name>[.<hook>]`, `physics.step`, `events`, …); each closed span
 * folds into the window by `phaseOf`.
 */
export type Timings = {
  readonly collector: RunTiming;
  readonly window: number;
  /** The step's span, or null when `enabled` says to skip it. */
  begin(): TimingScope | null;
  /** The last full window; null before one has filled (with `partial`, before any tick was timed). */
  view(): RuntimeTimings | null;
};

/** A part's phase and, for a type system's or a behavior's hook, whose it is. */
export type PartOwner = {
  phase: TickPhase;
  system?: EntityTypeName;
  behavior?: BehaviorName;
};

const PART_PHASES: Readonly<Record<string, TickPhase>> = {
  input: "systems-before",
  dialogue: "systems-before",
  "game.beforeStep": "game-before",
  "physics.step": "physics",
  contacts: "systems-after",
  timers: "timers",
  events: "dispatch-1",
  "game.afterStep": "game-after",
  lifecycle: "destroy",
  "events.again": "dispatch-2",
  "view.commit": "commit",
  "game.snapshot": "commit",
};

const SYSTEM_HOOK_PHASES: Readonly<Record<string, TickPhase>> = {
  beforeStep: "systems-before",
  beforePhysics: "physics",
  afterStep: "systems-after",
};

/** A behavior's step lap is its own phase; these hooks run inside the type systems' phases. */
const BEHAVIOR_HOOK_PHASES: Readonly<Record<string, TickPhase>> = {
  beforeStep: "systems-before",
  beforePhysics: "physics",
};

/** Where a step's lap belongs; null for a name the runtime never laps. */
export function phaseOf(part: string): PartOwner | null {
  const fixed = PART_PHASES[part];
  if (fixed) return { phase: fixed };
  if (part.startsWith("behavior.")) {
    const rest = part.slice("behavior.".length);
    const dot = rest.lastIndexOf(".");
    const phase = dot < 0 ? undefined : BEHAVIOR_HOOK_PHASES[rest.slice(dot + 1)];
    if (phase) return { phase, behavior: rest.slice(0, dot) };
    return { phase: "behaviors", behavior: rest };
  }
  if (part.startsWith("system.")) {
    const rest = part.slice("system.".length);
    const dot = rest.lastIndexOf(".");
    const phase = dot < 0 ? undefined : SYSTEM_HOOK_PHASES[rest.slice(dot + 1)];
    if (phase) return { phase, system: rest.slice(0, dot) };
  }
  return null;
}

type Acc = { total: number; max: number; tick: number };

const ms = (value: number) => Math.round(value * 1000) / 1000;

/** Milliseconds as the timing views print them, to the microsecond: `1.250`. */
export const formatMs = (value: number) => value.toFixed(3);

function settle(acc: Acc): void {
  acc.total += acc.tick;
  if (acc.tick > acc.max) acc.max = acc.tick;
  acc.tick = 0;
}

const statOf = (acc: Acc, count: number): TimingStat => ({
  mean: count > 0 ? ms(acc.total / count) : 0,
  max: ms(acc.max),
});

/** Builds the collector on `opts.clock` alone; nothing here reads any other clock. */
export function createTimings(opts: TimingsOptions): Timings {
  const collector = createRunTiming(opts.clock);
  collector.enabled = false;
  const window = Math.max(1, Math.floor(opts.window ?? DEFAULT_TIMINGS_WINDOW));
  const scope = collector.scope("tick");
  const owners = new Map<string, PartOwner | null>();
  const phases = new Map<TickPhase, Acc>(
    TICK_PHASES.map((p) => [p, { total: 0, max: 0, tick: 0 }]),
  );
  const systems = new Map<string, Acc>();
  const behaviors = new Map<string, Acc>();
  let ticks = 0;
  let last: RuntimeTimings | null = null;

  function add(into: Map<string, Acc>, key: string, took: number): void {
    let acc = into.get(key);
    if (!acc) into.set(key, (acc = { total: 0, max: 0, tick: 0 }));
    acc.tick += took;
  }

  const stat = (acc: Acc): TimingStat => statOf(acc, ticks);

  function statsOf(from: Map<string, Acc>): Record<string, TimingStat> {
    const out: Record<string, TimingStat> = {};
    for (const [key, acc] of from) out[key] = stat(acc);
    return out;
  }

  function current(): RuntimeTimings {
    const byPhase = {} as Record<TickPhase, TimingStat>;
    for (const phase of TICK_PHASES) byPhase[phase] = stat(phases.get(phase)!);
    return Object.freeze({
      ticks,
      phases: Object.freeze(byPhase),
      systems: Object.freeze(statsOf(systems)),
      behaviors: Object.freeze(statsOf(behaviors)),
    });
  }

  function publish(): void {
    last = current();
    ticks = 0;
    for (const acc of phases.values()) acc.total = acc.max = 0;
    systems.clear();
    behaviors.clear();
  }

  collector.onSpan = (_scope, parts) => {
    for (const [part, took] of parts) {
      let owner = owners.get(part);
      if (owner === undefined) owners.set(part, (owner = phaseOf(part)));
      if (!owner) continue;
      phases.get(owner.phase)!.tick += took;
      if (owner.system !== undefined) add(systems, owner.system, took);
      if (owner.behavior !== undefined) add(behaviors, owner.behavior, took);
    }
    for (const acc of phases.values()) settle(acc);
    for (const acc of systems.values()) settle(acc);
    for (const acc of behaviors.values()) settle(acc);
    if (++ticks >= window) publish();
  };

  return {
    collector,
    window,
    begin() {
      collector.enabled = opts.enabled ? opts.enabled() : true;
      return scope.begin() ? scope : null;
    },
    view: () => last ?? (opts.partial && ticks > 0 ? current() : null),
  };
}

/** The shell's half of `RuntimeTimings.frame`, windowed by rendered frames. */
export type FrameTimings = {
  /** Credits `took` ms to this frame's `part`. */
  add(part: "render" | "present", took: number): void;
  /** Closes the frame; every `window` frames the view moves on. */
  end(): void;
  /** The last full window; null before one has filled. */
  view(): NonNullable<RuntimeTimings["frame"]> | null;
};

export function createFrameTimings(window: number = DEFAULT_TIMINGS_WINDOW): FrameTimings {
  const size = Math.max(1, Math.floor(window));
  const render: Acc = { total: 0, max: 0, tick: 0 };
  const present: Acc = { total: 0, max: 0, tick: 0 };
  let frames = 0;
  let last: NonNullable<RuntimeTimings["frame"]> | null = null;
  return {
    add(part, took) {
      (part === "render" ? render : present).tick += took;
    },
    end() {
      settle(render);
      settle(present);
      if (++frames < size) return;
      last = Object.freeze({ render: statOf(render, frames), present: statOf(present, frames) });
      frames = 0;
      render.total = render.max = present.total = present.max = 0;
    },
    view: () => last,
  };
}
