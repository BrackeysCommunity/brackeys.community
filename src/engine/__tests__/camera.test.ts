import type { Container } from "pixi.js";
import { describe, expect, it } from "vite-plus/test";

import { CAMERA_SCENE_MARGIN, createCamera } from "../camera";
import type { CameraConfig, Vec2 } from "../types";

function fakeContainer() {
  const transform = { x: 0, y: 0, scale: 1 };
  const container = {
    position: { set: (x: number, y: number) => Object.assign(transform, { x, y }) },
    scale: { set: (s: number) => Object.assign(transform, { scale: s }) },
  } as unknown as Container;
  return { container, transform };
}

const WIDE: CameraConfig = {
  lerpSpeed: 0.5,
  bounds: { min: { x: -10_000, y: -10_000 }, max: { x: 10_000, y: 10_000 } },
};

function setup(displayWidth = 1920, displayHeight = 1080, config = WIDE) {
  const { container, transform } = fakeContainer();
  const camera = createCamera(container, displayWidth, displayHeight, config);
  /** Where the rendered container puts world point `w` on the canvas. */
  const toScreen = (w: Vec2): Vec2 => ({
    x: w.x * transform.scale + transform.x,
    y: w.y * transform.scale + transform.y,
  });
  return { camera, transform, toScreen };
}

describe("screenToWorld", () => {
  it("honours zoom 2 and the camera's offset", () => {
    const { camera } = setup();
    camera.setZoom(2);
    camera.snapTo({ x: 500, y: 300 });

    // A 1920x1080 view at zoom 2 shows 960x540 world units around (500, 300).
    expect(camera.screenToWorld({ x: 0, y: 0 })).toEqual({ x: 20, y: 30 });
    expect(camera.screenToWorld({ x: 100, y: 50 })).toEqual({ x: 70, y: 55 });
    expect(camera.screenToWorld({ x: 960, y: 540 })).toEqual({ x: 500, y: 300 });
  });

  it("inverts the transform it applies to the world container", () => {
    const { camera, toScreen } = setup(1280, 720);
    camera.setZoom(2);
    camera.snapTo({ x: -340, y: 125 });

    for (const w of [
      { x: -340, y: 125 },
      { x: -500, y: 0 },
      { x: 12.5, y: 300 },
    ]) {
      const back = camera.screenToWorld(toScreen(w));
      expect(back.x).toBeCloseTo(w.x, 9);
      expect(back.y).toBeCloseTo(w.y, 9);
    }
  });
});

describe("snapTo, setPosition and free mode", () => {
  it("snapTo moves the view now, without easing", () => {
    const { camera, transform } = setup();
    camera.snapTo({ x: 400, y: 200 });

    expect(camera.getPosition()).toEqual({ x: 400, y: 200 });
    expect(transform).toEqual({ x: 960 - 400, y: 540 - 200, scale: 1 });
  });

  it("snapTo(null) centers on the bounds", () => {
    const { camera } = setup();
    camera.setBoundsFromScene([0, 0, 4000, 2000]);
    camera.snapTo(null);
    expect(camera.getPosition()).toEqual({ x: 2000, y: 1000 });
  });

  it("setPosition moves the camera and the view catches up on the next update", () => {
    const { camera, transform } = setup();
    camera.snapTo({ x: 0, y: 0 });
    camera.setPosition({ x: 300, y: 100 });

    expect(camera.getPosition()).toEqual({ x: 300, y: 100 });
    expect(transform.x).toBe(960);

    camera.update(16, null);
    expect(transform).toEqual({ x: 960 - 300, y: 540 - 100, scale: 1 });
  });

  it("follow mode eases toward the target; free mode ignores it", () => {
    const { camera } = setup();
    camera.snapTo({ x: 0, y: 0 });

    camera.update(16, { x: 100, y: 0 });
    expect(camera.getPosition()).toEqual({ x: 50, y: 0 });

    camera.setMode("free");
    camera.update(16, { x: 100, y: 0 });
    expect(camera.getPosition()).toEqual({ x: 50, y: 0 });
    camera.setPosition({ x: -200, y: 40 });
    camera.update(16, { x: 100, y: 0 });
    expect(camera.getPosition()).toEqual({ x: -200, y: 40 });
    expect(camera.getState().mode).toBe("free");

    camera.setMode("follow");
    camera.update(16, { x: 100, y: 0 });
    expect(camera.getPosition()).toEqual({ x: -50, y: 20 });
  });
});

describe("bounds from the scene", () => {
  it("adds the default margin on every side", () => {
    const { camera } = setup();
    camera.setBoundsFromScene([0, 0, 2000, 1000]);
    const m = CAMERA_SCENE_MARGIN;
    expect(camera.getState().bounds).toEqual({
      min: { x: -m, y: -m },
      max: { x: 2000 + m, y: 1000 + m },
    });
  });

  it("takes an explicit margin and clamps the camera inside the result", () => {
    const { camera } = setup();
    camera.setBoundsFromScene([0, 0, 4000, 2000], 50);

    camera.snapTo({ x: -5000, y: 99_999 });
    // Half the 1920x1080 view in from each clamped edge.
    expect(camera.getPosition()).toEqual({ x: -50 + 960, y: 2050 - 540 });

    camera.setPosition({ x: 99_999, y: -99_999 });
    expect(camera.getPosition()).toEqual({ x: 4050 - 960, y: -50 + 540 });
  });

  it("centers an axis the view is wider than", () => {
    const { camera } = setup();
    camera.setBoundsFromScene([0, 0, 1000, 500], 0);
    camera.snapTo({ x: 0, y: 0 });
    expect(camera.getPosition()).toEqual({ x: 500, y: 250 });
  });
});
