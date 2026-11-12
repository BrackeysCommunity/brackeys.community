// @vitest-environment node
import { describe, expect, it, vi } from "vite-plus/test";

import type { ExpandedScene, RuntimeEntity } from "../../scene/types";
import { applyEntityDiff, type BindableRuntime } from "../bind";

const entity = (id: string, x = 0): RuntimeEntity => ({ id, type: "marker", at: [x, 0] });

function spyRuntime(ok = { add: true, update: true }) {
  return {
    load: vi.fn((_s: ExpandedScene) => ({ ok: true })),
    add: vi.fn((_e: RuntimeEntity[]) => ({ ok: ok.add })),
    update: vi.fn((_e: RuntimeEntity[]) => ({ ok: ok.update })),
    remove: vi.fn((_ids: string[]) => {}),
  } satisfies BindableRuntime;
}

describe("applyEntityDiff", () => {
  it("removes, adds and updates only what differs", () => {
    const rt = spyRuntime();
    const ok = applyEntityDiff(
      rt,
      [entity("a"), entity("b"), entity("c")],
      [entity("a"), entity("b", 5), entity("d")],
    );
    expect(ok).toBe(true);
    expect(rt.remove).toHaveBeenCalledWith(["c"]);
    expect(rt.add).toHaveBeenCalledWith([entity("d")]);
    expect(rt.update).toHaveBeenCalledWith([entity("b", 5)]);
    expect(rt.load).not.toHaveBeenCalled();
  });

  it("calls nothing when the entities are equal, field order aside", () => {
    const rt = spyRuntime();
    const reordered = { at: [0, 0], type: "marker", id: "a" } as RuntimeEntity;
    expect(applyEntityDiff(rt, [entity("a")], [reordered])).toBe(true);
    expect(rt.remove).not.toHaveBeenCalled();
    expect(rt.add).not.toHaveBeenCalled();
    expect(rt.update).not.toHaveBeenCalled();
  });

  it("is false when an add or an update fails", () => {
    expect(applyEntityDiff(spyRuntime({ add: false, update: true }), [], [entity("a")])).toBe(
      false,
    );
    expect(
      applyEntityDiff(spyRuntime({ add: true, update: false }), [entity("a")], [entity("a", 1)]),
    ).toBe(false);
  });
});
