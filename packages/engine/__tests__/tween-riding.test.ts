import { beforeAll, describe, expect, it } from "vite-plus/test";

import { ridingHost } from "../game/behaviors/tween";
import { createRegistry } from "../game/index";
import { createSceneRuntime } from "../runtime/runtime";
import type { RapierModule } from "../types";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const box = { type: "box", cx: 1, cy: -1, hw: 1, hh: 0.2, rotDeg: 0 } as const;

describe("a tween on an entity riding a host", () => {
  it("rides whatever its attach field names, live or not", () => {
    const solid = createRegistry().types.get("solid");
    expect(ridingHost(solid, { attach: "ghost" })).toBe("ghost");
    expect(ridingHost(solid, {})).toBeUndefined();
    expect(ridingHost(undefined, { attach: "ghost" })).toBeUndefined();
  });

  it("is refused at load when its attach names no live host, as the validator refuses it", () => {
    const rt = createSceneRuntime({ rapier, view: null });
    const report = rt.load({
      name: "riding",
      bounds: [-50, -50, 50, 50],
      settings: {
        gravity: [0, 0],
        physics: "rapier",
        grid: null,
        view: { projection: "orthogonal" },
      },
      entities: [
        {
          id: "plank",
          type: "solid",
          attach: "ghost",
          shape: box,
          behaviors: { tween: { tweens: [{ to: { y: 3 }, duration: 5 }] } },
        },
      ],
    });
    expect(report).toMatchObject({
      ok: false,
      entityId: "plank",
      error: `plank's tween 1 can't play: it is a solid riding "ghost", which can't be posed, so a tween can't move its y`,
    });
    rt.destroy();
  });
});
