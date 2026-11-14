// @vitest-environment jsdom
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Container, type Particle } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { createRegistry, defineGame } from "../game/define";
import type { GameDefinition } from "../game/types";
import { createHeadlessRuntime } from "../headless/headless";
import { runPlaytest } from "../headless/playtest";
import type { AssetInfo } from "../project/asset-info";
import {
  docKindJsonSchema,
  formatAssetDoc,
  parseAssetDoc,
  type DocKindDef,
  type KindEnv,
} from "../project/kinds";
import {
  EMITTER_MAX_CAP,
  EMITTER_SCHEMA_ID,
  emitterIssues,
  emitterKind,
  type EmitterFile,
} from "../project/kinds/emitter";
import type { ProjectRuntimeView } from "../project/runtime-view";
import { createParticleLayer, curveAt, tintAt, type ParticleLayer } from "../render/particles";
import { createPixiView } from "../render/pixi-view";
import { snapshotDigest } from "../runtime/recorder";
import { createSceneRuntime } from "../runtime/runtime";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../scene/agent-surface";
import { undescribedProperties } from "../scene/json-schema";
import type { ExpandedScene, SceneDefinition } from "../scene/types";
import type { GameInstance } from "../types";

/** Every particle container made, so the shell's particles can be counted from outside. */
const made = vi.hoisted(() => [] as { particleChildren: unknown[]; destroyed: boolean }[]);

// A stand-in that keeps its particles as data: no GPU buffer behind it.
vi.mock("pixi.js", async (importOriginal) => {
  const pixi = await importOriginal<typeof import("pixi.js")>();
  class StubParticleContainer extends pixi.Container {
    particleChildren: unknown[] = [];
    texture: unknown;
    constructor(opts: { texture?: unknown } = {}) {
      super();
      this.texture = opts.texture;
      made.push(this);
    }
    addParticle(...ps: unknown[]) {
      this.particleChildren.push(...ps);
      return ps[0];
    }
    removeParticle(...ps: unknown[]) {
      this.particleChildren = this.particleChildren.filter((p) => !ps.includes(p));
      return ps[0];
    }
  }
  return { ...pixi, ParticleContainer: StubParticleContainer };
});

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

const env: KindEnv = { registry: createRegistry(), project: null };
/** The kind as hosts call it, every hook taking its env. */
const kind: DocKindDef<EmitterFile> = emitterKind;

const lines = (...rows: string[]) => `${rows.join("\n")}\n`;

/** A spray of sparks: every field set, in canonical order. */
const SPARKS = lines(
  "{",
  '  "$schema": "../emitter.schema.json",',
  '  "kind": "emitter",',
  '  "v": 1,',
  '  "bursts": [',
  '    { "atMs": 0, "count": 12 },',
  '    { "atMs": 250, "count": 6 }',
  "  ],",
  '  "alpha": [[0, 1], [0.7, 1], [1, 0]],',
  '  "angle": [-120, -60],',
  '  "blend": "add",',
  '  "damping": 0.5,',
  '  "drift": [0, 4],',
  '  "durationMs": 1500,',
  '  "frame": "spark-0",',
  '  "lifeMs": [300, 600],',
  '  "max": 200,',
  '  "rate": 40,',
  '  "scale": [[0, 1], [1, 0.2]],',
  '  "shape": { "kind": "circle", "r": 0.06 },',
  '  "space": "world",',
  '  "speed": [0.8, 2.2],',
  '  "texture": "sparks",',
  '  "tint": [[0, 16777215], [1, 16744448]]',
  "}",
);

const preset = (over: Record<string, unknown> = {}) => ({
  kind: "emitter",
  v: 1,
  rate: 10,
  lifeMs: [100, 200],
  speed: [1, 2],
  angle: [0, 90],
  ...over,
});

function parsed(value: unknown): EmitterFile {
  const r = parseAssetDoc(emitterKind, value, env);
  if (!r.ok) throw new Error(JSON.stringify(r.issues, null, 2));
  return r.value;
}

const refused = (value: unknown) => {
  const r = parseAssetDoc(emitterKind, value, env);
  expect(r.ok).toBe(false);
  return r.issues.map((i) => [i.code, i.path]);
};

describe("the emitter kind", () => {
  it("is a view doc with its bursts co-edited as a list, capped at 32 KiB", () => {
    expect(emitterKind).toMatchObject({
      kind: "emitter",
      storage: "doc",
      runtime: "view",
      version: 1,
      schemaId: "urn:jams-engine:emitter:v1",
      match: { jsonKind: "emitter" },
      limits: { maxStateBytes: 32_768 },
    });
    expect(emitterKind.layout).toEqual({
      as: "map",
      fields: { bursts: { as: "list", item: { as: "atomic" } } },
      rest: { as: "atomic" },
    });
  });

  it("names its texture, a texture or an atlas, and nothing without one", () => {
    expect(kind.refs?.(parsed(SPARKS), env)).toEqual([
      { pointer: "/texture", id: "sparks", kinds: ["texture", "atlas"] },
    ]);
    expect(kind.refs?.(parsed(preset()), env)).toEqual([]);
  });
});

describe("emitter: parse → format", () => {
  it("the sparks fixture is byte-identical", () => {
    expect(formatAssetDoc(emitterKind, parsed(SPARKS))).toBe(SPARKS);
  });

  it("formats a reordered value to the same text", () => {
    const value = JSON.parse(SPARKS) as Record<string, unknown>;
    const reversed = Object.fromEntries(Object.entries(value).reverse());
    expect(formatAssetDoc(emitterKind, parsed(reversed))).toBe(SPARKS);
  });

  it("its empty value parses and formats back", () => {
    const out = formatAssetDoc(emitterKind, kind.empty(env, { id: "fresh" }));
    expect(formatAssetDoc(emitterKind, parsed(out))).toBe(out);
  });
});

describe("emitter: curves", () => {
  it("take [t, value] keys sorted by t in 0–1, a repeated t making a step", () => {
    const value = parsed(
      preset({
        alpha: [
          [0, 0],
          [0.5, 1],
          [0.5, 0.2],
          [1, 0],
        ],
      }),
    );
    expect(value.alpha).toHaveLength(4);
  });

  it("refuse a key out of order, at the key", () => {
    expect(
      refused(
        preset({
          scale: [
            [0, 1],
            [0.8, 0.5],
            [0.4, 0.2],
          ],
        }),
      ),
    ).toEqual([["schema", "/scale/2/0"]]);
  });

  it("refuse a t below 0 or past 1", () => {
    expect(
      refused(
        preset({
          alpha: [
            [-0.1, 1],
            [1, 0],
          ],
        }),
      ),
    ).toEqual([["schema", "/alpha/0/0"]]);
    expect(
      refused(
        preset({
          tint: [
            [0, 0xffffff],
            [1.5, 0],
          ],
        }),
      ),
    ).toEqual([["schema", "/tint/1/0"]]);
  });

  it("refuse an empty curve, an alpha past 1 and a tint past 0xffffff", () => {
    expect(refused(preset({ scale: [] }))).toEqual([["schema", "/scale"]]);
    expect(refused(preset({ alpha: [[0, 2]] }))).toEqual([["schema", "/alpha/0/1"]]);
    expect(refused(preset({ tint: [[0, 0x1000000]] }))).toEqual([["schema", "/tint/0/1"]]);
  });
});

describe("emitter: limits and pairs", () => {
  it(`caps max at ${EMITTER_MAX_CAP}, a whole number of at least 1`, () => {
    expect(parsed(preset({ max: EMITTER_MAX_CAP })).max).toBe(4096);
    expect(refused(preset({ max: EMITTER_MAX_CAP + 1 }))).toEqual([["schema", "/max"]]);
    expect(refused(preset({ max: 0 }))).toEqual([["schema", "/max"]]);
    expect(refused(preset({ max: 10.5 }))).toEqual([["schema", "/max"]]);
  });

  it("refuses a pair whose min is more than its max, at the max", () => {
    expect(refused(preset({ lifeMs: [600, 300] }))).toEqual([["schema", "/lifeMs/1"]]);
    expect(refused(preset({ speed: [3, 1] }))).toEqual([["schema", "/speed/1"]]);
    expect(refused(preset({ angle: [90, 0] }))).toEqual([["schema", "/angle/1"]]);
    expect(parsed(preset({ angle: [45, 45] })).angle).toEqual([45, 45]);
  });

  it("refuses a negative speed or rate, a zero life, a burst of none and an unknown key", () => {
    expect(refused(preset({ speed: [-1, 1] }))).toEqual([["schema", "/speed/0"]]);
    expect(refused(preset({ rate: -1 }))).toEqual([["schema", "/rate"]]);
    expect(refused(preset({ lifeMs: [0, 100] }))).toEqual([["schema", "/lifeMs/0"]]);
    expect(refused(preset({ bursts: [{ atMs: 0, count: 0 }] }))).toEqual([
      ["schema", "/bursts/0/count"],
    ]);
    expect(refused(preset({ wobble: 1 }))).toEqual([["unknown-key", "/wobble"]]);
  });

  it("takes a point, a circle or a box, sized in metres", () => {
    for (const shape of [
      { kind: "point" },
      { kind: "circle", r: 0.1 },
      { kind: "box", w: 1, h: 0.25 },
    ])
      expect(parsed(preset({ shape })).shape).toEqual(shape);
    expect(refused(preset({ shape: { kind: "circle", r: 0 } }))).toEqual([["schema", "/shape/r"]]);
  });
});

describe("emitterIssues", () => {
  const atlas = { id: "sparks", kind: "atlas", frames: ["spark-0", "spark-1"] } as AssetInfo;
  const file = (frame?: string): EmitterFile => ({
    ...(parsed(preset()) as EmitterFile),
    texture: "sparks",
    ...(frame === undefined ? {} : { frame }),
  });

  it("is clean for an atlas frame it has, a plain texture, or no host info", () => {
    expect(emitterIssues(file("spark-1"), atlas)).toEqual([]);
    expect(emitterIssues(file(), { id: "sparks", kind: "texture" } as AssetInfo)).toEqual([]);
    expect(emitterIssues(file(), null)).toEqual([]);
  });

  it("asset-frame-unknown for an atlas with no frame, or a frame it lacks with a did-you-mean", () => {
    expect(emitterIssues(file(), atlas).map((i) => [i.code, i.path, i.expected])).toEqual([
      ["asset-frame-unknown", "/frame", "spark-0 | spark-1"],
    ]);
    const [issue] = emitterIssues(file("spark-2"), atlas);
    expect(issue).toMatchObject({ code: "asset-frame-unknown", path: "/frame", got: "spark-2" });
    expect(issue?.message).toMatch(/did you mean "spark-[01]"\?/);
  });
});

describe("the emitter JSON Schema", () => {
  it("publishes its URN and the agent surface, every property described, metres and m/s marked", () => {
    const schema = docKindJsonSchema(emitterKind, env);
    expect(schema.$id).toBe(EMITTER_SCHEMA_ID);
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(undescribedProperties(schema)).toEqual([]);
    const props = schema.properties as Record<string, { unit?: string }>;
    expect([props.speed?.unit, props.angle?.unit, props.drift?.unit]).toEqual([
      "m/s",
      "deg",
      "m/s²",
    ]);
  });

  it("is written to project/emitter.schema.json (UPDATE_SCHEMAS=1 regenerates)", () => {
    // A path, not a URL: under jsdom `URL` is the page's, which node:fs refuses.
    const file = fileURLToPath(import.meta.url).replace(
      /__tests__\/particles\.test\.ts$/,
      "project/emitter.schema.json",
    );
    const schema = docKindJsonSchema(emitterKind, env);
    if (process.env.UPDATE_SCHEMAS) writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(schema);
  });
});

// ─── The runtime half: the particle layer, the emitter behavior and the shell ───

const FRAME_MS = 1000 / 60;

const file = (over: Partial<EmitterFile> = {}): EmitterFile => ({
  kind: "emitter",
  v: 1,
  rate: 0,
  lifeMs: [5000, 5000],
  speed: [0, 0],
  angle: [0, 0],
  ...over,
});

function layerOf(opts: { reducedMotion?: boolean } = {}) {
  const container = new Container();
  const layer = createParticleLayer(container, undefined, {
    reducedMotion: opts.reducedMotion ?? false,
    seed: "particles",
  });
  /** Every particle drawn now, wherever it sits. */
  const drawn = () =>
    container.children.flatMap(
      (c) => (c as unknown as { particleChildren: Particle[] }).particleChildren,
    );
  return { container, layer, drawn };
}

const run = (layer: ParticleLayer, ms: number, step = FRAME_MS) => {
  for (let t = 0; t < ms - 1e-9; t += step) layer.update(Math.min(step, ms - t));
};

const still = { x: 0, y: 0, rot: 0 };

describe("the particle layer", () => {
  it("emits within one of its rate over a second of frames", () => {
    for (const rate of [7, 40, 120]) {
      const { layer } = layerOf();
      layer.emitter("e", file({ rate }), () => still);
      run(layer, 1000);
      expect(Math.abs(layer.stats().particles - rate)).toBeLessThanOrEqual(1);
      expect(layer.stats().emitters).toBe(1);
    }
  });

  it("fires each burst once, when its time comes", () => {
    const { layer } = layerOf();
    const bursts = [
      { atMs: 250, count: 3 },
      { atMs: 0, count: 5 },
    ];
    layer.emitter("e", file({ bursts }), () => still);
    run(layer, 100, 100);
    expect(layer.stats().particles).toBe(5);
    run(layer, 100, 100);
    expect(layer.stats().particles).toBe(5);
    run(layer, 100, 100);
    expect(layer.stats().particles).toBe(8);
    run(layer, 500, 100);
    expect(layer.stats().particles).toBe(8);
  });

  it("keeps no more than max alive, and lets particles die at the end of their life", () => {
    const { layer, drawn } = layerOf();
    layer.emitter("e", file({ rate: 1000, max: 30 }), () => still);
    for (let i = 0; i < 60; i++) {
      layer.update(FRAME_MS);
      expect(layer.stats().particles).toBeLessThanOrEqual(30);
    }
    expect(layer.stats().particles).toBe(30);
    expect(drawn()).toHaveLength(30);

    const short = layerOf();
    short.layer.emitter(
      "e",
      file({ bursts: [{ atMs: 0, count: 4 }], lifeMs: [100, 100] }),
      () => still,
    );
    run(short.layer, 50, 50);
    expect(short.layer.stats().particles).toBe(4);
    run(short.layer, 60, 60);
    expect(short.layer.stats().particles).toBe(4);
    run(short.layer, 60, 60);
    expect(short.layer.stats().particles).toBe(0);
    expect(short.drawn()).toEqual([]);
  });

  it("moves local particles with the pose; world particles stay where they were born", () => {
    const pose = { x: 0, y: 0, rot: 0 };
    const at = () => pose;
    const { layer, drawn } = layerOf();
    const once = { bursts: [{ atMs: 0, count: 1 }] };
    layer.emitter("local", file({ ...once, space: "local" }), at);
    layer.emitter("world", file(once), at);
    layer.update(10);
    expect(drawn().map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [0, 0],
    ]);
    pose.x = 2;
    pose.y = 1;
    layer.update(10);
    // Drawn in world px: 100 per metre.
    expect(
      drawn()
        .map((p) => [p.x, p.y])
        .sort((a, b) => a[0]! - b[0]!),
    ).toEqual([
      [0, 0],
      [200, 100],
    ]);
  });

  it("moves particles by speed, angle (clockwise, y down), drift and damping", () => {
    const { layer, drawn } = layerOf();
    layer.burst(file({ speed: [2, 2], angle: [90, 90] }), { x: 1, y: 1 }, { count: 1 });
    layer.update(500);
    const [p] = drawn();
    expect(p!.x).toBeCloseTo(100);
    expect(p!.y).toBeCloseTo(200);

    const drifting = layerOf();
    drifting.layer.burst(file({ drift: [4, 0] }), { x: 0, y: 0 }, { count: 1 });
    drifting.layer.update(1000);
    expect(drifting.drawn()[0]!.x).toBeCloseTo(400);

    const damped = layerOf();
    damped.layer.burst(file({ speed: [1, 1], damping: 100 }), { x: 0, y: 0 }, { count: 1 });
    damped.layer.update(100);
    damped.layer.update(1000);
    expect(damped.drawn()[0]!.x).toBeLessThan(1);
  });

  it("draws scale, alpha and tint along their curves", () => {
    expect(
      curveAt(
        [
          [0, 1],
          [1, 0],
        ],
        0.25,
        9,
      ),
    ).toBe(0.75);
    expect(curveAt(undefined, 0.5, 9)).toBe(9);
    expect(curveAt([[0.5, 2]], 0.1, 9)).toBe(2);
    expect(
      tintAt(
        [
          [0, 0xff0000],
          [1, 0x0000ff],
        ],
        0.5,
      ),
    ).toBe(0x800080);
    const { layer, drawn } = layerOf();
    layer.burst(
      file({
        lifeMs: [1000, 1000],
        alpha: [
          [0, 1],
          [1, 0],
        ],
        scale: [
          [0, 2],
          [1, 0],
        ],
        tint: [
          [0, 0xffffff],
          [1, 0x000000],
        ],
      }),
      { x: 0, y: 0 },
      { count: 1 },
    );
    layer.update(500);
    const [p] = drawn();
    expect(p!.alpha).toBeCloseTo(0.5);
    // Untextured: a 0.05 m square, 5 world px over the 1 px white texture, at half its start scale.
    expect(p!.scaleX).toBeCloseTo(5);
    expect(p!.tint).toBe(0x808080);
  });

  it("freezes at a time scale of 0: nothing is born, ages or moves", () => {
    const { layer, drawn } = layerOf();
    layer.emitter("e", file({ rate: 60, speed: [1, 2], lifeMs: [300, 300] }), () => still);
    run(layer, 200);
    const count = layer.stats().particles;
    const where = drawn().map((p) => [p.x, p.y, p.alpha]);
    for (let i = 0; i < 30; i++) layer.update(0);
    expect(layer.stats().particles).toBe(count);
    expect(drawn().map((p) => [p.x, p.y, p.alpha])).toEqual(where);
  });

  it("quarters the rate and the bursts under reduced motion", () => {
    const { layer } = layerOf({ reducedMotion: true });
    layer.emitter("e", file({ rate: 40 }), () => still);
    run(layer, 1000);
    expect(Math.abs(layer.stats().particles - 10)).toBeLessThanOrEqual(1);

    const bursts = layerOf({ reducedMotion: true });
    bursts.layer.burst(file(), { x: 0, y: 0 }, { count: 12 });
    expect(bursts.layer.stats().particles).toBe(3);
  });

  it("keeps a stopped emitter's world particles to the end of their life, and clear drops all", () => {
    const { layer } = layerOf();
    layer.emitter("w", file({ bursts: [{ atMs: 0, count: 2 }] }), () => still);
    layer.emitter("l", file({ bursts: [{ atMs: 0, count: 3 }], space: "local" }), () => still);
    layer.update(10);
    layer.remove("w");
    layer.remove("l");
    expect(layer.stats()).toEqual({ emitters: 0, particles: 2 });
    layer.update(10);
    expect(layer.stats().particles).toBe(2);
    layer.clear();
    expect(layer.stats()).toEqual({ emitters: 0, particles: 0 });
  });

  it("draws from its own stream, the same for the same seed", () => {
    const spray = file({ rate: 50, speed: [0, 3], angle: [0, 360] });
    const where = () => {
      const { layer, drawn } = layerOf();
      layer.emitter("e", spray, () => still);
      run(layer, 500);
      return drawn().map((p) => [p.x, p.y]);
    };
    expect(where()).toEqual(where());
  });
});

// ─── The emitter behavior ───

const SPRAY = file({ rate: 30, speed: [0.5, 1], angle: [0, 360], lifeMs: [2000, 2000] });

/** A project with one emitter preset and nothing else. */
const project: ProjectRuntimeView = {
  settings: {},
  engine: {},
  table: () => [],
  asset: () => undefined,
  inputMap: null,
  doc: <T>(kind: string, id: string) =>
    kind === "emitter" && id === "spray" ? (SPRAY as T) : undefined,
  docs: (kind) => (kind === "emitter" ? ["spray"] : []),
};

/** Walks a counter and draws from the simulation's random stream every tick, so a stray draw would show. */
const counting: GameDefinition<{ n: number; r: number }> = defineGame({
  id: "counting",
  types: [],
  actions: [],
  world: { physics: "none" },
  time: { kind: "fixed", rate: 60 },
  createRuntime(ctx) {
    let n = 0;
    let r = 0;
    return {
      afterStep() {
        n += ctx.tick;
        r = ctx.random.nextU32();
      },
      snapshot: () => ({ n, r }),
    };
  },
});

const emitting = (behaviors: Record<string, unknown> = { preset: "spray" }) => ({
  id: "fountain",
  type: "marker",
  at: [2, 3] as [number, number],
  behaviors: { emitter: behaviors },
});

const fountainDoc: SceneDefinition = {
  v: 4,
  game: "counting",
  name: "fountain",
  bounds: [0, 0, 20, 20],
  settings: { physics: "none" },
  entities: [emitting()],
};

const fountain: ExpandedScene = {
  name: "fountain",
  game: "counting",
  bounds: [0, 0, 20, 20],
  settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
  entities: [emitting()],
};

function viewedRuntime(entities = fountain.entities) {
  const container = new Container();
  const view = createPixiView(container, { particles: { reducedMotion: false, seed: "fountain" } });
  const rt = createSceneRuntime({
    rapier: null,
    view,
    game: counting as GameDefinition,
    project,
  });
  const report = rt.load({ ...fountain, entities });
  expect(report.ok, JSON.stringify(report)).toBe(true);
  return { rt, view };
}

describe("the emitter behavior", () => {
  it("is never built headless; with a view it runs an emitter on the view's particle layer", () => {
    const headless = createHeadlessRuntime({
      game: counting as GameDefinition,
      scene: fountain,
      project,
    });
    expect(headless.ctx.behavior("emitter")).toBeUndefined();
    headless.destroy();

    const { rt, view } = viewedRuntime();
    expect(rt.ctx.behavior("emitter")).toBeDefined();
    const layer = view.particles!()!;
    expect(layer.stats().emitters).toBe(1);
    for (let i = 0; i < 30; i++) {
      rt.step(rt.ctx.time.tickMs, []);
      rt.render(1);
      layer.update(FRAME_MS);
    }
    expect(Math.abs(layer.stats().particles - 15)).toBeLessThanOrEqual(1);
    rt.destroy();
    view.destroy();
  });

  it("follows emitting and the block's rate, and stops when its entity goes", () => {
    const { rt, view } = viewedRuntime([
      emitting({ preset: "spray", emitting: false }),
      { ...emitting({ preset: "spray", rate: 120 }), id: "fast" },
      { ...emitting({ preset: "missing" }), id: "none" },
    ]);
    const layer = view.particles!()!;
    expect(layer.stats().emitters).toBe(1);
    rt.render(1);
    run(layer, 500);
    expect(Math.abs(layer.stats().particles - 60)).toBeLessThanOrEqual(1);
    rt.ctx.destroy("fast");
    rt.step(rt.ctx.time.tickMs, []);
    expect(layer.stats().emitters).toBe(0);
    rt.destroy();
    view.destroy();
  });

  it("a playtest with emitters ends on one digest with a view and without", () => {
    const ticks = 90;
    const headless = runPlaytest({
      game: counting as GameDefinition,
      scene: fountainDoc,
      project,
      script: { v: 1, steps: [{ wait: ticks }] },
    });
    if (headless.blocked) throw new Error(JSON.stringify(headless.issues));

    const { rt, view } = viewedRuntime();
    const layer = view.particles!()!;
    let last: unknown = null;
    for (let i = 0; i < headless.recording.ticks; i++) {
      last = rt.step(rt.ctx.time.tickMs, []).game;
      rt.render(0.5);
      layer.update(FRAME_MS);
    }
    expect(layer.stats().particles).toBeGreaterThan(0);
    expect(snapshotDigest(last)).toBe(headless.recording.end);
    rt.destroy();
    view.destroy();
  });
});

// ─── The shell: bursts, Play and pause ───

describe("particles in the shell", () => {
  const games: GameInstance[] = [];
  let pending: FrameRequestCallback[] = [];
  let now = 0;
  const advance = (ms: number) => {
    now += ms;
    vi.advanceTimersByTime(ms);
    vi.setSystemTime(now);
    const due = pending;
    pending = [];
    for (const cb of due) cb(now);
  };
  const alive = () =>
    made.filter((c) => !c.destroyed).reduce((n, c) => n + c.particleChildren.length, 0);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => pending.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    document.body.appendChild(document.createElement("canvas"));
    made.length = 0;
  });

  afterEach(() => {
    for (const g of games.splice(0)) g.destroy();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function playing(def: GameDefinition, doc: SceneDefinition) {
    const game = await createGame(document.querySelector("canvas")!, { game: def, project });
    games.push(game);
    game.start();
    expect(game.play(doc)).toMatchObject({ ok: true });
    return game;
  }

  it("draws an emitter in Play and freezes it on pause", async () => {
    const game = await playing(counting as GameDefinition, fountainDoc);
    for (let i = 0; i < 30; i++) advance(FRAME_MS);
    const drawn = alive();
    expect(drawn).toBeGreaterThan(5);
    game.pause();
    for (let i = 0; i < 30; i++) advance(FRAME_MS);
    expect(alive()).toBe(drawn);
    game.resume();
    for (let i = 0; i < 60; i++) advance(FRAME_MS);
    expect(alive()).not.toBe(drawn);
  });

  it("moves a paused emitter by the ticks a frame step advances", async () => {
    const game = await playing(counting as GameDefinition, fountainDoc);
    game.pause();
    for (let i = 0; i < 30; i++) advance(FRAME_MS);
    expect(alive()).toBe(0);
    for (let i = 0; i < 30; i++) {
      game.step(1);
      advance(FRAME_MS);
    }
    expect(alive()).toBeGreaterThan(5);
  });

  it("draws a present.effects.burst from its preset", async () => {
    const bursting = defineGame({
      id: "counting",
      types: [],
      actions: [],
      world: { physics: "none" },
      time: { kind: "fixed", rate: 60 },
      createRuntime: (ctx) => ({
        afterStep() {
          if (ctx.tick === 2) ctx.present.effects.burst("spray", { x: 1, y: 1 }, { count: 7 });
          if (ctx.tick === 3) ctx.present.effects.burst("missing", { x: 1, y: 1 });
        },
        snapshot: () => null,
      }),
    });
    await playing(bursting as GameDefinition, { ...fountainDoc, entities: [] });
    for (let i = 0; i < 8; i++) advance(FRAME_MS);
    expect(alive()).toBe(7);
  });
});
