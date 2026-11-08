import type { Container } from "pixi.js";
import { describe, expect, it } from "vite-plus/test";

import { CAMERA_SCENE_MARGIN, createCamera } from "../camera";
import { DEFAULT_RESOLUTION, type ResolutionPolicy } from "../resolution";
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

function setup(
  displayWidth = 1920,
  displayHeight = 1080,
  config = WIDE,
  resolution?: ResolutionPolicy,
) {
  const { container, transform } = fakeContainer();
  const camera = createCamera(container, displayWidth, displayHeight, config, resolution);
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

describe("resolution policies", () => {
  const LETTERBOX: ResolutionPolicy = {
    ...DEFAULT_RESOLUTION,
    virtual: { width: 640, height: 360 },
    fit: "letterbox",
  };

  it("matches the policy-free camera with the default", () => {
    const a = setup(1366, 768);
    const b = setup(1366, 768, WIDE, DEFAULT_RESOLUTION);
    for (const { camera } of [a, b]) {
      camera.setZoom(1.5);
      camera.snapTo({ x: 123.4, y: -56.7 });
    }
    expect(b.transform).toEqual(a.transform);
    expect(b.camera.getState()).toEqual(a.camera.getState());
    expect(b.camera.screenToWorld({ x: 17, y: 400 })).toEqual(
      a.camera.screenToWorld({ x: 17, y: 400 }),
    );
    // 768 / 1080 canvas px per world unit, times the zoom.
    expect(a.camera.getState().scale).toBe((768 / 1080) * 1.5);
  });

  it("letterboxes: the virtual area fills the middle, the camera at its centre", () => {
    const { camera, transform, toScreen } = setup(2560, 1080, WIDE, LETTERBOX);
    camera.snapTo({ x: 1000, y: 500 });
    expect(camera.getDisplayScale()).toBe(3);
    expect(camera.getState().scale).toBe(3);
    expect(camera.getViewport()).toEqual({ x: 680, y: 320, width: 640, height: 360 });
    // Bars of 320 px each side; the camera sits at the canvas's centre.
    expect(toScreen({ x: 1000, y: 500 })).toEqual({ x: 1280, y: 540 });
    expect(toScreen({ x: 680, y: 320 })).toEqual({ x: 320, y: 0 });
    expect(transform.scale).toBe(3);
    expect(camera.screenToWorld({ x: 320, y: 0 })).toEqual({ x: 680, y: 320 });
    expect(camera.screenToWorld({ x: 2240, y: 1080 })).toEqual({ x: 1320, y: 680 });
  });

  it("follows a resize into a new letterbox", () => {
    const { camera, toScreen } = setup(1920, 1080, WIDE, LETTERBOX);
    camera.snapTo({ x: 0, y: 0 });
    expect(toScreen({ x: -320, y: -180 })).toEqual({ x: 0, y: 0 });
    camera.resize(1280, 1080);
    camera.snapTo({ x: 0, y: 0 });
    // 1280 / 640 = 2: bars of 180 px above and below.
    expect(camera.getState().scale).toBe(2);
    expect(toScreen({ x: -320, y: -180 })).toEqual({ x: 0, y: 180 });
  });

  it("rounds the world container to whole px under pixelSnap", () => {
    const { camera, transform } = setup(1920, 1080, WIDE, {
      ...DEFAULT_RESOLUTION,
      pixelSnap: true,
    });
    camera.snapTo({ x: 10.3, y: 20.7 });
    expect(transform.x).toBe(Math.round(960 - 10.3));
    expect(transform.y).toBe(Math.round(540 - 20.7));
  });

  it("scales a 360-high pixel-art area 3× at 1080 px", () => {
    const { camera } = setup(1920, 1080, WIDE, {
      ...DEFAULT_RESOLUTION,
      virtual: { height: 360 },
      integer: true,
    });
    expect(camera.getDisplayScale()).toBe(3);
    expect(camera.getViewport().height).toBe(360);
    expect(camera.getViewport().width).toBe(640);
  });
});
