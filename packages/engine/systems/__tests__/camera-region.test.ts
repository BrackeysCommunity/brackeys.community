import { describe, expect, it, vi } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { CAMERA_REGION_TYPE } from "../../game/primitives";
import type { EngineContext } from "../../game/types";
import type { ShapeObj } from "../../scene/types";
import { createCameraRegionSystem, type CameraRegionEntity } from "../camera-region";

const drawn = (shape: ShapeObj) => {
  const registry = createRegistry();
  const draw = vi.fn();
  const view = { draw, depth: vi.fn(), remove: vi.fn() };
  const ctx = { registry, view } as unknown as EngineContext;
  const system = createCameraRegionSystem(ctx, registry.types.get(CAMERA_REGION_TYPE)!);
  system.spawn({ id: "room", type: CAMERA_REGION_TYPE, shape } as CameraRegionEntity);
  expect(draw).toHaveBeenCalledOnce();
  return draw.mock.calls[0]![1] as ShapeObj;
};

describe("createCameraRegionSystem", () => {
  it("draws an unturned region as it is", () => {
    const box: ShapeObj = { type: "box", cx: 4, cy: 2, hw: 3, hh: 1, rotDeg: 0 };
    expect(drawn(box)).toBe(box);
  });

  it("draws a turned region as the axis-aligned box the rig frames", () => {
    const shape = drawn({ type: "box", cx: 4, cy: 2, hw: 3, hh: 1, rotDeg: 90 });
    expect(shape).toMatchObject({ type: "box", cx: 4, cy: 2, rotDeg: 0 });
    const box = shape as Extract<ShapeObj, { type: "box" }>;
    expect(box.hw).toBeCloseTo(1, 9);
    expect(box.hh).toBeCloseTo(3, 9);
  });
});
