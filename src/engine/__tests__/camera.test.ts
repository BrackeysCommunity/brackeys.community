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
  bounds: { min: { x: -100, y: -100 }, max: { x: 100, y: 100 } },
};

function setup(
  displayWidth = 1920,
  displayHeight = 1080,
  config = WIDE,
  resolution?: ResolutionPolicy,
  pxPerMetre?: number,
) {
  const { container, transform } = fakeContainer();
  const camera = createCamera(
    container,
    displayWidth,
    displayHeight,
    config,
    resolution,
    pxPerMetre,
  );
  /** Where the rendered container puts world point `w` (metres) on the canvas. */
  const toScreen = (w: Vec2): Vec2 => ({
    x: w.x * transform.scale + transform.x,
    y: w.y * transform.scale + transform.y,
  });
  return { camera, transform, toScreen };
}

function expectNear(actual: Vec2, expected: Vec2, digits = 9): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

describe("screenToWorld", () => {
  it("gives metres, honouring zoom 2 and the camera's offset", () => {
    const { camera } = setup();
    camera.setZoom(2);
    camera.snapTo({ x: 5, y: 3 });

    // A 1920x1080 view at zoom 2 and 100 px per metre shows 9.6 × 5.4 m around (5, 3).
    expectNear(camera.screenToWorld({ x: 0, y: 0 }), { x: 0.2, y: 0.3 });
    expectNear(camera.screenToWorld({ x: 100, y: 50 }), { x: 0.7, y: 0.55 });
    expectNear(camera.screenToWorld({ x: 960, y: 540 }), { x: 5, y: 3 });
  });

  it("inverts the transform it applies to the world container", () => {
    const { camera, toScreen } = setup(1280, 720);
    camera.setZoom(2);
    camera.snapTo({ x: -3.4, y: 1.25 });

    for (const w of [
      { x: -3.4, y: 1.25 },
      { x: -5, y: 0 },
      { x: 0.125, y: 3 },
    ]) {
      expectNear(camera.screenToWorld(toScreen(w)), w);
    }
  });

  it("maps a pointer to the expected metres under zoom and a letterbox at 32 px per metre", () => {
    const letterbox: ResolutionPolicy = {
      ...DEFAULT_RESOLUTION,
      virtual: { width: 640, height: 360 },
      fit: "letterbox",
    };
    // 2560×1080 over 640×360: 3 canvas px per virtual px, pillars of 320 px; 96 canvas px per metre.
    const { camera } = setup(2560, 1080, WIDE, letterbox, 32);
    camera.setZoom(2);
    camera.snapTo({ x: 10, y: 5 });
    expect(camera.getState().scale).toBe(3 * 32 * 2);
    expectNear(camera.screenToWorld({ x: 1280, y: 540 }), { x: 10, y: 5 });
    // 192 canvas px a metre at zoom 2: the pillar's inner edge is 960 px left of centre.
    expectNear(camera.screenToWorld({ x: 320, y: 540 }), { x: 5, y: 5 });
    expectNear(camera.screenToWorld({ x: 1280 + 48, y: 540 - 96 }), { x: 10.25, y: 4.5 });
  });
});

describe("px per metre", () => {
  it("at 100 px per metre puts every point where the px camera put its px form", () => {
    const metres = setup(1366, 768);
    const px = setup(
      1366,
      768,
      {
        lerpSpeed: 0.5,
        bounds: { min: { x: -10_000, y: -10_000 }, max: { x: 10_000, y: 10_000 } },
      },
      undefined,
      1,
    );
    metres.camera.setZoom(1.5);
    px.camera.setZoom(1.5);
    metres.camera.snapTo({ x: 1.234, y: -0.567 });
    px.camera.snapTo({ x: 123.4, y: -56.7 });
    for (const [x, y] of [
      [0, 0],
      [1.234, -0.567],
      [-3.21, 7.5],
      [12.345678, 0.01],
    ] as const) {
      const a = metres.toScreen({ x, y });
      const b = px.toScreen({ x: x * 100, y: y * 100 });
      expect(Math.abs(a.x - b.x)).toBeLessThan(1e-6);
      expect(Math.abs(a.y - b.y)).toBeLessThan(1e-6);
    }
    expect(metres.camera.getState().scale).toBeCloseTo(px.camera.getState().scale * 100, 9);
  });

  it("at 32 px per metre draws a 1 m cell 32 virtual px wide", () => {
    const plain = setup(1920, 1080, WIDE, DEFAULT_RESOLUTION, 32);
    plain.camera.snapTo({ x: 0, y: 0 });
    // The default policy is one canvas px per virtual px at 1080 px high.
    expect(plain.toScreen({ x: 1, y: 0 }).x - plain.toScreen({ x: 0, y: 0 }).x).toBeCloseTo(32, 9);
    expect(plain.camera.getPxPerMetre()).toBe(32);

    const pixelArt = setup(
      1920,
      1080,
      WIDE,
      { ...DEFAULT_RESOLUTION, virtual: { height: 360 } },
      32,
    );
    pixelArt.camera.snapTo({ x: 0, y: 0 });
    // Three canvas px per virtual px: a 1 m cell is 32 virtual px, 96 canvas px.
    expect(pixelArt.camera.getDisplayScale()).toBe(96);
    expect(pixelArt.camera.getViewport().height).toBeCloseTo(360 / 32, 9);
  });
});

describe("snapTo, setPosition and free mode", () => {
  it("snapTo moves the view now, without easing", () => {
    const { camera, transform } = setup();
    camera.snapTo({ x: 4, y: 2 });

    expect(camera.getPosition()).toEqual({ x: 4, y: 2 });
    expect(transform).toEqual({ x: 960 - 400, y: 540 - 200, scale: 100 });
  });

  it("snapTo(null) centers on the bounds", () => {
    const { camera } = setup();
    camera.setBoundsFromScene([0, 0, 40, 20]);
    camera.snapTo(null);
    expect(camera.getPosition()).toEqual({ x: 20, y: 10 });
  });

  it("setPosition moves the camera and the view catches up on the next update", () => {
    const { camera, transform } = setup();
    camera.snapTo({ x: 0, y: 0 });
    camera.setPosition({ x: 3, y: 1 });

    expect(camera.getPosition()).toEqual({ x: 3, y: 1 });
    expect(transform.x).toBe(960);

    camera.update(16, null);
    expect(transform).toEqual({ x: 960 - 300, y: 540 - 100, scale: 100 });
  });

  it("follow mode eases toward the target; free mode ignores it", () => {
    const { camera } = setup();
    camera.snapTo({ x: 0, y: 0 });

    camera.update(16, { x: 1, y: 0 });
    expect(camera.getPosition()).toEqual({ x: 0.5, y: 0 });

    camera.setMode("free");
    camera.update(16, { x: 1, y: 0 });
    expect(camera.getPosition()).toEqual({ x: 0.5, y: 0 });
    camera.setPosition({ x: -2, y: 0.5 });
    camera.update(16, { x: 1, y: 0 });
    expect(camera.getPosition()).toEqual({ x: -2, y: 0.5 });
    expect(camera.getState().mode).toBe("free");

    camera.setMode("follow");
    camera.update(16, { x: 1, y: 0 });
    expect(camera.getPosition()).toEqual({ x: -0.5, y: 0.25 });
  });
});

describe("bounds from the scene", () => {
  it("adds the default margin, one metre, on every side", () => {
    const { camera } = setup();
    camera.setBoundsFromScene([0, 0, 20, 10]);
    const m = CAMERA_SCENE_MARGIN;
    expect(m).toBe(1);
    expect(camera.getState().bounds).toEqual({
      min: { x: -m, y: -m },
      max: { x: 20 + m, y: 10 + m },
    });
  });

  it("takes an explicit margin and clamps the camera inside the result", () => {
    const { camera } = setup();
    camera.setBoundsFromScene([0, 0, 40, 20], 0.5);

    camera.snapTo({ x: -50, y: 999 });
    // Half the 19.2 × 10.8 m view in from each clamped edge.
    expectNear(camera.getPosition(), { x: -0.5 + 9.6, y: 20.5 - 5.4 });

    camera.setPosition({ x: 999, y: -999 });
    expectNear(camera.getPosition(), { x: 40.5 - 9.6, y: -0.5 + 5.4 });
  });

  it("centers an axis the view is wider than", () => {
    const { camera } = setup();
    camera.setBoundsFromScene([0, 0, 10, 5], 0);
    camera.snapTo({ x: 0, y: 0 });
    expect(camera.getPosition()).toEqual({ x: 5, y: 2.5 });
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
      camera.snapTo({ x: 1.234, y: -0.567 });
    }
    expect(b.transform).toEqual(a.transform);
    expect(b.camera.getState()).toEqual(a.camera.getState());
    expect(b.camera.screenToWorld({ x: 17, y: 400 })).toEqual(
      a.camera.screenToWorld({ x: 17, y: 400 }),
    );
    // 768 / 1080 canvas px per virtual px, 100 virtual px per metre, times the zoom.
    expect(a.camera.getState().scale).toBeCloseTo((768 / 1080) * 100 * 1.5, 9);
  });

  it("letterboxes: the virtual area fills the middle, the camera at its centre", () => {
    const { camera, transform, toScreen } = setup(2560, 1080, WIDE, LETTERBOX);
    camera.snapTo({ x: 10, y: 5 });
    expect(camera.getDisplayScale()).toBe(300);
    expect(camera.getState().scale).toBe(300);
    expect(camera.getViewport()).toEqual({ x: 6.8, y: 3.2, width: 6.4, height: 3.6 });
    // Bars of 320 px each side; the camera sits at the canvas's centre.
    expectNear(toScreen({ x: 10, y: 5 }), { x: 1280, y: 540 });
    expectNear(toScreen({ x: 6.8, y: 3.2 }), { x: 320, y: 0 });
    expect(transform.scale).toBe(300);
    expectNear(camera.screenToWorld({ x: 320, y: 0 }), { x: 6.8, y: 3.2 });
    expectNear(camera.screenToWorld({ x: 2240, y: 1080 }), { x: 13.2, y: 6.8 });
  });

  it("follows a resize into a new letterbox", () => {
    const { camera, toScreen } = setup(1920, 1080, WIDE, LETTERBOX);
    camera.snapTo({ x: 0, y: 0 });
    expectNear(toScreen({ x: -3.2, y: -1.8 }), { x: 0, y: 0 });
    camera.resize(1280, 1080);
    camera.snapTo({ x: 0, y: 0 });
    // 1280 / 640 = 2: bars of 180 px above and below.
    expect(camera.getState().scale).toBe(200);
    expectNear(toScreen({ x: -3.2, y: -1.8 }), { x: 0, y: 180 });
  });

  it("rounds the world container to whole px under pixelSnap", () => {
    const { camera, transform } = setup(1920, 1080, WIDE, {
      ...DEFAULT_RESOLUTION,
      pixelSnap: true,
    });
    camera.snapTo({ x: 0.103, y: 0.207 });
    expect(transform.x).toBe(Math.round(960 - 10.3));
    expect(transform.y).toBe(Math.round(540 - 20.7));
  });

  it("scales a 360-high pixel-art area 3× at 1080 px", () => {
    const { camera } = setup(1920, 1080, WIDE, {
      ...DEFAULT_RESOLUTION,
      virtual: { height: 360 },
      integer: true,
    });
    expect(camera.getDisplayScale()).toBe(300);
    expect(camera.getViewport().height).toBeCloseTo(3.6, 9);
    expect(camera.getViewport().width).toBeCloseTo(6.4, 9);
  });
});
