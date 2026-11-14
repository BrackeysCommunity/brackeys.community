import { beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { defineEntityType, defineGame } from "../game/define";
import { pointField, refField } from "../game/fields";
import type { LibraryScene, SceneLibrary, SublevelResult } from "../game/flow";
import type { GameDefinition } from "../game/types";
import { runPlaytest } from "../headless/playtest";
import { replayRecording } from "../headless/recording";
import { loadListed } from "../runtime/flow";
import { createSceneRuntime } from "../runtime/runtime";
import {
  ENTITY_DESTROYED,
  ENTITY_SPAWNED,
  SENSOR_ENTER,
  type SceneRuntimeHandle,
  type StepEvent,
} from "../runtime/types";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type Prefab,
  type SceneDefinition,
  type SceneSettings,
} from "../scene/types";
import type { RapierModule } from "../types";
import { testGame } from "./fixtures/test-game";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const ATTACH = "attach";
const DETACH = "detach";
const SPAWN = "spawn";

const LEVER = defineEntityType({
  type: "lever",
  description: "A marker that opens another entity.",
  base: "marker",
  fields: {
    at: pointField("Where the lever stands."),
    opens: refField("The entity it opens."),
  },
  refs: [{ field: "opens", targets: ["marker"] }],
});

type Snap = { entities: number; sublevels: string[] };

/**
 * A game driven by commands: `attach` and `detach` a sublevel, `spawn` a
 * marker (for a sublevel or not). Each attach's result is logged.
 */
function roomsGame(results: SublevelResult[] = []): GameDefinition<Snap> {
  return defineGame<Snap>({
    id: "rooms",
    types: [LEVER],
    actions: [{ action: "use", keys: ["e"], description: "Use." }],
    commands: {
      [ATTACH]: {
        description: "Attaches a sublevel.",
        args: z.strictObject({
          scene: z.string().describe("The scene."),
          label: z.string().describe("Its label."),
          at: z.array(z.number()).length(2).optional().describe("Its offset."),
          z: z.number().optional().describe("Added to its z."),
        }),
      },
      [DETACH]: {
        description: "Detaches a sublevel.",
        args: z.strictObject({ label: z.string().describe("Its label.") }),
      },
      [SPAWN]: {
        description: "Spawns a marker.",
        args: z.strictObject({ sublevel: z.string().optional().describe("Its sublevel.") }),
      },
    },
    createRuntime(ctx) {
      return {
        beforeStep(_dt, _actions, commands) {
          for (const c of commands) {
            const args = c.args as Record<string, unknown>;
            if (c.name === ATTACH) {
              results.push(
                ctx.flow.attach(args.scene as string, {
                  label: args.label as string,
                  ...(args.at ? { at: args.at as [number, number] } : {}),
                  ...(args.z !== undefined ? { z: args.z as number } : {}),
                }),
              );
            }
            if (c.name === DETACH) ctx.flow.detach(args.label as string);
            if (c.name === SPAWN)
              ctx.spawn({
                type: "marker",
                at: [1, 1],
                ...(args.sublevel ? { sublevel: args.sublevel as string } : {}),
              });
          }
        },
        snapshot: () => ({
          entities: ctx.query.count(),
          sublevels: ctx.flow.sublevels().map((s) => s.label),
        }),
      };
    },
  });
}

const GRID: SceneSettings["grid"] = { kind: "square", cell: [1, 1] };

const lamp: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "lamp",
  entities: [{ id: "bulb", type: "marker", at: [0, 0] }],
};

function hall(settings: SceneSettings, game = "rooms"): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    name: "hall",
    game,
    bounds: [0, 0, 8, 4],
    settings,
    entities: [
      { id: "start", type: "marker", at: [0.5, 0.5] },
      { id: "pillar", type: "solid", shape: ["box", 2.5, 2.5, 0.5, 0.5] },
    ],
  };
}

function cellar(settings: SceneSettings, extra: EntityDef[] = []): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    name: "cellar",
    game: "rooms",
    bounds: [0, 0, 4, 4],
    settings,
    solid: [["box", 2.5, 2.5, 0.5, 0.5]],
    entities: [
      { id: "door", type: "marker", at: [0.5, 0.5], tags: ["door"] },
      { id: "lever", type: "lever", at: [1.5, 0.5], opens: "door" },
      { id: "wall", type: "solid", shape: ["box", 1.5, 1.5, 0.5, 0.5] },
      { id: "zone", type: "sensor", shape: ["box", 3.5, 0.5, 0.4, 0.4] },
      ...extra,
    ],
    instances: [{ id: "lamp-1", prefab: "lamp", at: [3.5, 3.5] }],
  };
}

const listed = (def: SceneDefinition): LibraryScene => ({
  def,
  prefabs: new Map([["lamp", lamp]]),
});

function library(physics: "none" | "rapier", over: Record<string, SceneDefinition> = {}) {
  const settings: SceneSettings =
    physics === "none" ? { physics, grid: GRID, gravity: [0, 0] } : { physics, gravity: [0, 0] };
  const scenes = new Map<string, LibraryScene>([
    ["hall", listed(hall(settings))],
    ["cellar", listed(cellar(settings))],
    ["heavy", listed({ ...cellar({ ...settings, physics: "rapier" }), name: "heavy" })],
    ["light", listed({ ...cellar({ ...settings, physics: "none" }), name: "light" })],
    ["fine", listed({ ...cellar({ ...settings, grid: { kind: "square", cell: [0.5, 0.5] } }) })],
    ["windy", listed({ ...cellar({ ...settings, gravity: [0, 9.8] }), name: "windy" })],
  ]);
  for (const [id, def] of Object.entries(over)) scenes.set(id, listed(def));
  const lib: SceneLibrary = {
    list: [
      { scene: "hall", title: "Hall" },
      { scene: "cellar", sublevel: true },
      { scene: "heavy", sublevel: true },
      { scene: "light", sublevel: true },
      { scene: "fine", sublevel: true },
      { scene: "windy", sublevel: true },
      ...Object.keys(over).map((scene) => ({ scene })),
    ],
    scenes,
  };
  return lib;
}

function setup(physics: "none" | "rapier" = "none") {
  const results: SublevelResult[] = [];
  const lib = library(physics);
  const rt = createSceneRuntime({
    rapier: physics === "rapier" ? rapier : null,
    view: null,
    game: roomsGame(results),
    scenes: () => lib,
  });
  const loaded = loadListed(rt, "hall");
  if (!loaded.ok) throw new Error(loaded.issue.message);
  return { rt, results, lib };
}

const step = (rt: SceneRuntimeHandle, commands: { name: string; args: unknown }[] = []) =>
  rt.step(rt.ctx.time.tickMs, [], commands as never);

const attach = (rt: SceneRuntimeHandle, args: Record<string, unknown>) =>
  step(rt, [{ name: ATTACH, args }]);

const ofType = (events: readonly StepEvent[], type: string) =>
  events.filter((e) => e.type === type).map((e) => e.entityId);

const CELLAR_IDS = [
  "cellar:lamp-1",
  "cellar:~solid:0",
  "cellar:wall",
  "cellar:zone",
  "cellar:door",
  "cellar:lamp-1/bulb",
  "cellar:lever",
];

describe("attach and detach", () => {
  for (const physics of ["none", "rapier"] as const) {
    it(`leaves bodies, colliders and entities as before on ${physics === "none" ? "geometry" : "Rapier"}`, () => {
      const { rt, results } = setup(physics);
      step(rt);
      const before = rt.stats();
      expect(before.backend).toBe(physics === "none" ? "geometry" : "rapier");

      const attached = attach(rt, { scene: "cellar", label: "cellar", at: [8, 0] });
      expect(results[0]).toEqual({ ok: true, entities: CELLAR_IDS });
      expect(ofType(attached.events, ENTITY_SPAWNED)).toEqual(CELLAR_IDS);
      const during = rt.stats();
      expect(during.entities).toBe(before.entities + CELLAR_IDS.length);
      expect(during.bodies).toBeGreaterThan(before.bodies);
      expect(during.colliders).toBeGreaterThan(before.colliders);
      expect(rt.ctx.flow.sublevels()).toEqual([{ label: "cellar", scene: "cellar", at: [8, 0] }]);

      const detached = step(rt, [{ name: DETACH, args: { label: "cellar" } }]);
      expect(ofType(detached.events, ENTITY_DESTROYED)).toEqual([...CELLAR_IDS].reverse());
      expect(rt.stats()).toEqual(before);
      expect(rt.ctx.flow.sublevels()).toEqual([]);
      expect(rt.ctx.bounds).toEqual([0, 0, 8, 4]);
      rt.destroy();
    });
  }

  it("names entities <label>:<id> and <label>:<inst>/<child>, moved by at, refs and z following", () => {
    const { rt } = setup();
    attach(rt, { scene: "cellar", label: "cellar", at: [8, 0], z: 3 });
    expect(rt.get("cellar:door")).toMatchObject({ at: [8.5, 0.5], tags: ["door"], z: 3 });
    expect(rt.get("cellar:lever")).toMatchObject({ at: [9.5, 0.5], opens: "cellar:door" });
    expect(rt.get("cellar:lamp-1/bulb")).toMatchObject({ at: [11.5, 3.5] });
    expect(rt.get("cellar:wall")).toMatchObject({ shape: { cx: 9.5, cy: 1.5 } });
    expect(rt.get("door")).toBeUndefined();
    expect(rt.ctx.bounds).toEqual([0, 0, 12, 4]);
    rt.destroy();
  });

  it("adds the sublevel's grid walls and widens the grid at attach, and removes both at detach", () => {
    const { rt } = setup();
    const grid = () => rt.ctx.grid!;
    expect(grid().occupancy.wall([2, 2])).toBe(true);
    expect(grid().bounds).toEqual({ c0: 0, r0: 0, c1: 7, r1: 3 });
    attach(rt, { scene: "cellar", label: "cellar", at: [8, 0] });
    expect(grid().occupancy.wall([9, 1])).toBe(true);
    expect(grid().occupancy.wall([10, 2])).toBe(true);
    expect(grid().bounds).toEqual({ c0: 0, r0: 0, c1: 11, r1: 3 });
    expect(grid().passable([11, 3])).toBe(true);
    step(rt, [{ name: DETACH, args: { label: "cellar" } }]);
    expect(grid().occupancy.wall([9, 1])).toBe(false);
    expect(grid().occupancy.wall([10, 2])).toBe(false);
    expect(grid().occupancy.wall([2, 2])).toBe(true);
    expect(grid().bounds).toEqual({ c0: 0, r0: 0, c1: 7, r1: 3 });
    rt.destroy();
  });

  it("destroys at the tick's destroy flush, and outside a step at once", () => {
    const { rt } = setup();
    expect(rt.ctx.flow.attach("cellar", { label: "cellar" }).ok).toBe(true);
    expect(rt.get("cellar:door")).toBeDefined();
    rt.ctx.flow.detach("cellar");
    expect(rt.get("cellar:door")).toBeUndefined();
    expect(rt.stats().entities).toBe(2);
    rt.destroy();
  });

  it("detaches every spawn made for the sublevel, and keeps the rest", () => {
    const { rt } = setup();
    attach(rt, { scene: "cellar", label: "cellar", at: [8, 0] });
    step(rt, [
      { name: SPAWN, args: { sublevel: "cellar" } },
      { name: SPAWN, args: {} },
    ]);
    expect(rt.get("marker#1")).toBeDefined();
    const detached = step(rt, [{ name: DETACH, args: { label: "cellar" } }]);
    expect(ofType(detached.events, ENTITY_DESTROYED)).toContain("marker#1");
    expect(rt.get("marker#1")).toBeUndefined();
    expect(rt.get("marker#2")).toBeDefined();
    rt.destroy();
  });

  it("refuses a spawn for a sublevel that isn't attached", () => {
    const { rt } = setup();
    expect(() => rt.ctx.spawn({ type: "marker", at: [1, 1], sublevel: "attic" })).toThrow(
      /no sublevel with that label is attached/,
    );
    rt.destroy();
  });

  it("forgets its sublevels when the main scene loads again", () => {
    const { rt } = setup();
    attach(rt, { scene: "cellar", label: "cellar" });
    expect(loadListed(rt, "hall").ok).toBe(true);
    expect(rt.ctx.flow.sublevels()).toEqual([]);
    expect(rt.get("cellar:door")).toBeUndefined();
    expect(rt.ctx.flow.attach("cellar", { label: "cellar" }).ok).toBe(true);
    rt.destroy();
  });
});

describe("runtime id counters", () => {
  it("keep counting across attach and detach, and reset only on a main-scene load", () => {
    const { rt } = setup();
    step(rt, [{ name: SPAWN, args: {} }]);
    attach(rt, { scene: "cellar", label: "cellar", at: [8, 0] });
    step(rt, [{ name: SPAWN, args: { sublevel: "cellar" } }]);
    step(rt, [{ name: DETACH, args: { label: "cellar" } }]);
    attach(rt, { scene: "cellar", label: "cellar", at: [8, 0] });
    step(rt, [{ name: SPAWN, args: {} }]);
    expect(rt.get("marker#1")).toBeDefined();
    expect(rt.get("marker#2")).toBeUndefined();
    expect(rt.get("marker#3")).toBeDefined();
    loadListed(rt, "hall");
    step(rt, [{ name: SPAWN, args: {} }]);
    expect(rt.get("marker#1")).toBeDefined();
    rt.destroy();
  });
});

describe("sublevel-invalid", () => {
  const refused = (
    args: Record<string, unknown>,
    physics: "none" | "rapier" = "none",
    first?: Record<string, unknown>,
  ) => {
    const { rt, results } = setup(physics);
    if (first) attach(rt, first);
    attach(rt, args);
    const result = results[results.length - 1]!;
    if (!result.ok) expect(rt.stats().entities).toBe(2 + (first ? CELLAR_IDS.length : 0));
    rt.destroy();
    return result.ok ? null : result.issue;
  };
  const reasonOf = (...args: Parameters<typeof refused>) => {
    const issue = refused(...args);
    expect(issue?.code).toBe("sublevel-invalid");
    expect(issue?.severity).toBe("error");
    return (issue?.detail as { reason?: string } | undefined)?.reason;
  };

  it('"unlisted": a scene the list doesn\'t hold', () => {
    expect(reasonOf({ scene: "ghost", label: "ghost" })).toBe("unlisted");
  });

  it('"physics": a sublevel on another backend', () => {
    expect(reasonOf({ scene: "heavy", label: "heavy" })).toBe("physics");
    expect(reasonOf({ scene: "light", label: "light" }, "rapier")).toBe("physics");
  });

  it('"grid": another cell size, at off a cell, or at off a whole pixel', () => {
    expect(reasonOf({ scene: "fine", label: "fine" })).toBe("grid");
    expect(reasonOf({ scene: "cellar", label: "cellar", at: [8.5, 0] })).toBe("grid");
    expect(reasonOf({ scene: "cellar", label: "cellar", at: [8.0001, 0] })).toBe("grid");
    expect(refused({ scene: "cellar", label: "cellar", at: [-3, 2] })).toBeNull();
  });

  it('"label": malformed, or taken', () => {
    expect(reasonOf({ scene: "cellar", label: "Cellar" })).toBe("label");
    expect(reasonOf({ scene: "cellar", label: "a:b" })).toBe("label");
    const first = { scene: "cellar", label: "cellar", at: [8, 0] };
    expect(reasonOf({ scene: "cellar", label: "cellar", at: [12, 0] }, "none", first)).toBe(
      "label",
    );
  });

  it('"settings": another gravity', () => {
    expect(reasonOf({ scene: "windy", label: "windy" })).toBe("settings");
  });

  it("names the label until a detach's flush, then frees it", () => {
    const { rt } = setup();
    expect(rt.ctx.flow.attach("cellar", { label: "cellar" }).ok).toBe(true);
    rt.ctx.flow.detach("cellar");
    expect(rt.ctx.flow.attach("cellar", { label: "cellar" }).ok).toBe(true);
    rt.destroy();
  });
});

describe("queries and sensors", () => {
  it("queries see sublevel entities", () => {
    const { rt } = setup();
    attach(rt, { scene: "cellar", label: "cellar", at: [8, 0] });
    expect(rt.ctx.query.byTag("door")).toEqual(["cellar:door"]);
    expect(rt.ctx.query.at({ x: 9.5, y: 1.5 })).toContain("cellar:wall");
    expect(rt.ctx.space.pointAt({ x: 9.5, y: 1.5 }).map((h) => h.tag.entityId)).toContain(
      "cellar:wall",
    );
    rt.destroy();
  });

  it("sensors see sublevel entities, and sublevel sensors see the avatar", () => {
    const shape = (cx: number, cy: number) => ["box", cx, cy, 0.4, 0.4] as const;
    const base = (name: string, entities: EntityDef[]): SceneDefinition => ({
      v: SCENE_FORMAT_VERSION,
      name,
      game: "test-game",
      bounds: [0, 0, 20, 10],
      settings: { physics: "rapier", gravity: [0, 0] },
      entities,
    });
    const lib: SceneLibrary = {
      list: [{ scene: "yard" }, { scene: "nook", sublevel: true }],
      scenes: new Map([
        [
          "yard",
          {
            def: base("yard", [
              {
                id: "avatar",
                type: "prop",
                shape: [...shape(10.5, 1)],
                density: 1,
                restitution: 0,
              },
            ]),
            prefabs: new Map(),
          },
        ],
        [
          "nook",
          {
            def: base("nook", [{ id: "zone", type: "sensor", shape: [...shape(0.5, 1)] }]),
            prefabs: new Map(),
          },
        ],
      ]),
    };
    const rt = createSceneRuntime({ rapier, view: null, game: testGame, scenes: () => lib });
    expect(loadListed(rt, "yard").ok).toBe(true);
    step(rt);
    expect(rt.ctx.flow.attach("nook", { label: "nook", at: [10, 0] }).ok).toBe(true);
    const events = [step(rt), step(rt)].flatMap((r) => r.events);
    expect(events.filter((e) => e.type === SENSOR_ENTER).map((e) => [e.entityId, e.other])).toEqual(
      [["nook:zone", "avatar"]],
    );
    rt.destroy();
  });
});

describe("a replay with an attach", () => {
  it("matches the recorded run", () => {
    const lib = library("none");
    const game = roomsGame();
    const run = runPlaytest<Snap>({
      game,
      scene: lib.scenes.get("hall")!.def,
      flow: lib,
      script: {
        v: 2,
        steps: [
          { wait: 2 },
          { command: ATTACH, args: { scene: "cellar", label: "cellar", at: [8, 0] } },
          { wait: 2 },
          { command: SPAWN, args: { sublevel: "cellar" } },
          { command: DETACH, args: { label: "cellar" } },
          { wait: 2 },
        ],
      },
    });
    if (run.blocked) throw new Error(`blocked: ${JSON.stringify(run)}`);
    expect(run.final).toEqual({ entities: 2, sublevels: [] });
    const again = replayRecording<Snap>({
      game,
      scene: lib.scenes.get("hall")!.def,
      recording: run.recording,
      flow: lib,
    });
    if (again.blocked) throw new Error(`replay blocked: ${JSON.stringify(again)}`);
    expect(again.matches, again.divergence ?? "").toBe(true);
    expect(again.final).toEqual(run.final);
  });
});
