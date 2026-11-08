import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_RESOLUTION,
  resolveResolution,
  viewportFor,
  type ResolutionPolicy,
} from "../resolution";

type Row = {
  name: string;
  policy: Partial<ResolutionPolicy>;
  canvas: [number, number];
  scale: number;
  view: [number, number];
  offset: [number, number];
};

const policy = (p: Partial<ResolutionPolicy>): ResolutionPolicy => ({
  ...DEFAULT_RESOLUTION,
  ...p,
});
const H360 = { virtual: { height: 360 } };
const W640 = { virtual: { width: 640 } };
const BOTH = { virtual: { width: 640, height: 360 } };

const TABLE: Row[] = [
  // expand on a height: today's behaviour
  {
    name: "default 1080p",
    policy: {},
    canvas: [1920, 1080],
    scale: 1,
    view: [1920, 1080],
    offset: [0, 0],
  },
  {
    name: "default 720p",
    policy: {},
    canvas: [1280, 720],
    scale: 2 / 3,
    view: [1920, 1080],
    offset: [0, 0],
  },
  {
    name: "default ultrawide",
    policy: {},
    canvas: [2560, 1080],
    scale: 1,
    view: [2560, 1080],
    offset: [0, 0],
  },
  {
    name: "default portrait",
    policy: {},
    canvas: [1080, 1920],
    scale: 16 / 9,
    view: [607.5, 1080],
    offset: [0, 0],
  },
  // expand on a width
  {
    name: "width 1080p",
    policy: W640,
    canvas: [1920, 1080],
    scale: 3,
    view: [640, 360],
    offset: [0, 0],
  },
  {
    name: "width tall",
    policy: W640,
    canvas: [1280, 1440],
    scale: 2,
    view: [640, 720],
    offset: [0, 0],
  },
  // expand on both: the tighter axis is fixed, the other shows more
  {
    name: "both 16:9",
    policy: BOTH,
    canvas: [1920, 1080],
    scale: 3,
    view: [640, 360],
    offset: [0, 0],
  },
  {
    name: "both wider",
    policy: BOTH,
    canvas: [2560, 1080],
    scale: 3,
    view: [2560 / 3, 360],
    offset: [0, 0],
  },
  {
    name: "both taller",
    policy: BOTH,
    canvas: [1280, 1080],
    scale: 2,
    view: [640, 540],
    offset: [0, 0],
  },
  // letterbox
  {
    name: "letterbox 16:9",
    policy: { ...BOTH, fit: "letterbox" },
    canvas: [1920, 1080],
    scale: 3,
    view: [640, 360],
    offset: [0, 0],
  },
  {
    name: "letterbox pillars",
    policy: { ...BOTH, fit: "letterbox" },
    canvas: [2560, 1080],
    scale: 3,
    view: [640, 360],
    offset: [320, 0],
  },
  {
    name: "letterbox bars",
    policy: { ...BOTH, fit: "letterbox" },
    canvas: [1280, 1080],
    scale: 2,
    view: [640, 360],
    offset: [0, 180],
  },
  // crop
  {
    name: "crop 16:9",
    policy: { ...BOTH, fit: "crop" },
    canvas: [1920, 1080],
    scale: 3,
    view: [640, 360],
    offset: [0, 0],
  },
  {
    name: "crop wider",
    policy: { ...BOTH, fit: "crop" },
    canvas: [2560, 1080],
    scale: 4,
    view: [640, 270],
    offset: [0, 0],
  },
  {
    name: "crop taller",
    policy: { ...BOTH, fit: "crop" },
    canvas: [1280, 1080],
    scale: 3,
    view: [1280 / 3, 360],
    offset: [0, 0],
  },
  // letterbox or crop with one axis fits as expand
  {
    name: "letterbox one axis",
    policy: { ...H360, fit: "letterbox" },
    canvas: [1920, 1080],
    scale: 3,
    view: [640, 360],
    offset: [0, 0],
  },
  // integer
  {
    name: "integer 1080p",
    policy: { ...H360, integer: true },
    canvas: [1920, 1080],
    scale: 3,
    view: [640, 360],
    offset: [0, 0],
  },
  {
    name: "integer 1000 high",
    policy: { ...H360, integer: true },
    canvas: [1920, 1000],
    scale: 2,
    view: [960, 360],
    offset: [0, 140],
  },
  {
    name: "integer 1440p",
    policy: { ...H360, integer: true },
    canvas: [2560, 1440],
    scale: 4,
    view: [640, 360],
    offset: [0, 0],
  },
  {
    name: "integer below 1x",
    policy: { ...H360, integer: true },
    canvas: [480, 300],
    scale: 0.5,
    view: [960, 360],
    offset: [0, 60],
  },
  {
    name: "integer letterbox",
    policy: { ...BOTH, fit: "letterbox", integer: true },
    canvas: [2000, 1200],
    scale: 3,
    view: [640, 360],
    offset: [40, 60],
  },
  {
    name: "integer crop",
    policy: { ...BOTH, fit: "crop", integer: true },
    canvas: [2560, 1080],
    scale: 4,
    view: [640, 270],
    offset: [0, 0],
  },
  {
    name: "integer crop remainder",
    policy: { ...BOTH, fit: "crop", integer: true },
    canvas: [2000, 1000],
    scale: 3,
    view: [640, 1000 / 3],
    offset: [40, 0],
  },
  // pixel snap: whole-px bars
  {
    name: "pixelSnap letterbox",
    policy: { ...BOTH, fit: "letterbox", pixelSnap: true },
    canvas: [1281, 1080],
    scale: 1281 / 640,
    view: [640, 360],
    offset: [0, 179],
  },
];

describe("viewportFor", () => {
  for (const row of TABLE) {
    it(`${row.name}: ${row.canvas.join("×")}`, () => {
      const [width, height] = row.canvas;
      const vp = viewportFor(policy(row.policy), { width, height });
      expect(vp.scale).toBeCloseTo(row.scale, 9);
      expect(vp.view.width).toBeCloseTo(row.view[0], 9);
      expect(vp.view.height).toBeCloseTo(row.view[1], 9);
      expect(vp.offset.x).toBeCloseTo(row.offset[0], 9);
      expect(vp.offset.y).toBeCloseTo(row.offset[1], 9);
      expect(vp.bars).toBe(row.offset[0] > 0 || row.offset[1] > 0);
      // The shown area plus its bars fills the canvas exactly.
      expect(vp.view.width * vp.scale + 2 * vp.offset.x).toBeLessThanOrEqual(width + 1e-6);
      expect(vp.view.height * vp.scale + 2 * vp.offset.y).toBeLessThanOrEqual(height + 1e-6);
    });
  }

  it("is today's expand-on-1080 with the default, bit for bit", () => {
    for (const [w, h] of [
      [1920, 1080],
      [1280, 720],
      [1366, 768],
      [1024, 768],
      [3440, 1440],
    ] as const) {
      const vp = viewportFor(DEFAULT_RESOLUTION, { width: w, height: h });
      const scale = h / 1080;
      expect(vp).toEqual({
        scale,
        view: { width: w / scale, height: 1080 },
        offset: { x: 0, y: 0 },
        bars: false,
      });
    }
  });

  it("scales a 360-high virtual area 3× at 1080 px under integer", () => {
    const vp = viewportFor(policy({ ...H360, integer: true }), { width: 1920, height: 1080 });
    expect(vp.scale).toBe(3);
    expect(vp.bars).toBe(false);
    const short = viewportFor(policy({ ...H360, integer: true }), { width: 1920, height: 1079 });
    expect(short.scale).toBe(2);
    expect(short.offset.y).toBeCloseTo((1079 - 720) / 2);
  });

  it("puts bars on whole canvas px under pixelSnap", () => {
    const p = policy({ ...H360, integer: true, pixelSnap: true });
    const vp = viewportFor(p, { width: 1920, height: 1001 });
    expect(vp.offset.y).toBe(140);
    expect(Number.isInteger(vp.offset.x)).toBe(true);
  });

  it("survives an empty canvas", () => {
    const vp = viewportFor(DEFAULT_RESOLUTION, { width: 0, height: 0 });
    expect(Number.isFinite(vp.scale) && vp.scale > 0).toBe(true);
    expect(Number.isFinite(vp.view.width)).toBe(true);
  });
});

describe("resolveResolution", () => {
  it("is the default with no sources", () => {
    expect(resolveResolution({})).toEqual(DEFAULT_RESOLUTION);
  });

  it("takes each field from the host, then the project, then the game, then the default", () => {
    const resolved = resolveResolution({
      host: { fit: "letterbox" },
      project: { fit: "crop", integer: true, virtual: { width: 320, height: 180 } },
      game: { fit: "expand", integer: false, pixelSnap: true, sampling: "nearest", bars: 0 },
    });
    expect(resolved).toEqual({
      virtual: { width: 320, height: 180 },
      fit: "letterbox",
      integer: true,
      sampling: "nearest",
      antialias: true,
      pixelSnap: true,
      bars: 0,
    });
  });

  it("takes `virtual` whole, never mixing axes across sources", () => {
    const resolved = resolveResolution({
      project: { virtual: { width: 640 } },
      game: { virtual: { width: 320, height: 180 } },
    });
    expect(resolved.virtual).toEqual({ width: 640 });
  });

  it("skips a source's undefined field", () => {
    const resolved = resolveResolution({ host: { fit: undefined }, game: { fit: "crop" } });
    expect(resolved.fit).toBe("crop");
  });

  it("returns a fresh policy, leaving the default as it is", () => {
    const resolved = resolveResolution({});
    expect(resolved).not.toBe(DEFAULT_RESOLUTION);
    expect(resolved.virtual).not.toBe(DEFAULT_RESOLUTION.virtual);
    expect(Object.isFrozen(DEFAULT_RESOLUTION)).toBe(true);
  });
});
