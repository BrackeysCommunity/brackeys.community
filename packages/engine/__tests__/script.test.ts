// @vitest-environment node
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import type { BehaviorDef, BehaviorSystem } from "../game/behaviors";
import { createRegistry, defineGame } from "../game/define";
import type { Entity } from "../game/entity";
import { refField } from "../game/fields";
import { defineScript, Script, scriptProblem, type ScriptSelf } from "../game/script";
import type { GameDefinition } from "../game/types";
import { createSceneRuntime } from "../runtime/runtime";
import { CONTACT_START, SENSOR_ENTER, type StepEvent } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { SCENE_FORMAT_VERSION, type EntityDef, type RuntimeEntity } from "../scene/types";
import { testGame } from "./fixtures/test-game";

const DT = 1000 / 60;
const NAME = "probe/script";

const fields = { speed: z.number().default(1), tag: z.string().default("") };
type Fields = typeof fields;

/** The hooks every lifecycle row reads, logging `<hook>:<id>`; `fieldsChanged` keeps `onFieldsChanged`. */
function loggingHooks(self: ScriptSelf<Fields>, log: string[], fieldsChanged: boolean) {
  const id = () => self.fields.tag;
  return {
    awake: () => log.push(`awake:${self.entity.id}@${self.fields.speed}`),
    start: () => log.push(`start:${id()}`),
    beforeStep: () => log.push(`beforeStep:${id()}`),
    beforePhysics: () => log.push(`beforePhysics:${id()}`),
    step: () => log.push(`step:${id()}`),
    onEnable: () => log.push(`onEnable:${id()}`),
    onDisable: () => log.push(`onDisable:${id()}`),
    onDestroy: () => log.push(`onDestroy:${id()}`),
    ...(fieldsChanged
      ? {
          onFieldsChanged: (prev: Readonly<{ speed: number }>) =>
            log.push(`onFieldsChanged:${id()}:${prev.speed}>${self.fields.speed}`),
        }
      : {}),
  };
}

/** The same script both ways. */
function bothForms(log: string[], fieldsChanged: boolean): Record<string, BehaviorDef> {
  class Logged extends Script({ name: NAME, description: "Logs its hooks.", fields }) {
    awake(): void {
      log.push(`awake:${this.entity.id}@${this.fields.speed}`);
    }
    start(): void {
      log.push(`start:${this.fields.tag}`);
    }
    beforeStep(): void {
      log.push(`beforeStep:${this.fields.tag}`);
    }
    beforePhysics(): void {
      log.push(`beforePhysics:${this.fields.tag}`);
    }
    step(): void {
      log.push(`step:${this.fields.tag}`);
    }
    onEnable(): void {
      log.push(`onEnable:${this.fields.tag}`);
    }
    onDisable(): void {
      log.push(`onDisable:${this.fields.tag}`);
    }
    onDestroy(): void {
      log.push(`onDestroy:${this.fields.tag}`);
    }
  }
  class Tuned extends Logged {
    onFieldsChanged(prev: Readonly<{ speed: number }>): void {
      log.push(`onFieldsChanged:${this.fields.tag}:${prev.speed}>${this.fields.speed}`);
    }
  }
  return {
    class: (fieldsChanged ? Tuned : Logged).behavior,
    function: defineScript({
      name: NAME,
      description: "Logs its hooks.",
      fields,
      create: (self) => loggingHooks(self, log, fieldsChanged),
    }),
  };
}

function probeGame(behaviors: GameDefinition["behaviors"]): GameDefinition {
  return defineGame({
    id: "probe",
    types: [],
    actions: [],
    behaviors,
    createRuntime: () => ({ snapshot: () => null }),
  });
}

function world(entities: RuntimeEntity[], behaviors: GameDefinition["behaviors"], dev = false) {
  const rt = createSceneRuntime({ rapier: undefined, view: null, game: probeGame(behaviors), dev });
  const report = rt.load({
    name: "scripts",
    bounds: [-50, -50, 50, 50],
    settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
    entities,
  });
  if (!report.ok) throw new Error(report.error);
  return rt;
}

const scripted = (id: string, block: Record<string, unknown> = {}): RuntimeEntity => ({
  id,
  type: "node",
  at: [0, 0],
  behaviors: { [NAME]: { speed: 1, tag: id, ...block } },
});

/** The per-tick hooks a system has now. */
const tickHooksOn = (system: BehaviorSystem) =>
  (["beforeStep", "beforePhysics", "step", "render"] as const).filter(
    (hook) => Reflect.get(system, hook) !== undefined,
  );

type Row = { row: string; fieldsChanged?: boolean; run(rt: ReturnType<typeof world>): void };

/** E276's lifecycle, one row each, run on two entities `a` and `b`. */
const ROWS: { row: Row; expected: string[] }[] = [
  {
    row: { row: "attach builds and wakes, ready starts", run() {} },
    expected: ["awake:a@1", "awake:b@1", "start:a", "start:b"],
  },
  {
    row: { row: "the tick hooks run in attach order", run: (rt) => void rt.step(DT, []) },
    expected: [
      "beforeStep:a",
      "beforeStep:b",
      "beforePhysics:a",
      "beforePhysics:b",
      "step:a",
      "step:b",
    ],
  },
  {
    row: {
      row: "disable and enable call their hooks; a disabled instance skips the tick",
      run(rt) {
        rt.ctx.setEnabled("a", false);
        rt.step(DT, []);
        rt.ctx.setEnabled("a", true);
      },
    },
    expected: ["onDisable:a", "beforeStep:b", "beforePhysics:b", "step:b", "onEnable:a"],
  },
  {
    row: {
      row: "update swaps fields and calls onFieldsChanged",
      fieldsChanged: true,
      run: (rt) => void rt.update([scripted("a", { speed: 4 })]),
    },
    expected: ["onFieldsChanged:a:1>4"],
  },
  {
    row: {
      row: "update without onFieldsChanged rebuilds the instance",
      run: (rt) => void rt.update([scripted("a", { speed: 4 })]),
    },
    expected: ["onDestroy:a", "awake:a@4", "start:a"],
  },
  {
    row: { row: "detach calls onDestroy", run: (rt) => rt.ctx.destroy("b") },
    expected: ["onDestroy:b"],
  },
];

describe("a script, as a class and as a function", () => {
  for (const { row, expected } of ROWS) {
    it(row.row, () => {
      const logs: Record<string, string[]> = {};
      for (const form of ["class", "function"]) {
        const log: string[] = [];
        const rt = world(
          [scripted("a"), scripted("b")],
          [bothForms(log, row.fieldsChanged ?? false)[form]!],
        );
        if (row.row.startsWith("attach")) logs[form] = [...log];
        else {
          log.length = 0;
          row.run(rt);
          logs[form] = [...log];
        }
        rt.destroy();
      }
      expect(logs.class).toEqual(expected);
      expect(logs.function).toEqual(logs.class);
    });
  }

  it("runs an instance made during a tick from the next one, after awake and start", () => {
    for (const form of ["class", "function"]) {
      const log: string[] = [];
      const defs = bothForms(log, false);
      const rt = world([scripted("a")], [defs[form]!]);
      log.length = 0;
      const sub = rt.ctx.events.on("spawn-now", () =>
        rt.ctx.spawn({
          type: "node",
          id: "node#late",
          at: [1, 0],
          behaviors: { [NAME]: { tag: "node#late" } },
        }),
      );
      rt.ctx.timers.after(0, { emit: "spawn-now" });
      rt.step(DT, []);
      sub();
      expect(log, form).toEqual([
        "beforeStep:a",
        "beforePhysics:a",
        "step:a",
        "awake:node#late@1",
        "start:node#late",
      ]);
      log.length = 0;
      rt.step(DT, []);
      expect(log, form).toEqual([
        "beforeStep:a",
        "beforeStep:node#late",
        "beforePhysics:a",
        "beforePhysics:node#late",
        "step:a",
        "step:node#late",
      ]);
      rt.destroy();
    }
  });

  it("costs nothing per tick without a tick hook, and adds the hook while an instance has it", () => {
    const idle = defineScript({
      name: "probe/idle",
      description: "No tick hooks.",
      fields: {},
      create: () => ({ awake() {} }),
    });
    const rt = world(
      [{ id: "a", type: "node", at: [0, 0], behaviors: { "probe/idle": {} } }],
      [idle],
    );
    expect(tickHooksOn(rt.ctx.behavior("probe/idle")!)).toEqual([]);
    rt.destroy();

    const some = defineScript({
      name: "probe/some",
      description: "A step hook on one entity only.",
      fields: { on: z.boolean().default(false) },
      create: (self) => (self.fields.on ? { step() {} } : {}),
    });
    const two = world(
      [
        { id: "a", type: "node", at: [0, 0], behaviors: { "probe/some": {} } },
        { id: "b", type: "node", at: [0, 0], behaviors: { "probe/some": { on: true } } },
      ],
      [some],
    );
    const sys = two.ctx.behavior("probe/some")!;
    expect(tickHooksOn(sys)).toEqual(["step"]);
    two.ctx.destroy("b");
    expect(tickHooksOn(sys)).toEqual([]);
    two.destroy();
  });

  it("keeps the same instance for getBehavior, with entity and fields on the function form", () => {
    class Counter extends Script({
      name: "probe/counter",
      description: "Counts.",
      fields: { by: z.number().default(2) },
    }) {
      n = 0;
      bump(): number {
        this.n += this.fields.by;
        return this.n;
      }
    }
    const hooks = defineScript({
      name: "probe/hooks",
      description: "Doubles.",
      fields: { k: z.number().default(3) },
      create: (self) => ({ twice: () => self.fields.k * 2 }),
    });
    const rt = world(
      [
        {
          id: "a",
          type: "node",
          at: [0, 0],
          behaviors: { "probe/counter": { by: 2 }, "probe/hooks": { k: 3 } },
        },
      ],
      [Counter, hooks],
    );
    const a = rt.ctx.entity("a")!;
    const counter = a.getBehavior(Counter)!;
    expect(counter).toBeInstanceOf(Counter);
    expect(counter.bump()).toBe(2);
    expect(a.getBehavior(Counter)).toBe(counter);
    expect(a.getBehavior("probe/counter")).toBe(counter);
    expect(rt.ctx.findBehavior(Counter)).toBe(counter);
    expect(counter.entity).toBe(a);
    const h = a.getBehavior(hooks)!;
    expect(h.twice()).toBe(6);
    expect(h.entity).toBe(a);
    expect(h.fields.k).toBe(3);
    rt.destroy();
  });

  it("refuses a class built outside its system", () => {
    class Loose extends Script({ name: "probe/loose", description: "Loose.", fields: {} }) {}
    expect(() => new Loose()).toThrow(/built by its behavior's system/);
  });
});

describe("what a script reaches", () => {
  it("resolves a refField through scopedRef, and refuses a field it doesn't have", () => {
    const seen: (string | undefined)[] = [];
    const pointer = defineScript({
      name: "probe/pointer",
      description: "Points at another entity.",
      fields: { target: refField("What it points at.").optional() },
      create: (self) => ({
        start() {
          seen.push(self.ref("target")?.id);
          expect(() => self.ref("nope")).toThrow(/no field "nope"/);
        },
      }),
    });
    const rt = world(
      [
        { id: "door", type: "node", at: [0, 0] },
        { id: "a", type: "node", at: [0, 0], behaviors: { "probe/pointer": { target: "door" } } },
        { id: "b", type: "node", at: [0, 0], behaviors: { "probe/pointer": {} } },
      ],
      [pointer],
    );
    expect(seen).toEqual(["door", undefined]);
    rt.destroy();
  });

  it("owns its timers: cancelled with the entity, and an emit timer is about it", () => {
    const fired: string[] = [];
    const timed = defineScript({
      name: "probe/timed",
      description: "Sets timers.",
      fields: {},
      create: (self) => ({
        start() {
          self.after(2, () => fired.push(`after:${self.entity.id}`));
          self.every(1, { emit: "tock" }, 3);
          self.run(function* () {
            yield 3;
            fired.push(`co:${self.entity.id}`);
          });
        },
      }),
    });
    const rt = world(
      [
        { id: "a", type: "node", at: [1, 2], behaviors: { "probe/timed": {} } },
        { id: "b", type: "node", at: [0, 0], behaviors: { "probe/timed": {} } },
      ],
      [timed],
    );
    const tocks: StepEvent[] = [];
    rt.ctx.events.on("tock", (e) => tocks.push(e));
    rt.ctx.destroy("b");
    for (let i = 0; i < 5; i++) rt.step(DT, []);
    expect(fired).toEqual(["after:a", "co:a"]);
    expect(tocks.map((e) => [e.entityId, e.at])).toEqual([
      ["a", { x: 1, y: 2 }],
      ["a", { x: 1, y: 2 }],
      ["a", { x: 1, y: 2 }],
    ]);
    expect(rt.ctx.timers.size).toBe(0);
    rt.destroy();
  });

  it("stops a replaced instance's function timers", () => {
    const fired: number[] = [];
    const timed = defineScript({
      name: "probe/timed",
      description: "Sets a timer.",
      fields: { n: z.number().default(0) },
      create: (self) => ({
        awake: () => void self.after(2, () => fired.push(self.fields.n)),
      }),
    });
    const rt = world(
      [{ id: "a", type: "node", at: [0, 0], behaviors: { "probe/timed": { n: 1 } } }],
      [timed],
    );
    rt.update([{ id: "a", type: "node", at: [0, 0], behaviors: { "probe/timed": { n: 2 } } }]);
    for (let i = 0; i < 4; i++) rt.step(DT, []);
    expect(fired).toEqual([2]);
    rt.destroy();
  });

  it("emits a step event about its entity", () => {
    const loud = defineScript({
      name: "probe/loud",
      description: "Shouts.",
      fields: {},
      create: (self) => ({ step: () => self.emit("shout", { n: 1 }) }),
    });
    const rt = world(
      [{ id: "a", type: "node", at: [3, 4], behaviors: { "probe/loud": {} } }],
      [loud],
    );
    const result = rt.step(DT, []);
    expect(result.events.filter((e) => e.type === "shout")).toEqual([
      { type: "shout", tick: 0, entityId: "a", at: { x: 3, y: 4 }, data: { n: 1 } },
    ]);
    rt.destroy();
  });
});

describe("visualOnly scripts", () => {
  it("refuses render on a script that isn't visualOnly when the registry is built", () => {
    class Drawer extends Script({ name: "probe/drawer", description: "Draws.", fields: {} }) {
      render(): void {}
    }
    expect(scriptProblem(Drawer.behavior)).toMatch(/defines render but isn't visualOnly/);
    expect(() => createRegistry(probeGame([Drawer]))).toThrow(
      /defines render but isn't visualOnly/,
    );
  });

  it("refuses a tick hook on a visualOnly script", () => {
    class Busy extends Script({
      name: "probe/busy",
      description: "Draws and steps.",
      fields: {},
      visualOnly: true,
    }) {
      render(): void {}
      step(): void {}
    }
    expect(scriptProblem(Busy.behavior)).toMatch(
      /visualOnly, so it gets render and no tick hooks: it defines step/,
    );
  });

  it("refuses a function script's render at attach, since its hooks exist only then", () => {
    const drawer = defineScript({
      name: "probe/drawer",
      description: "Draws.",
      fields: {},
      create: () => ({ render() {} }),
    });
    expect(scriptProblem(drawer)).toBeUndefined();
    expect(() =>
      world([{ id: "a", type: "node", at: [0, 0], behaviors: { "probe/drawer": {} } }], [drawer]),
    ).toThrow(/defines render but isn't visualOnly/);
  });

  it("isn't built headless, and draws with render alone under a view", () => {
    const frames: number[] = [];
    class Glow extends Script({
      name: "probe/glow",
      description: "Draws.",
      fields: {},
      visualOnly: true,
    }) {
      render(alpha: number): void {
        frames.push(alpha);
      }
    }
    const rt = world(
      [{ id: "a", type: "node", at: [0, 0], behaviors: { "probe/glow": {} } }],
      [Glow],
    );
    expect(rt.ctx.behavior("probe/glow")).toBeUndefined();
    expect(rt.ctx.entity("a")!.getBehavior(Glow)).toBeUndefined();
    rt.destroy();

    const system = Glow.behavior.system!(
      { tick: 0, contacts: { watch: () => () => {} } } as never,
      { ...Glow.behavior, origin: "probe", shape: {}, index: 0 },
    );
    system.attach("a", {}, { id: "a", type: "node" });
    expect(tickHooksOn(system)).toEqual(["render"]);
    system.render!(0.5);
    expect(frames).toEqual([0.5]);
  });
});

describe("registering a script class", () => {
  it("passes straight to defineGame's behaviors, beside a function script", () => {
    class Thruster extends Script({
      name: "probe/thruster",
      description: "Pushes.",
      fields: { force: z.number().default(2) },
    }) {
      force(): number {
        return this.fields.force;
      }
    }
    const registry = createRegistry(probeGame([Thruster]));
    expect(registry.behaviors.get("probe/thruster")?.description).toBe("Pushes.");
    const rt = world(
      [{ id: "ship", type: "node", at: [0, 0], behaviors: { "probe/thruster": { force: 5 } } }],
      [Thruster],
    );
    expect(rt.ctx.entity("ship")!.getBehavior(Thruster)!.force()).toBe(5);
    expect(rt.ctx.findBehaviors(Thruster).map((t) => t.entity.id)).toEqual(["ship"]);
    rt.destroy();
  });
});

describe("contact and sensor hooks", () => {
  const box = (cx: number, cy: number) => ["box", cx, cy, 0.25, 0.25];

  function testWorld(behaviors: GameDefinition["behaviors"], entities: EntityDef[]) {
    const game = defineGame({
      ...testGame,
      behaviors: [...(testGame.behaviors ?? []), ...(behaviors ?? [])],
    });
    const rt = createSceneRuntime({ rapier: null, view: null, game });
    const report = rt.load(
      expandScene(
        {
          v: SCENE_FORMAT_VERSION,
          game: "test-game",
          name: "touch",
          bounds: [-10, -10, 10, 10],
          settings: { physics: "none", gravity: [0, 0] },
          entities,
        },
        createRegistry(game),
      ),
    );
    if (!report.ok) throw new Error(report.error);
    return rt;
  }

  it("watches contacts only for a script with a contact hook, and hands it the other entity", () => {
    const log: string[] = [];
    const awake = vi.fn();
    class Bumper extends Script({ name: "test-game/bumper", description: "Bumps.", fields: {} }) {
      onContactStart(other: Entity, e: StepEvent): void {
        log.push(`start:${this.entity.id}>${other.id}:${e.type}`);
      }
      onContactEnd(other: Entity): void {
        log.push(`end:${this.entity.id}>${other.id}`);
      }
    }
    const quiet = defineScript({
      name: "test-game/quiet",
      description: "No contact hooks.",
      fields: {},
      create: () => ({ awake }),
    });
    const rt = testWorld([Bumper, quiet], [
      {
        id: "ball",
        type: "marker",
        at: [0, 0],
        behaviors: { collider: { shape: box(0, 0) }, "test-game/bumper": {} },
      },
      {
        id: "calm",
        type: "marker",
        at: [0, 3],
        behaviors: { collider: { shape: box(0, 3) }, "test-game/quiet": {} },
      },
      { id: "wall", type: "solid", shape: box(0.3, 0) },
      { id: "rock", type: "solid", shape: box(0.2, 3) },
    ] as EntityDef[]);
    const contacts: StepEvent[] = [];
    rt.ctx.events.on(CONTACT_START, (e) => contacts.push(e));
    rt.step(DT, []);
    expect(awake).toHaveBeenCalledTimes(1);
    expect(log).toEqual(["start:ball>wall:contact:start"]);
    expect(contacts.map((e) => e.entityId)).toEqual(["ball"]);
    rt.ctx.setPose("ball", 5, 5);
    rt.step(DT, []);
    expect(log).toEqual(["start:ball>wall:contact:start", "end:ball>wall"]);
    rt.destroy();
  });

  it("calls the sensor hooks on both sides, with other the side that isn't this entity", () => {
    const log: string[] = [];
    const sensing = defineScript({
      name: "test-game/sensing",
      description: "Feels sensors.",
      fields: {},
      create: (self) => ({
        onSensorEnter: (other: Entity) => log.push(`enter:${self.entity.id}>${other.id}`),
        onSensorExit: (other: Entity) => log.push(`exit:${self.entity.id}>${other.id}`),
      }),
    });
    const rt = testWorld([sensing], [
      { id: "zone", type: "sensor", shape: box(0, 0), behaviors: { "test-game/sensing": {} } },
      {
        id: "hero",
        type: "marker",
        at: [0, 0],
        behaviors: { collider: { shape: box(0, 0), group: "dynamic" }, "test-game/sensing": {} },
      },
    ] as EntityDef[]);
    const raised: StepEvent[] = [];
    rt.ctx.events.on(SENSOR_ENTER, (e) => raised.push(e));
    rt.step(DT, []);
    expect(raised.map((e) => [e.entityId, e.other])).toEqual([["zone", "hero"]]);
    expect(log).toEqual(["enter:zone>hero", "enter:hero>zone"]);
    rt.ctx.setPose("hero", 5, 5);
    rt.step(DT, []);
    expect(log.slice(2)).toEqual(["exit:zone>hero", "exit:hero>zone"]);
    rt.destroy();
  });
});
