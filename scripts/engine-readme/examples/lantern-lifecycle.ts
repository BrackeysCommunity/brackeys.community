import {
  createRegistry,
  defineBehavior,
  defineEntityType,
  defineGame,
  ENTITY_DESTROYED,
  ENTITY_DISABLED,
  ENTITY_SPAWNED,
  pointField,
  type BehaviorSystem,
  type SceneSystem,
} from "@jams/engine/game";
import { createHeadlessRuntime } from "@jams/engine/headless";
import { expandScene, type SceneDefinition } from "@jams/engine/scene";
import { z } from "zod";

/** Every hook a lantern's system and its `night/glow` block see, in the order they ran. */
export function lanternNight(): string[] {
  const log: string[] = [];

  const lantern = defineEntityType({
    type: "lantern",
    description: "A light on a post; its system keeps whether each one is lit.",
    fields: { at: pointField("Where the post stands.") },
    system: (): SceneSystem => {
      const lit = new Map<string, boolean>();
      return {
        spawn: (e) => void lit.set(e.id, true),
        despawn: (id) => void (lit.delete(id) && log.push(`despawn ${id}`)),
        clear: () => lit.clear(),
        size: () => lit.size,
        ready: (ids) => void log.push(`ready lantern ${ids.join(",")}`),
        // With `disable`, the entity keeps its state; without it the runtime
        // despawns it and spawns it again from its record on enable.
        disable: (id) => void (lit.set(id, false), log.push(`disable lantern ${id}`)),
        enable: (id) => void (lit.set(id, true), log.push(`enable lantern ${id}`)),
      };
    },
  });

  const glow = defineBehavior({
    name: "night/glow",
    description: "A halo round a lantern.",
    fields: { radius: z.number().positive().default(0.4).describe("Halo radius, m.") },
    system: (): BehaviorSystem => {
      const on = new Set<string>();
      return {
        attach: (id) => void (on.add(id), log.push(`attach glow ${id}`)),
        detach: (id) => void on.delete(id),
        clear: () => on.clear(),
        size: () => on.size,
        ready: (ids) => void log.push(`ready glow ${ids.join(",")}`),
        disable: (id) => void log.push(`disable glow ${id}`),
        enable: (id) => void log.push(`enable glow ${id}`),
      };
    },
  });

  const night = defineGame({
    id: "night",
    types: [lantern],
    behaviors: [glow],
    actions: [],
    commands: {
      light: { description: "Put up one more lantern." },
      douse: { description: "Put a lantern out.", args: z.strictObject({ id: z.string() }) },
      knock: { description: "Knock a lantern down.", args: z.strictObject({ id: z.string() }) },
    },
    createRuntime: (ctx) => ({
      onLoad() {
        log.push("onLoad");
        // Subscriptions end at unload, so every load subscribes again here.
        for (const type of [ENTITY_SPAWNED, ENTITY_DISABLED, ENTITY_DESTROYED])
          ctx.events.on(type, (e) => void log.push(`${e.type} ${e.entityId}`));
      },
      beforeStep(_dtMs, _actions, commands) {
        for (const c of commands) {
          const { id } = (c.args ?? {}) as { id?: string };
          if (c.name === "light")
            ctx.spawn({ type: "lantern", at: [0, 0], behaviors: { "night/glow": {} } });
          if (c.name === "douse" && id) ctx.setEnabled(id, false);
          if (c.name === "knock" && id) {
            ctx.destroy(id);
            // Inside a step a destroy waits for the end of the tick.
            log.push(`${id} exists after destroy: ${ctx.exists(id)}`);
          }
        }
      },
      snapshot: () => null,
    }),
  });

  const registry = createRegistry(night);
  const lane: SceneDefinition = {
    v: 4,
    game: "night",
    name: "lane",
    bounds: [0, 0, 2, 1],
    settings: { physics: "none" },
    entities: [
      { id: "west", type: "lantern", at: [0.2, 0.5], behaviors: { "night/glow": {} } },
      { id: "east", type: "lantern", at: [1.8, 0.5], behaviors: { "night/glow": { radius: 0.6 } } },
    ],
  };
  const rt = createHeadlessRuntime({ game: night, registry, scene: expandScene(lane, registry) });
  rt.step(rt.ctx.time.tickMs, [], [{ name: "light" }, { name: "douse", args: { id: "west" } }]);
  rt.step(rt.ctx.time.tickMs, [], [{ name: "knock", args: { id: "east" } }]);
  log.push(`east exists: ${rt.ctx.exists("east")}`);
  rt.ctx.setEnabled("west", true);
  rt.destroy();
  return log;
}
