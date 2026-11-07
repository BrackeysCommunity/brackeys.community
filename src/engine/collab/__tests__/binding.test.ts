import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { createSceneRuntime } from "../../runtime/runtime";
import { engine, engineYard } from "../../scene/__tests__/fixtures/random-ops";
import { expandScene } from "../../scene/expand";
import type { ExpandedScene, RuntimeEntity } from "../../scene/types";
import type { RapierModule } from "../../types";
import { bindSceneDoc, expandLenient, type BindableRuntime } from "../bind";
import { docToScene } from "../convert";
import { ada, apply, bo, link, pair } from "./helpers";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

function spyRuntime() {
  const rt = {
    load: vi.fn((_s: ExpandedScene) => ({ ok: true })),
    add: vi.fn((_e: RuntimeEntity[]) => ({ ok: true })),
    update: vi.fn((_e: RuntimeEntity[]) => ({ ok: true })),
    remove: vi.fn((_ids: string[]) => {}),
  } satisfies BindableRuntime;
  return rt;
}

describe("bindSceneDoc", () => {
  it("applies a remote transaction to the edit world once", () => {
    const [a, b] = pair(engineYard());
    const unlink = link(a, b);
    const rt = spyRuntime();
    const binding = bindSceneDoc(a, rt, engine);
    expect(rt.load).toHaveBeenCalledTimes(1);

    apply(
      b,
      {
        ops: [
          { op: "move", refs: ["crate", "avatar", "~solid:0"], by: [5, 0] },
          { op: "update", ref: "lift", set: { "path.speed": 10 } },
        ],
      },
      bo,
      engine,
    );
    expect(rt.update).toHaveBeenCalledTimes(1);
    expect(rt.update.mock.calls[0]![0].map((e) => e.id).sort()).toEqual(
      ["avatar", "crate", "lift", "~solid:0"].sort(),
    );
    expect(rt.add).not.toHaveBeenCalled();
    expect(rt.remove).not.toHaveBeenCalled();
    expect(rt.load).toHaveBeenCalledTimes(1);

    apply(
      b,
      {
        ops: [
          { op: "remove", refs: ["zone"] },
          { op: "add", entity: { id: "m", type: "marker", at: [1, 1] } },
        ],
      },
      bo,
      engine,
    );
    expect(rt.remove).toHaveBeenCalledTimes(1);
    expect(rt.remove).toHaveBeenCalledWith(["zone"]);
    expect(rt.add).toHaveBeenCalledTimes(1);
    expect(rt.update).toHaveBeenCalledTimes(1);

    apply(b, { ops: [{ op: "setSettings", set: { gravity: [0, 10] } }] }, bo, engine);
    expect(rt.load).toHaveBeenCalledTimes(2);
    binding.destroy();
    unlink();
  });

  it("ignores transactions that touch only the log or presence-free maps", () => {
    const [a] = pair(engineYard());
    const rt = spyRuntime();
    bindSceneDoc(a, rt, engine);
    a.transact(() => a.getArray("log").push([{ note: 1 }]));
    expect(rt.update).not.toHaveBeenCalled();
    expect(rt.load).toHaveBeenCalledTimes(1);
  });

  it("leaves a paused world alone, still reports changes, and reloads on resume", () => {
    const [a, b] = pair(engineYard());
    const unlink = link(a, b);
    const rt = spyRuntime();
    const onChange = vi.fn();
    const binding = bindSceneDoc(a, rt, engine, { onChange });
    binding.setPaused(true);
    apply(b, { ops: [{ op: "move", refs: ["crate"], by: [5, 0] }] }, bo, engine);
    expect(rt.update).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
    binding.setPaused(false);
    expect(rt.load).toHaveBeenCalledTimes(2);
    expect(rt.load.mock.calls[1]![0].entities.find((e) => e.id === "crate")).toMatchObject({
      shape: { type: "circle", cx: 1205 },
    });
    unlink();
  });

  it("keeps a real runtime equal to a fresh load of the doc", () => {
    const [a, b] = pair(engineYard());
    const unlink = link(a, b);
    const live = createSceneRuntime({ rapier, view: null, registry: engine });
    bindSceneDoc(a, live, engine);
    apply(b, { ops: [{ op: "move", refs: ["crate", "~solid:1"], by: [5, -3] }] }, bo, engine);
    apply(
      a,
      {
        ops: [
          { op: "remove", refs: ["~solid:0"] },
          { op: "add", entity: { id: "box", type: "solid", shape: ["box", 50, 50, 10, 10] } },
        ],
      },
      ada,
      engine,
    );
    apply(b, { ops: [{ op: "update", ref: "zone", set: { tags: ["exit"] } }] }, bo, engine);

    const fresh = createSceneRuntime({ rapier, view: null, registry: engine });
    const expanded = expandScene(docToScene(a), engine);
    fresh.load(expanded);
    expect(live.stats()).toEqual(fresh.stats());
    for (const e of expanded.entities) expect(live.get(e.id)).toEqual(fresh.get(e.id));
    live.destroy();
    fresh.destroy();
    unlink();
  });

  it("expands a merged scene with a broken entry and a duplicate id, leaving those out", () => {
    const def = engineYard();
    def.entities!.push({ id: "crate", type: "prop", shape: ["circle", 5, 5, 5] });
    (def.solid as unknown[]).push(["box", 1, 1]);
    const { scene, errors } = expandLenient(def, engine);
    expect(errors.length).toBe(2);
    expect(scene.entities.filter((e) => e.id === "crate")).toHaveLength(1);
    expect(scene.entities.some((e) => e.id === "~solid:3")).toBe(false);
    expect(scene.entities.some((e) => e.id === "~solid:2")).toBe(true);
  });
});
