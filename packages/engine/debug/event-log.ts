import type { StepEvent } from "../runtime/types";

/** Events an event log keeps before it drops the oldest. */
export const EVENT_LOG_CAPACITY = 10_000;

export type EventLogFilter = {
  /** Only events at or after this tick. */
  since?: number;
  types?: readonly string[];
  /** Only events naming this entity, as `entityId` or `other`. */
  entity?: string;
  /** The newest this many of what matches. */
  limit?: number;
};

/** The events of a run as they happened, each with its tick: plain data. */
export interface EventLog {
  /** Oldest first; at most `capacity` events. */
  list(opts?: EventLogFilter): readonly StepEvent[];
  readonly capacity: number;
  clear(): void;
  /**
   * Called with each tick's events as they happen, and with none when the
   * log is cleared; returns the unsubscribe.
   */
  subscribe(fn: (tick: number, events: readonly StepEvent[]) => void): () => void;
}

/** The log the shell fills: `append` takes each step's events. */
export type EventLogWriter = EventLog & {
  append(tick: number, events: readonly StepEvent[]): void;
};

const matches = (e: StepEvent, f: EventLogFilter, types: ReadonlySet<string> | null): boolean =>
  (f.since === undefined || e.tick >= f.since) &&
  (types === null || types.has(e.type)) &&
  (f.entity === undefined || e.entityId === f.entity || e.other === f.entity);

export function createEventLog(opts: { capacity?: number } = {}): EventLogWriter {
  const capacity = Math.max(1, Math.floor(opts.capacity ?? EVENT_LOG_CAPACITY));
  // Dropped events stay in front of `start` until compacting is worth a copy.
  let kept: StepEvent[] = [];
  let start = 0;
  const listeners = new Set<(tick: number, events: readonly StepEvent[]) => void>();
  const notify = (tick: number, events: readonly StepEvent[]) => {
    for (const fn of [...listeners]) fn(tick, events);
  };
  return {
    capacity,
    append(tick, events) {
      if (events.length === 0) return;
      for (const e of events) kept.push(e);
      const over = kept.length - start - capacity;
      if (over > 0) start += over;
      if (start >= capacity) {
        kept = kept.slice(start);
        start = 0;
      }
      notify(tick, events);
    },
    list(filter) {
      const live = kept.slice(start);
      if (!filter) return live;
      const types = filter.types ? new Set(filter.types) : null;
      const out = live.filter((e) => matches(e, filter, types));
      const limit = filter.limit;
      if (limit === undefined || out.length <= limit) return out;
      return limit <= 0 ? [] : out.slice(out.length - limit);
    },
    clear() {
      if (kept.length === start) return;
      kept = [];
      start = 0;
      notify(-1, []);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
