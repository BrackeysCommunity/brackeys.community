/**
 * The smokes' contact read, shared by the page, the Bun run (`../headless.ts`,
 * which the packed smoke also runs from the tarball, so this file imports
 * only `@jams/engine/*`) and their tests: a prop dropped onto a solid floor,
 * watched with `ctx.contacts`, under `-compat` Rapier. Every runtime must see
 * its first `contact:start` on `CONTACT_TICK`.
 */
import { CONTACT_START, createRegistry } from "@jams/engine/game";
import { createHeadlessRuntime, type RapierModule } from "@jams/engine/headless";
import { expandScene, parseSceneOrThrow, type SceneDefinition } from "@jams/engine/scene";

export const CONTACT_PROP = "drop";
export const CONTACT_FLOOR = "floor";

/** The tick every runtime's first `contact:start` between the prop and the floor falls on. */
export const CONTACT_TICK = 23;

/** Ticks the read steps before it gives up on a contact. */
export const CONTACT_MAX_TICKS = 120;

/** A prop 90 px above a floor, nothing else: gameless, so only the engine's primitives load. */
export const contactScene: SceneDefinition = {
  v: 3,
  name: "smoke-contact",
  bounds: [0, 0, 400, 300],
  settings: { physics: "rapier", gravity: [0, 1200] },
  entities: [
    { id: CONTACT_FLOOR, type: "solid", shape: ["box", 200, 220, 180, 20] },
    {
      id: CONTACT_PROP,
      type: "prop",
      shape: ["box", 200, 100, 10, 10],
      density: 1,
      restitution: 0,
    },
  ],
};

/** The first `contact:start` the watch raised, or null when none came within `CONTACT_MAX_TICKS`. */
export type ContactRead = { tick: number; other: string | null } | null;

/** Loads `contactScene`, watches the prop and steps until it touches something. */
export function readContact(rapier: RapierModule): ContactRead {
  const registry = createRegistry(null);
  const scene = expandScene(parseSceneOrThrow(contactScene, registry), registry);
  const runtime = createHeadlessRuntime({ rapier, registry, scene });
  try {
    runtime.ctx.contacts.watch(CONTACT_PROP);
    const { tickMs } = runtime.ctx.time;
    for (let i = 0; i < CONTACT_MAX_TICKS; i++) {
      const start = runtime
        .step(tickMs, [])
        .events.find((e) => e.type === CONTACT_START && e.entityId === CONTACT_PROP);
      if (start) return { tick: start.tick, other: start.other ?? null };
    }
    return null;
  } finally {
    runtime.destroy();
  }
}

/**
 * Why a contact read fails, or null: the watched prop's first
 * `contact:start` came, against the floor, on `CONTACT_TICK`.
 */
export function judgeContact(read: ContactRead | undefined): string | null {
  if (read === undefined) return "the page ran no contact read";
  if (read === null) return "the dropped prop raised no contact:start";
  if (read.other !== CONTACT_FLOOR)
    return `the dropped prop's contact:start names ${read.other ?? "nothing"}, not ${CONTACT_FLOOR}`;
  if (read.tick !== CONTACT_TICK)
    return `the dropped prop's contact:start came on tick ${read.tick}, not ${CONTACT_TICK}`;
  return null;
}
