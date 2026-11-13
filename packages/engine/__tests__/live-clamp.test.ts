// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineGame } from "../game/define";
import { clampTiming, type LiveDeclaration, type SwapTiming } from "../game/live";
import { createLiveLayer } from "../runtime/live";
import { ISSUE_CODES } from "../scene/issues";
import type { SceneDefinition } from "../scene/types";
import { preparedOf } from "./fixtures/live-version";

const SHA = "c".repeat(64);
const TIMINGS: readonly SwapTiming[] = ["next-load", "boundary", "now"];

const DEF: SceneDefinition = {
  v: 4,
  name: "level-1",
  bounds: [0, 0, 10, 10],
  settings: { physics: "none" },
  entities: [{ id: "start", type: "marker", at: [1, 1] }],
};

/** Every declaration a game can make, as the timings it lists (undefined: no `live` at all). */
const DECLARED: readonly (readonly SwapTiming[] | undefined)[] = [
  undefined,
  [],
  ["next-load"],
  ["boundary"],
  ["now"],
  ["boundary", "now"],
  ["next-load", "boundary", "now"],
];

/** The strongest timing the game accepts that is no stronger than `wanted`. */
function expected(listed: readonly SwapTiming[] | undefined, wanted: SwapTiming): SwapTiming {
  const order = TIMINGS.slice(0, TIMINGS.indexOf(wanted) + 1).reverse();
  return order.find((t) => t === "next-load" || (listed?.includes(t) ?? false))!;
}

function layerFor(listed: readonly SwapTiming[] | undefined) {
  const live: LiveDeclaration | undefined = listed ? { timings: listed } : undefined;
  const game = defineGame({
    id: "clamp-yard",
    world: { physics: "none" },
    actions: [],
    types: [],
    ...(live ? { live } : {}),
    createRuntime: () => ({ snapshot: () => null }),
  });
  const registry = createRegistry(game);
  const layer = createLiveLayer({ game, runtime: () => null });
  const prepared = preparedOf(SHA, DEF, registry, "level-1");
  return { live, layer, prepared };
}

describe("activate's timing clamp", () => {
  for (const listed of DECLARED) {
    for (const wanted of TIMINGS) {
      const name = listed ? `[${listed.join(", ")}]` : "no live";
      it(`${name} asked for ${wanted}`, () => {
        const { live, layer, prepared } = layerFor(listed);
        layer.stage(prepared);
        const got = layer.activate("level-1", SHA, wanted);
        const timing = expected(listed, wanted);
        expect(got.timing).toBe(timing);
        expect(got.clamped).toBe(timing !== wanted);
        expect({ timing: got.timing, clamped: got.clamped }).toEqual(clampTiming(live, wanted));
        expect(layer.current("level-1")).toBe(SHA);
        if (timing === wanted) {
          expect(got.issue).toBeUndefined();
          return;
        }
        expect(got.issue).toMatchObject({
          code: "live-timing-unsupported",
          severity: "warn",
          hint: ISSUE_CODES["live-timing-unsupported"].hint,
        });
        const accepted = ["next load", ...(listed ?? []).filter((t) => t !== "next-load")];
        expect(got.issue!.message).toBe(
          `This game accepts only ${accepted.join(" or ")}; level-1@${SHA.slice(0, 12)} will reach players then.`,
        );
      });
    }
  }

  it("clamps a move back to the release's own scene and while pinned, and the pin keeps the version", () => {
    const { layer, prepared } = layerFor(undefined);
    layer.stage(prepared);
    expect(layer.activate("level-1", null, "now")).toMatchObject({
      timing: "next-load",
      clamped: true,
      issue: { code: "live-timing-unsupported" },
    });
    layer.pin({});
    expect(layer.activate("level-1", SHA, "boundary")).toMatchObject({
      timing: "next-load",
      clamped: true,
      issue: { code: "live-timing-unsupported" },
    });
    expect(layer.current("level-1")).toBeNull();
    layer.unpin();
    expect(layer.activate("level-1", SHA, "next-load")).toEqual({
      timing: "next-load",
      clamped: false,
    });
    expect(layer.current("level-1")).toBe(SHA);
  });
});
