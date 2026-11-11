import type { BehaviorSystem, BehaviorSystemFactory } from "../../game/behaviors";
import type { LifetimeBlock } from "../../game/behaviors/lifetime";
import type { Delay, EngineContext } from "../../game/types";

/**
 * The lifetime system: attaching or enabling an entity with a `lifetime`
 * block schedules a timer it owns, which destroys or disables it. The timer
 * pauses while the entity is disabled; enabling starts a fresh one.
 */
export const createLifetimeSystem: BehaviorSystemFactory = (ctx: EngineContext) => {
  const blocks = new Map<string, LifetimeBlock>();
  const timers = new Map<string, number>();

  function cancel(id: string): void {
    const timer = timers.get(id);
    if (timer === undefined) return;
    timers.delete(id);
    ctx.timers.cancel(timer);
  }

  function schedule(id: string, block: LifetimeBlock): void {
    cancel(id);
    const delay: Delay = block.ms !== undefined ? { ms: block.ms } : (block.ticks ?? 1);
    const then = block.then ?? "destroy";
    const timer = ctx.timers.after(
      delay,
      () => {
        timers.delete(id);
        if (then === "disable") ctx.setEnabled(id, false);
        else ctx.destroy(id);
      },
      { owner: id },
    );
    timers.set(id, timer);
  }

  const system: BehaviorSystem<LifetimeBlock> = {
    attach(id, block) {
      blocks.set(id, block);
      schedule(id, block);
    },
    detach(id) {
      cancel(id);
      blocks.delete(id);
    },
    disable() {
      // The owned timer pauses with its owner; `enable` replaces it.
    },
    enable(id) {
      const block = blocks.get(id);
      if (block) schedule(id, block);
    },
    clear() {
      for (const id of blocks.keys()) system.detach(id);
    },
    size: () => blocks.size,
  };
  return system as BehaviorSystem;
};
