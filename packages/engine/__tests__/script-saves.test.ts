// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createRegistry, defineGame } from "../game/define";
import { defineScript, Script } from "../game/script";
import type { GameDefinition, JsonValue } from "../game/types";
import { createSceneRuntime } from "../runtime/runtime";
import { captureSave, restoreSave } from "../runtime/save-state";
import type { SceneRuntimeHandle, StepEvent } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";

const DT = 1000 / 60;

/** Counts by `by` each tick and says so every fifth; keeps its count across an edit and in saves. */
class Counter extends Script({
  name: "keep/counter",
  description: "Counts.",
  fields: { by: z.number().default(1) },
}) {
  n = 0;
  retuned: [number, number] | null = null;
  step(): void {
    this.n += this.fields.by;
    if (this.n % 5 === 0) this.emit("five", { n: this.n });
  }
  onFieldsChanged(prev: Readonly<{ by: number }>): void {
    this.retuned = [prev.by, this.fields.by];
  }
  save(): JsonValue {
    return { n: this.n };
  }
  restore(state: JsonValue): void {
    this.n = (state as { n: number }).n;
  }
}

/** The function form: its count lives in the closure, so it saves it itself; an edit rebuilds it. */
const tally = defineScript({
  name: "keep/tally",
  description: "Tallies.",
  fields: { by: z.number().default(1) },
  create(self) {
    let count = 0;
    return {
      step() {
        count += self.fields.by;
      },
      count: () => count,
      save: (): JsonValue => count,
      restore(state: JsonValue) {
        count = state as number;
      },
    };
  },
});

/** Instance properties and no save. */
class Leaky extends Script({ name: "keep/leaky", description: "Forgets.", fields: {} }) {
  hp = 3;
}

/** No instance properties: nothing to warn about. */
class Plain extends Script({ name: "keep/plain", description: "Holds nothing.", fields: {} }) {
  step(): void {}
}

/** Rings after 10 ticks: a function timer, or the emit form. */
const bell = defineScript({
  name: "keep/bell",
  description: "Rings.",
  fields: { fn: z.boolean().default(false) },
  create: (self) => ({
    start() {
      if (self.fields.fn) self.after(10, () => self.emit("rang"));
      else self.after(10, { emit: "rang" });
    },
  }),
});

const game: GameDefinition = defineGame({
  id: "keep",
  types: [],
  actions: [],
  behaviors: [Counter, tally, Leaky, Plain, bell],
  createRuntime: () => ({ snapshot: () => null, restore() {} }),
});
const registry = createRegistry(game);

function scene(entities: EntityDef[]): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    name: "keep",
    game: "keep",
    bounds: [0, 0, 8, 8],
    settings: { physics: "none", gravity: [0, 0] },
    entities,
  };
}

const node = (id: string, behaviors: Record<string, Record<string, unknown>>): EntityDef =>
  ({ id, type: "node", at: [1, 1], behaviors }) as EntityDef;

function runtime(def: SceneDefinition, dev = false): SceneRuntimeHandle {
  const rt = createSceneRuntime({ rapier: null, view: null, game, dev });
  const report = rt.load(expandScene(def, registry));
  if (!report.ok) throw new Error(report.error);
  return rt;
}

/** Steps `ticks` times; the script events each tick raised. */
function run(rt: SceneRuntimeHandle, ticks: number): StepEvent[] {
  const out: StepEvent[] = [];
  for (let i = 0; i < ticks; i++)
    out.push(...rt.step(DT, []).events.filter((e) => !e.type.includes(":")));
  return out;
}

const save = (rt: SceneRuntimeHandle) => captureSave(rt, { depth: "world", slot: "s", now: 0 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a script's world save", () => {
  const counting = scene([
    node("a", { "keep/counter": { by: 1 }, "keep/tally": { by: 2 } }),
    node("b", { "keep/counter": { by: 3 } }),
  ]);

  it("keeps what save() returns, in both forms, and the run goes on exactly", () => {
    const first = runtime(counting);
    run(first, 23);
    const saved = save(first);
    if (!saved.ok) throw new Error(saved.issue.message);
    const after = run(first, 30);
    const counts = (rt: SceneRuntimeHandle) => [
      rt.ctx.entity("a")!.getBehavior(Counter)!.n,
      rt.ctx.entity("b")!.getBehavior(Counter)!.n,
      rt.ctx.entity("a")!.getBehavior(tally)!.count(),
    ];
    const expected = counts(first);
    expect(expected).toEqual([53, 159, 106]);

    const second = runtime(counting);
    const restored = restoreSave(second, saved.file);
    if (!restored.ok) throw new Error(restored.issue.message);
    expect(counts(second)).toEqual([23, 69, 46]);
    expect(run(second, 30)).toEqual(after);
    expect(counts(second)).toEqual(expected);
    first.destroy();
    second.destroy();
  });

  it("warns once in dev for a class with instance properties and no save", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const def = scene([
      node("a", { "keep/leaky": {}, "keep/plain": {} }),
      node("b", { "keep/leaky": {}, "keep/tally": {} }),
    ]);
    const rt = runtime(def, true);
    expect(save(rt).ok).toBe(true);
    expect(save(rt).ok).toBe(true);
    const said = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith("[script]"));
    expect(said).toEqual([
      '[script] "keep/leaky" has instance properties (hp) and no save(): a world save keeps none of them, and a restore starts them over',
    ]);
    rt.destroy();

    warn.mockClear();
    const quiet = runtime(def, false);
    save(quiet);
    expect(warn).not.toHaveBeenCalled();
    quiet.destroy();
  });

  it("is refused while a function timer is pending, and holds an emit-form one", () => {
    const fn = runtime(scene([node("a", { "keep/bell": { fn: true } })]));
    const refused = save(fn);
    expect(refused.ok ? null : refused.issue.code).toBe("save-unsupported");
    expect(refused.ok ? "" : refused.issue.message).toContain(
      'a function timer (id 1) owned by "a"',
    );
    expect(run(fn, 11).map((e) => [e.type, e.tick, e.entityId])).toEqual([["rang", 10, "a"]]);
    expect(save(fn).ok).toBe(true);
    fn.destroy();

    const emit = scene([node("a", { "keep/bell": {} })]);
    const first = runtime(emit);
    run(first, 4);
    const saved = save(first);
    if (!saved.ok) throw new Error(saved.issue.message);
    const rang = run(first, 10);
    expect(rang.map((e) => [e.type, e.tick, e.entityId])).toEqual([["rang", 10, "a"]]);

    const second = runtime(emit);
    const restored = restoreSave(second, saved.file);
    if (!restored.ok) throw new Error(restored.issue.message);
    expect(run(second, 10)).toEqual(rang);
    first.destroy();
    second.destroy();
  });
});

describe("a live swap that changes a script's field", () => {
  it("retunes a class with onFieldsChanged and rebuilds a function script without it", () => {
    const before = scene([node("a", { "keep/counter": { by: 1 }, "keep/tally": { by: 1 } })]);
    const rt = runtime(before);
    run(rt, 4);
    const counter = rt.ctx.entity("a")!.getBehavior(Counter)!;
    const tallySystem = rt.ctx.behavior("keep/tally")!;
    const old = rt.ctx.entity("a")!.getBehavior(tally);
    expect(counter.n).toBe(4);

    const report = rt.swap(
      expandScene(
        scene([node("a", { "keep/counter": { by: 10 }, "keep/tally": { by: 5 } })]),
        registry,
      ),
      { prefabs: new Map() },
    );
    if (!report.ok) throw new Error(report.issue.message);
    expect(report.strategy).toBe("reconcile");
    expect(counter.retuned).toEqual([1, 10]);
    run(rt, 2);
    expect(rt.ctx.entity("a")!.getBehavior(Counter)).toBe(counter);
    expect(counter.n).toBe(24);
    const rebuilt = tallySystem.handle!("a") as { count(): number };
    expect(rebuilt).not.toBe(old);
    expect(rt.ctx.entity("a")!.getBehavior(tally)).toBe(rebuilt);
    expect(rebuilt.count(), "the swap carries the count through save and restore").toBe(4 + 2 * 5);
    rt.destroy();
  });
});
