import { EngineError, type EventBus, type EventSubscribeOptions } from "../game/types";
import type { StepEvent } from "./types";

/** The bus a runtime owns: `EngineContext.events` plus what the tick and the lifecycle call. */
export type RuntimeEventBus = EventBus & {
  /**
   * Delivers `raised[from..]` to the handlers, events handlers raise
   * included; returns the index after the last event delivered.
   */
  dispatch(raised: StepEvent[], from: number): number;
  /** Ends every subscription `id` owns. */
  dropOwner(id: string): void;
  /** Ends every subscription; at unload. */
  clear(): void;
};

export type EventBusOptions = {
  /** Warns about subscriptions made before the first load, which that load ends. */
  dev?: boolean;
};

/** More deliveries than this in one dispatch pass means handlers are raising each other's events forever. */
export const EVENT_PASS_LIMIT = 4096;

type Subscription = {
  type: string;
  handler: (e: StepEvent) => void;
  entity: string | undefined;
  owner: string | undefined;
  once: boolean;
  active: boolean;
};

const matchesId = (candidate: string | undefined, id: string) =>
  candidate !== undefined && (candidate === id || candidate.startsWith(`${id}/`));

const matches = (sub: Subscription, e: StepEvent) =>
  sub.entity === undefined || matchesId(e.entityId, sub.entity) || matchesId(e.other, sub.entity);

export function createEventBus(opts: EventBusOptions = {}): RuntimeEventBus {
  /**
   * Per event type, in subscription order. Lists are replaced, never
   * mutated, so a delivery in progress walks the list as it was when the
   * event reached it: a handler subscribed mid-event waits for the next one.
   */
  const byType = new Map<string, readonly Subscription[]>();
  const byOwner = new Map<string, Set<Subscription>>();
  let count = 0;
  /** Set by the first `clear`, which every load runs before the game's `onLoad`. */
  let loaded = false;

  function end(sub: Subscription): void {
    if (!sub.active) return;
    sub.active = false;
    count--;
    const list = byType.get(sub.type)!;
    if (list.length === 1) byType.delete(sub.type);
    else
      byType.set(
        sub.type,
        list.filter((s) => s !== sub),
      );
    if (sub.owner === undefined) return;
    const owned = byOwner.get(sub.owner)!;
    owned.delete(sub);
    if (owned.size === 0) byOwner.delete(sub.owner);
  }

  function subscribe(
    type: string,
    handler: (e: StepEvent) => void,
    subscribeOpts: EventSubscribeOptions | undefined,
    once: boolean,
  ): () => void {
    if (!loaded && opts.dev) {
      console.warn(
        `[events] a subscription to "${type}" was made before the first load, which ends it; subscribe in onLoad or later`,
      );
    }
    const sub: Subscription = {
      type,
      handler,
      entity: subscribeOpts?.entity,
      owner: subscribeOpts?.owner,
      once,
      active: true,
    };
    count++;
    byType.set(type, [...(byType.get(type) ?? []), sub]);
    if (sub.owner !== undefined) {
      let owned = byOwner.get(sub.owner);
      if (!owned) byOwner.set(sub.owner, (owned = new Set()));
      owned.add(sub);
    }
    return () => end(sub);
  }

  return {
    on: (type, handler, subscribeOpts) => subscribe(type, handler, subscribeOpts, false),
    once: (type, handler, subscribeOpts) => subscribe(type, handler, subscribeOpts, true),

    dispatch(raised, from) {
      let delivered = 0;
      for (let i = from; i < raised.length && count > 0; i++) {
        const e = raised[i]!;
        const list = byType.get(e.type);
        if (!list) continue;
        let reached = false;
        for (const sub of list) {
          if (!sub.active || !matches(sub, e)) continue;
          if (!reached) {
            reached = true;
            if (++delivered > EVENT_PASS_LIMIT) {
              throw new EngineError(
                "event-loop",
                `one dispatch pass delivered more than ${EVENT_PASS_LIMIT} events (last "${e.type}"); handlers are raising events in a loop`,
                e.entityId,
              );
            }
          }
          if (sub.once) end(sub);
          sub.handler(e);
        }
      }
      return raised.length;
    },

    dropOwner(id) {
      const owned = byOwner.get(id);
      if (owned) for (const sub of [...owned]) end(sub);
    },

    clear() {
      loaded = true;
      for (const list of byType.values()) for (const sub of list) sub.active = false;
      byType.clear();
      byOwner.clear();
      count = 0;
    },
  };
}
