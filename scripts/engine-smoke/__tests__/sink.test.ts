// @vitest-environment node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

import { createRegistry, resolveClips, withProject } from "@jams/engine/game";
import { assetInfo, createHeadlessRuntime } from "@jams/engine/headless";
import {
  createKindRegistry,
  projectView,
  runtimeView,
  sceneBundle,
  type AnimationFile,
} from "@jams/engine/project";
import {
  expandScene,
  sceneSprites,
  type EntityDef,
  type SceneDefinition,
} from "@jams/engine/scene";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { devAssetUrl } from "../../../packages/engine/editor-ui/connect/dev";
import { drawnEntities } from "../../../packages/engine/scene/render-geometry";
import { answerSinkRequest, loadSinkProject, type SinkProject } from "../browser/project";
import { loadRapier } from "../browser/run";
import {
  ANIM_COLOURS,
  ANIM_ENTITY,
  ANIM_FRAME_TICKS,
  ANIM_POINT,
  INSIDE_COLOUR,
  INSIDE_POINT,
  OUTSIDE_POINT,
  SINK_DATA_ROUTE,
  SINK_FRAME,
  SINK_PROJECT,
  SINK_SCENE,
  SMOKE_BACKGROUND,
  SPLIT_VIEWPORTS,
} from "../browser/sink";
import { parseSinkScene, sinkPrefabs } from "../browser/sink-prefabs";
import { smokeGame } from "../game";
import { REPO } from "../pack";

const SCENES = join(REPO, "packages/engine/scenes");

let sink: SinkProject;

beforeAll(async () => {
  sink = await loadSinkProject(SCENES);
});

afterAll(() => sink?.close());

/** What the page builds from the data route: the project view, the registry and the scene with its prefabs. */
function pageSide() {
  const kinds = createKindRegistry(smokeGame);
  const view = projectView(sink.data.state, kinds);
  const values = new Map(Object.entries(sink.data.values));
  const registry = withProject(createRegistry(smokeGame), view, values);
  const prefabs = sinkPrefabs(view, values, registry);
  const def = parseSinkScene(values.get(SINK_SCENE), registry, prefabs);
  return { kinds, view, values, registry, def, prefabs };
}

const get = (url: string) => answerSinkRequest(sink, { method: "GET", url, headers: {} });

const inBox = (
  [x, y]: readonly [number, number],
  b: { minX: number; minY: number; maxX: number; maxY: number },
) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;

/** An RGBA PNG's pixel, for the unfiltered rows a zlib PNG writer emits. */
async function pngPixel(path: string, x: number, y: number): Promise<number> {
  const file = await readFile(path);
  let at = 8;
  let width = 0;
  const idat: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString("latin1", at + 4, at + 8);
    const data = file.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      expect([data[8], data[9]]).toEqual([8, 6]);
    }
    if (type === "IDAT") idat.push(data);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const row = 1 + width * 4;
  expect(raw[y * row]).toBe(0);
  const p = y * row + 1 + x * 4;
  expect(raw[p + 3]).toBe(255);
  return (raw[p]! << 16) | (raw[p + 1]! << 8) | raw[p + 2]!;
}

describe("the preview's sink routes", () => {
  it("serve the page the scan's registry and every doc asset's JSON", async () => {
    const res = await get(SINK_DATA_ROUTE);
    expect(res?.status).toBe(200);
    expect(res?.body).toBe(sink.data);
    const { view, values } = pageSide();
    expect(values.has(SINK_SCENE)).toBe(true);
    for (const entry of view.byId.values())
      expect(values.has(entry.id), entry.id).toBe(entry.sha256 === undefined);
  });

  it("serve each texture the sink's bundle names at the URL the loader asks for, by hash", async () => {
    const { kinds, view, registry, def, prefabs } = pageSide();
    const expanded = expandScene(def, registry, { prefabs });
    const { bundle, issues } = sceneBundle(expanded, def, prefabs, view, kinds, registry);
    expect(issues).toEqual([]);
    expect(bundle.entries.map((e) => e.id)).toEqual(["backdrop", "crates-texture", "hero-texture"]);
    for (const entry of bundle.entries) {
      const url = devAssetUrl()(SINK_PROJECT, entry);
      expect(url).toBe(`/__project/${SINK_PROJECT}/blob/${entry.sha256}`);
      const res = await get(url);
      expect(res?.status, entry.id).toBe(200);
      const file = await readFile(join(SCENES, view.byId.get(entry.id)!.path));
      expect(Buffer.from(res!.body as Uint8Array).equals(file), entry.id).toBe(true);
      expect(res?.headers?.["content-type"]).toBe("application/octet-stream");
    }
  });

  it("answer a hash the project doesn't hold with 404, and leave other URLs to the preview", async () => {
    const res = await get(`/__project/${SINK_PROJECT}/blob/${"0".repeat(64)}`);
    expect(res?.status).toBe(404);
    expect((await get("/__project/nowhere/blob/abc"))?.status).toBe(404);
    expect(await get("/index.html")).toBeNull();
    expect(await get("/assets/main.js")).toBeNull();
  });
});

describe("the render run's pinned points", () => {
  it("frame the crate sprite: the inside point on it and off its body, nothing else drawn there", () => {
    const { view, registry, def, prefabs } = pageSide();
    const sprites = sceneSprites(def, { registry, prefabs, project: view });
    const crate = sprites.find((s) => s.ref === "crate")!;
    expect(crate).toMatchObject({ asset: "crates", frame: "crate-0" });
    expect(inBox(INSIDE_POINT, crate.box)).toBe(true);
    const margin = 0.06;
    const [x, y] = INSIDE_POINT;
    expect(inBox([x + margin, y], crate.box) && inBox([x - margin, y], crate.box)).toBe(true);
    const drawn = drawnEntities(expandScene(def, registry, { prefabs }), registry);
    const body = drawn.find((d) => d.id === "crate")!.shape as {
      cx: number;
      cy: number;
      hw: number;
      hh: number;
    };
    expect(Math.abs(x - body.cx)).toBeGreaterThanOrEqual(body.hw + margin);
    for (const d of drawn) {
      if (!d.shape || d.id === "crate") continue;
      const grown = {
        minX: d.box.minX - margin,
        minY: d.box.minY - margin,
        maxX: d.box.maxX + margin,
        maxY: d.box.maxY + margin,
      };
      expect(inBox(INSIDE_POINT, grown), d.id).toBe(false);
    }
    for (const s of sprites)
      if (s.ref !== "crate") expect(inBox(INSIDE_POINT, s.box), s.ref).toBe(false);
  });

  it("leave the outside point clear of every sprite, body, path and point the sink draws", () => {
    const { view, registry, def, prefabs } = pageSide();
    const margin = 0.08;
    const near = (b: { minX: number; minY: number; maxX: number; maxY: number }) =>
      inBox(OUTSIDE_POINT, {
        minX: b.minX - margin,
        minY: b.minY - margin,
        maxX: b.maxX + margin,
        maxY: b.maxY + margin,
      });
    for (const s of sceneSprites(def, { registry, prefabs, project: view }))
      expect(near(s.box), s.ref).toBe(false);
    for (const d of drawnEntities(expandScene(def, registry, { prefabs }), registry))
      expect(near(d.box), d.id).toBe(false);
  });

  it("sit inside the camera's frame", () => {
    for (const p of [INSIDE_POINT, OUTSIDE_POINT]) expect(inBox(p, SINK_FRAME)).toBe(true);
  });

  it("hold after the run's one step: the crate rests where it was placed", async () => {
    const { registry, def, prefabs, view, values } = pageSide();
    const runtime = createHeadlessRuntime({
      rapier: await loadRapier(),
      game: smokeGame,
      registry,
      scene: expandScene(def, registry, { prefabs }),
    });
    try {
      runtime.step(1000 / 60, []);
      const pose = runtime.ctx.poses.get("crate")!;
      expect(Math.abs(pose.x - 8.8)).toBeLessThan(0.005);
      expect(Math.abs(pose.y - 11.4)).toBeLessThan(0.005);
      expect(Math.abs(pose.rot)).toBeLessThan(0.01);
    } finally {
      runtime.destroy();
    }
    expect(values.size).toBeGreaterThan(0);
    expect(view.byId.has("crates")).toBe(true);
  });

  it("expect crate-0's own colour, which isn't the background", async () => {
    const { view } = pageSide();
    const frame = assetInfo(view, "crates", "crate-0")!;
    const texture = view.byId.get(frame.texture!)!;
    const { rect } = frame;
    const centre = await pngPixel(
      join(SCENES, texture.path),
      rect!.x + Math.floor(rect!.w / 2),
      rect!.y + Math.floor(rect!.h / 2),
    );
    expect(centre).toBe(INSIDE_COLOUR);
    for (const [px, py] of [
      [rect!.x, rect!.y],
      [rect!.x + rect!.w - 1, rect!.y + rect!.h - 1],
    ] as const)
      expect(await pngPixel(join(SCENES, texture.path), px, py)).toBe(INSIDE_COLOUR);
    expect(INSIDE_COLOUR).not.toBe(SMOKE_BACKGROUND);
  });
});

const grown = (b: { minX: number; minY: number; maxX: number; maxY: number }, m: number) => ({
  minX: b.minX - m,
  minY: b.minY - m,
  maxX: b.maxX + m,
  maxY: b.maxY + m,
});

/** The scene's own entities, each with its behavior blocks by name. */
const entitiesOf = (def: SceneDefinition) =>
  (def.entities ?? []) as readonly (EntityDef & { behaviors?: Record<string, unknown> })[];

describe("the split run", () => {
  it("splits the canvas into two halves, each following an entity the sink holds", () => {
    const { def } = pageSide();
    expect(SPLIT_VIEWPORTS.map((v) => v.rect)).toEqual([
      [0, 0, 0.5, 1],
      [0.5, 0, 0.5, 1],
    ]);
    const ids = new Set(entitiesOf(def).map((e) => e.id));
    expect(SPLIT_VIEWPORTS.map((v) => v.frame)).toEqual([
      { entity: "crate" },
      { entity: ANIM_ENTITY },
    ]);
    expect(ids.has("crate") && ids.has(ANIM_ENTITY)).toBe(true);
  });

  it("follows both through the scene's rig with no camera region taking either", () => {
    const { def } = pageSide();
    expect(def.settings?.camera).toBeDefined();
    const regions = entitiesOf(def).filter((e) => e.type === "camera-region");
    expect(regions.length).toBeGreaterThan(0);
    for (const point of [INSIDE_POINT, ANIM_POINT])
      for (const region of regions) {
        const [kind, cx, cy, hw, hh] = region.shape as [string, number, number, number, number];
        expect(kind, region.id).toBe("box");
        const box = { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh };
        expect(inBox(point, grown(box, 1)), region.id).toBe(false);
      }
  });

  it("reads the animated sprite's centre: on its sprite, clear of every other sprite, body and the emitter", () => {
    const { view, registry, def, prefabs } = pageSide();
    const sprites = sceneSprites(def, { registry, prefabs, project: view });
    const own = sprites.find((s) => s.ref === ANIM_ENTITY)!;
    expect(own).toMatchObject({ asset: "hero", frame: "hero-0" });
    expect(inBox(ANIM_POINT, grown(own.box, -0.1))).toBe(true);
    const margin = 0.1;
    for (const s of sprites)
      if (s.ref !== ANIM_ENTITY) expect(inBox(ANIM_POINT, grown(s.box, margin)), s.ref).toBe(false);
    for (const d of drawnEntities(expandScene(def, registry, { prefabs }), registry))
      if (d.shape && d.id !== ANIM_ENTITY)
        expect(inBox(ANIM_POINT, grown(d.box, margin)), d.id).toBe(false);
    for (const e of entitiesOf(def).filter((x) => x.behaviors?.emitter)) {
      const [ex, ey] = e.at as [number, number];
      const dx = ex - ANIM_POINT[0];
      const dy = ey - ANIM_POINT[1];
      expect(dx * dx + dy * dy, e.id).toBeGreaterThan(1.5 * 1.5);
    }
  });

  it("steps a clip frame of the idle clip between its reads: hero-0 after one tick, hero-1 after the rest", async () => {
    const { kinds, view, values, registry, def, prefabs } = pageSide();
    const block = entitiesOf(def).find((e) => e.id === ANIM_ENTITY)!.behaviors!.anim as {
      clip: string;
      source: string;
    };
    expect(block.clip).toBe("idle");
    const file = values.get(block.source) as AnimationFile;
    const atlas = assetInfo(view, file.atlas)!;
    const runtime = createHeadlessRuntime({
      rapier: await loadRapier(),
      game: smokeGame,
      registry,
      scene: expandScene(def, registry, { prefabs }),
      project: runtimeView(view, values, registry, kinds),
    });
    try {
      const { clips } = resolveClips({ animation: file }, atlas, runtime.ctx.time);
      const idle = clips.get("idle")!;
      expect(idle.frames.map((f) => f.frame)).toEqual(["hero-0", "hero-1"]);
      expect(idle.frames[0]!.ticks).toBe(ANIM_FRAME_TICKS);
      const tick = () => runtime.step(runtime.ctx.time.tickMs, []);
      tick();
      expect(runtime.ctx.anim.state(ANIM_ENTITY)?.frame).toBe("hero-0");
      for (let i = 0; i < ANIM_FRAME_TICKS; i++) tick();
      expect(runtime.ctx.anim.state(ANIM_ENTITY)?.frame).toBe("hero-1");
    } finally {
      runtime.destroy();
    }
  });

  it("expects each idle frame's own colour, apart from each other and the background", async () => {
    const { view } = pageSide();
    for (const [i, name] of ["hero-0", "hero-1"].entries()) {
      const frame = assetInfo(view, "hero", name)!;
      const texture = view.byId.get(frame.texture!)!;
      const { rect } = frame;
      for (const [px, py] of [
        [rect!.x + Math.floor(rect!.w / 2), rect!.y + Math.floor(rect!.h / 2)],
        [rect!.x, rect!.y],
        [rect!.x + rect!.w - 1, rect!.y + rect!.h - 1],
      ] as const)
        expect(await pngPixel(join(SCENES, texture.path), px, py), name).toBe(ANIM_COLOURS[i]);
    }
    const channels = (c: number) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
    const apart = (a: number, b: number) =>
      Math.max(...channels(a).map((v, k) => Math.abs(v - channels(b)[k]!)));
    expect(apart(ANIM_COLOURS[0], ANIM_COLOURS[1])).toBeGreaterThan(64);
    for (const c of ANIM_COLOURS) {
      expect(apart(c, SMOKE_BACKGROUND)).toBeGreaterThan(64);
      expect(apart(c, INSIDE_COLOUR)).toBeGreaterThan(64);
    }
  });
});
