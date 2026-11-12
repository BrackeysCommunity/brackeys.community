/** One timed thing: how often it ran, how long in all, and the most it took within one span. */
export type TimingBucket = {
  calls: number;
  totalMs: number;
  maxMs: number;
};

/**
 * One kind of span (a tick, a frame) over a run: `calls` spans, their total
 * and the longest, the named parts each span was split into, and
 * `unattributedMs`, the total less the parts: what no part covers, the
 * clock's own cost included. A part's `calls` counts every time it ran, and
 * its `maxMs` is the most it took in one span.
 */
export type TimingSpan = TimingBucket & {
  unattributedMs: number;
  /** In the order the parts first ran; a part that never ran is left out. */
  parts: Record<string, TimingBucket>;
};

/**
 * Where a run's wall time went. `tick` is the runtime's step. The browser
 * shell adds `shell` (its whole tick, the runtime's step being part `step`),
 * `frame` (what it does each rendered frame before the draw) and `draw`
 * (Pixi's render call on the CPU; the GPU's own time isn't in it). Wall
 * time: two runs never report the same numbers.
 */
export type TimingReport = {
  tick: TimingSpan;
  shell?: TimingSpan;
  frame?: TimingSpan;
  draw?: TimingSpan;
};

/** One kind of span being timed: `begin`, a `lap` after each part, `end`. */
export type TimingScope = {
  /** Opens a span; false, timing nothing, while the collector is off. */
  begin(): boolean;
  /** Credits the time since `begin` or the last `lap` to `part`; nothing outside a span. */
  lap(part: string): void;
  /** Closes the span. One a throw left open is dropped by the next `begin`. */
  end(): void;
};

/**
 * Collects wall-clock timings on the clock its host hands it. A runtime
 * given one (`SceneRuntimeOptions.timing`) times each step into scope
 * `tick` and reports it as `RuntimeStats.timing`; one collector may serve
 * several runtimes, their spans adding up. Nothing it measures reaches the
 * simulation, a recording, a save or a hash.
 */
export type RunTiming = {
  /** Off, every scope's `begin` is false and nothing reads the clock. */
  enabled: boolean;
  scope(name: string): TimingScope;
  /** Each scope's spans so far; `shell`, `frame` and `draw` only once they ran. */
  report(): TimingReport;
  /** Forgets everything measured; scopes stay valid. */
  reset(): void;
};

type Part = TimingBucket & { pending: number };

type Scope = TimingScope & { report(): TimingSpan; reset(): void };

/** Milliseconds to the microsecond. */
const ms = (value: number) => Math.round(value * 1000) / 1000;

/** A collector on `now`, a millisecond clock such as `performance.now`; it starts enabled. */
export function createRunTiming(now: () => number): RunTiming {
  const scopes = new Map<string, Scope>();

  function createScope(): Scope {
    const parts = new Map<string, Part>();
    const span: TimingBucket = { calls: 0, totalMs: 0, maxMs: 0 };
    let open = false;
    let started = 0;
    let mark = 0;

    return {
      begin() {
        if (!timing.enabled) return false;
        if (open) for (const part of parts.values()) part.pending = 0;
        open = true;
        started = mark = now();
        return true;
      },
      lap(name) {
        if (!open) return;
        const at = now();
        let part = parts.get(name);
        if (!part) parts.set(name, (part = { calls: 0, totalMs: 0, maxMs: 0, pending: 0 }));
        part.calls++;
        part.pending += at - mark;
        mark = at;
      },
      end() {
        if (!open) return;
        open = false;
        const took = now() - started;
        span.calls++;
        span.totalMs += took;
        if (took > span.maxMs) span.maxMs = took;
        for (const part of parts.values()) {
          part.totalMs += part.pending;
          if (part.pending > part.maxMs) part.maxMs = part.pending;
          part.pending = 0;
        }
      },
      report() {
        const out: Record<string, TimingBucket> = {};
        let covered = 0;
        for (const [name, part] of parts) {
          covered += part.totalMs;
          out[name] = { calls: part.calls, totalMs: ms(part.totalMs), maxMs: ms(part.maxMs) };
        }
        return {
          calls: span.calls,
          totalMs: ms(span.totalMs),
          maxMs: ms(span.maxMs),
          unattributedMs: ms(Math.max(0, span.totalMs - covered)),
          parts: out,
        };
      },
      reset() {
        open = false;
        parts.clear();
        span.calls = span.totalMs = span.maxMs = 0;
      },
    };
  }

  function scopeOf(name: string): Scope {
    let scope = scopes.get(name);
    if (!scope) scopes.set(name, (scope = createScope()));
    return scope;
  }

  const timing: RunTiming = {
    enabled: true,
    scope: scopeOf,
    report() {
      const report: TimingReport = { tick: scopeOf("tick").report() };
      for (const name of ["shell", "frame", "draw"] as const) {
        const span = scopes.get(name)?.report();
        if (span && span.calls > 0) report[name] = span;
      }
      return report;
    },
    reset() {
      for (const scope of scopes.values()) scope.reset();
    },
  };
  return timing;
}
