// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it, vi } from "vite-plus/test";

import { clipFrameAt, resolveClips, type ResolvedClip } from "../anim/clips";
import { overlapFrameShapes } from "../anim/shapes";
import { SPRITE } from "../game/behaviors/sprite";
import { createRegistry, defineGame } from "../game/define";
import { EngineError, type Registry } from "../game/types";
import { runPlaytest } from "../headless/playtest";
import { replayRecording } from "../headless/recording";
import { entryInfo, type AssetInfo } from "../project/asset-info";
import { docKindJsonSchema, parseAssetDoc, type KindEnv } from "../project/kinds";
import {
  ANIMATION_SCHEMA_ID,
  animationIssues,
  animationKind,
  type AnimationFile,
  type ClipDef,
} from "../project/kinds/animation";
import { runtimeView, type ProjectRuntimeView } from "../project/runtime-view";
import type { AssetEntry, ProjectView } from "../project/types";
import { projectView } from "../project/view";
import { ANIM_END, ANIM_FRAME, type AnimSystem } from "../runtime/behaviors/anim";
import { spriteViewId, type SpriteSystem } from "../runtime/behaviors/sprite";
import { createSceneRuntime } from "../runtime/runtime";
import { captureSave, restoreLoaded } from "../runtime/save-state";
import type { SceneRuntimeHandle, StepEvent } from "../runtime/types";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../scene/agent-surface";
import { hashText } from "../scene/hash";
import { undescribedProperties } from "../scene/json-schema";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type ExpandedScene,
  type RuntimeEntity,
  type SceneDefinition,
  type ShapeTuple,
} from "../scene/types";
import { recordingView } from "./fixtures/recording-view";

const at60 = { rate: 60 };
const at30 = { rate: 30 };

type Sidecar = {
  key: string;
  id: string;
  assetKind: string;
  meta: Record<string, unknown>;
  import?: Record<string, unknown>;
};

/** A tuple `parseShape` refuses, typed as one so a test can write it into a file. */
const unparsed = (...tuple: unknown[]) => tuple as unknown as ShapeTuple;

/** The engine project's `hero` atlas, as the project reads its sidecar. */
function heroEntry(): AssetEntry {
  const sidecar = JSON.parse(
    readFileSync(new URL("../scenes/art/hero.json.asset.json", import.meta.url), "utf8"),
  ) as Sidecar;
  return {
    key: sidecar.key,
    id: sidecar.id,
    kind: sidecar.assetKind,
    path: "art/hero.json",
    created: { at: 0, by: "test" },
    meta: sidecar.meta,
    ...(sidecar.import ? { import: sidecar.import } : {}),
  };
}
const hero: AssetInfo = entryInfo(heroEntry()).info;

/** A three-frame atlas with its own durations and a tag per direction. */
const sheet = {
  id: "sheet",
  kind: "atlas",
  frames: ["a", "b", "c"],
  durations: [80, 120, null],
  tags: [
    { name: "fwd", from: 0, to: 2, direction: "forward" },
    { name: "back", from: 0, to: 2, direction: "reverse" },
    { name: "swing", from: 0, to: 2, direction: "pingpong" },
  ],
} as AssetInfo;

const doc = (clips: ClipDef[], atlas = "sheet"): AnimationFile => ({
  kind: "animation",
  v: 1,
  atlas,
  clips,
});

function resolved(file: AnimationFile, atlas = sheet, time = at60) {
  return resolveClips({ animation: file }, atlas, time);
}

const clipOf = (r: ReturnType<typeof resolveClips>, name: string): ResolvedClip => {
  const clip = r.clips.get(name);
  if (!clip) throw new Error(`no clip "${name}": ${JSON.stringify(r.issues)}`);
  return clip;
};

const codes = (issues: readonly { code: string; path?: string }[]) =>
  issues.map((i) => [i.code, i.path]);

describe("resolveClips: an atlas alone", () => {
  it("turns the hero atlas's idle tag into a clip, its 100 ms frames rounded to ticks at 60 Hz", () => {
    const r = resolveClips({ atlas: hero }, hero, at60);
    expect(r.issues).toEqual([]);
    expect([...r.clips.keys()]).toEqual(["idle"]);
    expect(clipOf(r, "idle")).toEqual({
      name: "idle",
      frames: [
        { frame: "hero-0", ticks: 6, events: [], shapes: {} },
        { frame: "hero-1", ticks: 6, events: [], shapes: {} },
      ],
      loop: "loop",
      speed: 1,
      next: null,
      length: 12,
    });
  });

  it("gives the same clip at 30 Hz in half the ticks", () => {
    const idle = clipOf(resolveClips({ atlas: hero }, hero, at30), "idle");
    expect(idle.frames.map((f) => f.ticks)).toEqual([3, 3]);
    expect(idle.length).toBe(6);
  });

  it("takes each frame's duration from the atlas, else 100 ms", () => {
    const r = resolveClips({ atlas: sheet }, sheet, at60);
    expect(clipOf(r, "fwd").frames.map((f) => [f.frame, f.ticks])).toEqual([
      ["a", 5],
      ["b", 7],
      ["c", 6],
    ]);
  });

  it("keeps a tag's direction: reverse plays backwards, pingpong stays", () => {
    const r = resolveClips({ atlas: sheet }, sheet, at60);
    expect(clipOf(r, "back").frames.map((f) => f.frame)).toEqual(["c", "b", "a"]);
    expect(clipOf(r, "back").loop).toBe("loop");
    expect(clipOf(r, "swing").loop).toBe("pingpong");
  });

  it("is pure: the same inputs give equal clips", () => {
    expect(resolveClips({ atlas: sheet }, sheet, at60)).toEqual(
      resolveClips({ atlas: sheet }, sheet, at60),
    );
  });
});

describe("resolveClips: an animation doc", () => {
  it("rounds each ms to whole ticks once, at least 1, at 60 and at 30 Hz", () => {
    const file = doc([
      {
        name: "jab",
        frames: [
          { frame: "a", ms: 50 },
          { frame: "b", ms: 70 },
          { frame: "c", ms: 1 },
        ],
      },
    ]);
    expect(clipOf(resolved(file), "jab").frames.map((f) => f.ticks)).toEqual([3, 4, 1]);
    expect(clipOf(resolved(file, sheet, at30), "jab").frames.map((f) => f.ticks)).toEqual([
      2, 2, 1,
    ]);
  });

  it("overrides a tag's frames by index and appends the rest", () => {
    const file = doc([
      {
        name: "mixed",
        tag: "fwd",
        frames: [
          { frame: "c", ms: 200, events: ["step"] },
          { frame: "b" },
          { frame: "c" },
          { frame: "a", ms: 50 },
        ],
      },
    ]);
    const clip = clipOf(resolved(file), "mixed");
    expect(clip.frames.map((f) => [f.frame, f.ticks, f.events])).toEqual([
      ["c", 12, ["step"]],
      ["b", 7, []],
      ["c", 6, []],
      ["a", 3, []],
    ]);
  });

  it("resolves frame shape sets to shapes, and takes speed and an explicit loop", () => {
    const file = doc([
      {
        name: "jab",
        loop: "hold",
        speed: 1.5,
        tag: "swing",
        frames: [{ frame: "a", shapes: { hit: [["box", 0.2, 0, 0.1, 0.05]], "hurt-high": [] } }],
      },
    ]);
    const clip = clipOf(resolved(file), "jab");
    expect(clip.loop).toBe("hold");
    expect(clip.speed).toBe(1.5);
    expect(clip.frames[0]!.shapes).toEqual({
      hit: [{ type: "box", cx: 0.2, cy: 0, hw: 0.1, hh: 0.05, rotDeg: 0 }],
      "hurt-high": [],
    });
  });

  it("measures pingpong there and back without repeating the ends", () => {
    const r = resolveClips({ atlas: sheet }, sheet, at60);
    expect(clipOf(r, "swing").length).toBe(5 + 7 + 6 + 7);
    const two = clipOf(
      resolved(
        doc([
          {
            name: "two",
            loop: "pingpong",
            frames: [
              { frame: "a", ms: 50 },
              { frame: "b", ms: 100 },
            ],
          },
        ]),
      ),
      "two",
    );
    expect(two.length).toBe(3 + 6);
    const one = clipOf(
      resolved(doc([{ name: "one", loop: "pingpong", frames: [{ frame: "a" }] }])),
      "one",
    );
    expect(one.length).toBe(5);
  });

  it("keeps a once clip's next", () => {
    const file = doc([
      { name: "idle", tag: "fwd" },
      { name: "jab", loop: "once", frames: [{ frame: "a" }], next: "idle" },
      { name: "end", loop: "once", frames: [{ frame: "b" }] },
    ]);
    const r = resolved(file);
    expect(r.issues).toEqual([]);
    expect(clipOf(r, "jab")).toMatchObject({ loop: "once", next: "idle" });
    expect(clipOf(r, "end").next).toBeNull();
  });
});

describe("animationIssues", () => {
  const issueOf = (file: AnimationFile, code: string, atlas: AssetInfo | null = sheet) => {
    const hits = animationIssues(file, atlas).filter((i) => i.code === code);
    expect(hits).toHaveLength(1);
    return hits[0]!;
  };

  it("anim-tag-unknown for a tag the atlas lacks, with a did-you-mean", () => {
    const issue = issueOf(doc([{ name: "walk", tag: "fwdd" }]), "anim-tag-unknown");
    expect(issue).toMatchObject({
      path: "/clips/0/tag",
      got: "fwdd",
      expected: "fwd | back | swing",
    });
    expect(issue.message).toMatch(/did you mean "fwd"\?/);
  });

  it("asset-frame-unknown for a frame the atlas lacks, with a did-you-mean", () => {
    const issue = issueOf(
      doc([{ name: "jab", frames: [{ frame: "a" }, { frame: "bb" }] }]),
      "asset-frame-unknown",
    );
    expect(issue).toMatchObject({
      path: "/clips/0/frames/1/frame",
      got: "bb",
      expected: "a | b | c",
    });
    expect(issue.message).toMatch(/did you mean "b"\?/);
  });

  it("frame-shape-invalid for a set name that isn't lowercase with dashes, and a tuple that doesn't parse", () => {
    const file = doc([
      {
        name: "jab",
        frames: [
          { frame: "a", shapes: { Hit: [["box", 0, 0, 1, 1]], hurt: [unparsed("box", 0, 0, 1)] } },
        ],
      },
    ]);
    expect(codes(animationIssues(file, sheet))).toEqual([
      ["frame-shape-invalid", "/clips/0/frames/0/shapes/Hit"],
      ["frame-shape-invalid", "/clips/0/frames/0/shapes/hurt/0"],
    ]);
    for (const name of ["hit", "hurt-high", "a1", "x".repeat(32)])
      expect(
        animationIssues(
          doc([{ name: "j", frames: [{ frame: "a", shapes: { [name]: [] } }] }]),
          sheet,
        ),
      ).toEqual([]);
    for (const name of ["1hit", "-hit", "hit_box", "x".repeat(33), ""])
      expect(
        codes(
          animationIssues(
            doc([{ name: "j", frames: [{ frame: "a", shapes: { [name]: [] } }] }]),
            sheet,
          ),
        ),
      ).toEqual([["frame-shape-invalid", `/clips/0/frames/0/shapes/${name}`]]);
  });

  it("anim-clip-unknown for a next naming no clip, with a did-you-mean", () => {
    const issue = issueOf(
      doc([
        { name: "idle", tag: "fwd" },
        { name: "jab", loop: "once", frames: [{ frame: "a" }], next: "idlee" },
      ]),
      "anim-clip-unknown",
    );
    expect(issue).toMatchObject({ path: "/clips/1/next", got: "idlee", expected: "idle | jab" });
    expect(issue.message).toMatch(/did you mean "idle"\?/);
  });

  it("asset-kind for an atlas id naming another kind", () => {
    const texture: AssetInfo = { id: "sheet", kind: "texture", size: [32, 16] };
    expect(issueOf(doc([{ name: "idle", tag: "fwd" }]), "asset-kind", texture)).toMatchObject({
      path: "/atlas",
      expected: "atlas",
      got: "texture",
    });
  });

  it("schema for a clip with neither tag nor frames", () => {
    expect(
      codes(animationIssues(doc([{ name: "none" }, { name: "empty", frames: [] }]), sheet)),
    ).toEqual([
      ["schema", "/clips/0"],
      ["schema", "/clips/1"],
    ]);
  });

  it("without the atlas's info, checks only what needs no atlas", () => {
    const file = doc([
      { name: "walk", tag: "nope", frames: [{ frame: "zz", shapes: { Bad: [] } }], next: "gone" },
    ]);
    expect(codes(animationIssues(file, null))).toEqual([
      ["frame-shape-invalid", "/clips/0/frames/0/shapes/Bad"],
      ["anim-clip-unknown", "/clips/0/next"],
    ]);
  });

  it("is what resolveClips reports, leaving out each clip an error points into", () => {
    const file = doc([
      { name: "idle", tag: "fwd" },
      { name: "walk", tag: "fwdd" },
      { name: "jab", loop: "once", frames: [{ frame: "a" }], next: "walk" },
      { name: "hit", frames: [{ frame: "a", shapes: { hit: [unparsed("circle", 0, 0)] } }] },
    ]);
    const r = resolved(file);
    expect(r.issues).toEqual(animationIssues(file, sheet));
    expect([...r.clips.keys()]).toEqual(["idle", "jab"]);
    expect(clipOf(r, "jab").next).toBeNull();
  });

  it("leaves every clip out when the atlas isn't an atlas", () => {
    const texture: AssetInfo = { id: "sheet", kind: "texture" };
    const r = resolved(doc([{ name: "idle", tag: "fwd" }]), texture);
    expect(codes(r.issues)).toEqual([["asset-kind", "/atlas"]]);
    expect(r.clips.size).toBe(0);
  });
});

describe("clipFrameAt", () => {
  const clip = (loop: ResolvedClip["loop"], ticks: number[]): ResolvedClip => {
    const frames = ticks.map((t, i) => ({ frame: `f${i}`, ticks: t, events: [], shapes: {} }));
    const sum = ticks.reduce((a, b) => a + b, 0);
    const inner = loop === "pingpong" ? ticks.slice(1, -1).reduce((a, b) => a + b, 0) : 0;
    return { name: loop, frames, loop, speed: 1, next: null, length: sum + inner };
  };
  const walk = (c: ResolvedClip, upTo: number) =>
    Array.from({ length: upTo }, (_, e) => {
      const { index, into, done } = clipFrameAt(c, e);
      return `${index}.${into}${done ? "!" : ""}`;
    });

  it("loop: enters each frame on its first tick and wraps at length", () => {
    expect(walk(clip("loop", [2, 3, 1]), 14)).toEqual([
      "0.0",
      "0.1",
      "1.0",
      "1.1",
      "1.2",
      "2.0",
      "0.0",
      "0.1",
      "1.0",
      "1.1",
      "1.2",
      "2.0",
      "0.0",
      "0.1",
    ]);
  });

  it("pingpong: there and back without repeating the ends", () => {
    expect(walk(clip("pingpong", [2, 3, 1]), 10)).toEqual([
      "0.0",
      "0.1",
      "1.0",
      "1.1",
      "1.2",
      "2.0",
      "1.0",
      "1.1",
      "1.2",
      "0.0",
    ]);
    expect(walk(clip("pingpong", [1, 2]), 5)).toEqual(["0.0", "1.0", "1.1", "0.0", "1.0"]);
    expect(walk(clip("pingpong", [2]), 3)).toEqual(["0.0", "0.1", "0.0"]);
  });

  it("once: done from length on, on its last frame's last tick", () => {
    expect(walk(clip("once", [2, 1]), 6)).toEqual(["0.0", "0.1", "1.0", "1.0!", "1.0!", "1.0!"]);
    expect(clipFrameAt(clip("once", [2, 3]), 5)).toEqual({ index: 1, into: 2, done: true });
    expect(clipFrameAt(clip("once", [2, 3]), 4)).toEqual({ index: 1, into: 2, done: false });
  });

  it("hold: stays on its last frame from length on, never done", () => {
    expect(walk(clip("hold", [1, 2]), 5)).toEqual(["0.0", "1.0", "1.1", "1.1", "1.1"]);
  });

  it("is pure: a seek to any tick agrees with stepping there", () => {
    const c = clip("pingpong", [3, 1, 4, 2]);
    const stepped = walk(c, 40);
    const sought = [37, 0, 12, 25, 5, 39, 18].map((e) => [e, walk(c, e + 1)[e]]);
    for (const [e, seen] of sought) expect(seen).toBe(stepped[e as number]);
  });

  it("agrees with a resolved clip's length on the hero atlas at 30 Hz", () => {
    const idle = clipOf(resolveClips({ atlas: hero }, hero, at30), "idle");
    expect(walk(idle, 7)).toEqual(["0.0", "0.1", "0.2", "1.0", "1.1", "1.2", "0.0"]);
  });
});

describe("the animation kind", () => {
  const engineEnv: KindEnv = { registry: createRegistry(), project: null };

  function heroProject(): ProjectView {
    const entry = heroEntry();
    return projectView({
      meta: { projectId: "p", layout: 2, name: "P" },
      assets: { [entry.key]: entry },
      history: {},
      code: {},
      build: {},
    });
  }

  it("is a sim doc over one atlas, co-edited per clip, capped at 256 KiB and 512 clips", () => {
    expect(animationKind).toMatchObject({
      kind: "animation",
      storage: "doc",
      runtime: "sim",
      version: 1,
      schemaId: "urn:jams-engine:animation:v1",
      match: { jsonKind: "animation" },
      limits: { maxStateBytes: 262_144, maxItems: 512 },
    });
    expect(animationKind.layout).toEqual({
      as: "map",
      fields: {
        atlas: { as: "atomic" },
        clips: {
          as: "keyed",
          id: "name",
          item: {
            as: "map",
            fields: { frames: { as: "list", item: { as: "atomic" } } },
            rest: { as: "atomic" },
          },
        },
      },
      rest: { as: "atomic" },
    });
  });

  it("validates against the project's atlas through animationIssues, with lines", () => {
    const text = `${JSON.stringify(doc([{ name: "rest", tag: "idlee" }], "hero"), null, 2)}\n`;
    const r = parseAssetDoc(animationKind, text, { ...engineEnv, project: heroProject() });
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => [i.code, i.path, i.line])).toEqual([
      ["anim-tag-unknown", "/clips/0/tag", 8],
    ]);
    expect(r.issues[0]!.message).toMatch(/did you mean "idle"\?/);
    const fine = parseAssetDoc(animationKind, doc([{ name: "rest", tag: "idle" }], "hero"), {
      ...engineEnv,
      project: heroProject(),
    });
    expect(fine).toMatchObject({ ok: true, issues: [] });
  });

  it("reads a tuple that doesn't parse as frame-shape-invalid, not a schema refusal", () => {
    const r = parseAssetDoc(
      animationKind,
      doc([{ name: "j", frames: [{ frame: "a", shapes: { hit: [unparsed("box", 1)] } }] }]),
      engineEnv,
    );
    expect(codes(r.issues)).toEqual([["frame-shape-invalid", "/clips/0/frames/0/shapes/hit/0"]]);
  });

  it("writes its JSON Schema to project/animation.schema.json", () => {
    const file = new URL("../project/animation.schema.json", import.meta.url);
    const schema = docKindJsonSchema(animationKind, engineEnv);
    if (process.env.UPDATE_SCHEMAS) writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(schema);
    expect(schema.$id).toBe(ANIMATION_SCHEMA_ID);
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(undescribedProperties(schema)).toEqual([]);
  });
});

// ─── The anim behavior at runtime ─────────────────────────

const DT = 1000 / 60;
const TEX = "a".repeat(64);
const SHEET = "b".repeat(64);

const assetEntry = (id: string, kind: string, extra: Partial<AssetEntry> = {}): AssetEntry => ({
  key: `k-${id}`,
  id,
  kind,
  path: `${id}.${kind}`,
  created: { at: 0, by: "t" },
  ...extra,
});

const hit: ShapeTuple = ["box", 0.5, 0, 0.25, 0.25];
const hurt: ShapeTuple = ["box", 0, 0, 0.25, 0.5];

/** Four 100 ms frames over one texture, `idle` tagging the first two. */
const brawlerFile: AnimationFile = doc(
  [
    { name: "idle", tag: "idle" },
    {
      name: "attack",
      frames: [
        { frame: "f2", ms: 50, events: ["windup"] },
        { frame: "f3", ms: 50, events: ["strike", "whoosh"], shapes: { hit: [hit] } },
      ],
      loop: "once",
      next: "idle",
    },
    {
      name: "stance",
      frames: [
        { frame: "f2", ms: 50, shapes: { hit: [hit], hurt: [hurt] } },
        { frame: "f3", ms: 50 },
      ],
      loop: "once",
    },
    {
      name: "beat",
      frames: ["f0", "f1", "f2", "f3"].map((frame) => ({ frame, ms: 10, events: ["beat"] })),
    },
  ],
  "brawler-sheet",
);

const animView = projectView({
  meta: { projectId: "p", layout: 2, name: "P" },
  assets: Object.fromEntries(
    [
      assetEntry("brawler-tex", "texture", {
        sha256: TEX,
        meta: { format: "png", width: 64, height: 16 },
      }),
      assetEntry("brawler-sheet", "atlas", {
        sha256: SHEET,
        meta: {
          tool: "aseprite",
          frames: Object.fromEntries(
            [0, 1, 2, 3].map((i) => [`f${i}`, { x: i * 16, y: 0, w: 16, h: 16, durationMs: 100 }]),
          ),
          tags: [{ name: "idle", from: 0, to: 1, direction: "forward" }],
          slices: [],
          order: ["f0", "f1", "f2", "f3"],
        },
        import: { texture: "brawler-tex" },
      }),
      assetEntry("brawler", "animation"),
    ].map((e) => [e.key, e]),
  ),
  history: {},
  code: {},
  build: {},
});

const animRegistry: Registry = createRegistry();
const animProject: ProjectRuntimeView = runtimeView(
  animView,
  new Map([["brawler", brawlerFile]]),
  animRegistry,
);

const brawler = (
  id: string,
  at: [number, number],
  anim: Record<string, unknown>,
  sprite: Record<string, unknown> = {},
  over: Partial<RuntimeEntity> = {},
) =>
  ({
    id,
    type: "marker",
    at,
    behaviors: {
      sprite: { asset: "brawler-sheet", frame: "f0", ...sprite },
      anim: { source: "brawler", ...anim },
    },
    ...over,
  }) as RuntimeEntity;

const arena = (entities: RuntimeEntity[]): ExpandedScene => ({
  name: "arena",
  bounds: [-10, -10, 10, 10],
  settings: {
    gravity: [0, 0],
    physics: "none",
    grid: null,
    view: { projection: "orthogonal" },
  },
  entities,
});

function arenaRuntime(entities: RuntimeEntity[], opts: { view?: boolean } = {}) {
  const rec = opts.view ? recordingView({ sprites: true }) : null;
  const rt = createSceneRuntime({
    rapier: null,
    view: rec?.view ?? null,
    registry: animRegistry,
    project: animProject,
  });
  const report = rt.load(arena(entities));
  expect(report.ok, JSON.stringify(report)).toBe(true);
  return { rt, rec };
}

const animEvents = (events: readonly StepEvent[]) =>
  events
    .filter((e) => e.type === ANIM_FRAME || e.type === ANIM_END)
    .map((e) => [e.tick, e.type, e.entityId, e.data]);

function stepFor(rt: SceneRuntimeHandle, ticks: number): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < ticks; i++) out.push(...animEvents(rt.step(DT, []).events));
  return out;
}

const frameData = (clip: string, frame: string, index: number, event: string) => ({
  clip,
  frame,
  index,
  event,
});

describe("the anim behavior", () => {
  it("raises anim:frame on the tick each frame is entered, once per event, then plays next", () => {
    const { rt } = arenaRuntime([brawler("a", [1, 2], { clip: "attack" })]);
    expect(stepFor(rt, 8)).toEqual([
      [0, ANIM_FRAME, "a", frameData("attack", "f2", 0, "windup")],
      [3, ANIM_FRAME, "a", frameData("attack", "f3", 1, "strike")],
      [3, ANIM_FRAME, "a", frameData("attack", "f3", 1, "whoosh")],
    ]);
    expect(rt.ctx.anim.state("a")).toEqual({
      clip: "idle",
      frame: "f0",
      index: 0,
      into: 1,
      playing: true,
      speed: 1,
    });
  });

  it("holds a once clip with no next on its last frame and raises anim:end; play starts it again", () => {
    const { rt } = arenaRuntime([brawler("a", [0, 0], { clip: "stance" })]);
    expect(stepFor(rt, 10)).toEqual([[6, ANIM_END, "a", { clip: "stance" }]]);
    expect(rt.ctx.anim.state("a")).toMatchObject({ frame: "f3", index: 1, playing: false });
    rt.ctx.anim.play("a", "stance");
    stepFor(rt, 1);
    expect(rt.ctx.anim.state("a")).toMatchObject({ frame: "f2", index: 0, into: 0, playing: true });
  });

  it("advances by speed in whole thousandths of a tick, carrying the rest", () => {
    const { rt } = arenaRuntime([
      brawler("fast", [0, 0], { clip: "beat", speed: 1.5 }),
      brawler("slow", [1, 0], { clip: "beat", speed: 0.25 }),
      brawler("idle", [2, 0], { clip: "idle", speed: 1.5 }),
    ]);
    const perTick: Record<string, number[]> = { fast: [], slow: [] };
    const idleFrames: string[] = [];
    for (let t = 0; t < 9; t++) {
      const events = rt.step(DT, []).events.filter((e) => e.type === ANIM_FRAME);
      for (const id of ["fast", "slow"])
        perTick[id]!.push(events.filter((e) => e.entityId === id).length);
      idleFrames.push(rt.ctx.anim.state("idle")!.frame);
    }
    expect(perTick.fast).toEqual([1, 1, 2, 1, 2, 1, 2, 1, 2]);
    expect(perTick.slow).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    // Six-tick frames at 1.5 last four ticks.
    expect(idleFrames).toEqual(["f0", "f0", "f0", "f0", "f1", "f1", "f1", "f1", "f0"]);
    expect(rt.ctx.anim.state("fast")?.speed).toBe(1.5);
  });

  it("staggers a start by offset ticks, raising nothing for a frame it starts inside", () => {
    const { rt } = arenaRuntime([
      brawler("a", [0, 0], { clip: "idle" }),
      brawler("b", [1, 0], { clip: "idle", offset: 3 }),
    ]);
    expect(rt.ctx.anim.state("b")).toMatchObject({ frame: "f0", into: 3 });
    const entered = (id: string) => {
      const out: number[] = [];
      let last = rt.ctx.anim.state(id)!.frame;
      return {
        check(tick: number) {
          const now = rt.ctx.anim.state(id)!.frame;
          if (now !== last) out.push(tick);
          last = now;
        },
        out,
      };
    };
    const a = entered("a");
    const b = entered("b");
    for (let t = 0; t < 14; t++) {
      rt.step(DT, []);
      a.check(t);
      b.check(t);
    }
    expect(a.out).toEqual([6, 12]);
    expect(b.out).toEqual([3, 9]);
  });

  it("refuses an unknown clip with anim-clip-unknown, and an entity without the block", () => {
    const { rt } = arenaRuntime([brawler("a", [0, 0], { clip: "idle" })]);
    const play = (id: string, clip: string) => {
      try {
        rt.ctx.anim.play(id, clip);
      } catch (err) {
        return err;
      }
      return null;
    };
    const unknown = play("a", "atack");
    expect(unknown).toBeInstanceOf(EngineError);
    expect(unknown).toMatchObject({ code: "anim-clip-unknown", entityId: "a" });
    expect((unknown as Error).message).toMatch(/did you mean "attack"\?/);
    expect(play("nobody", "idle")).toMatchObject({ code: "behavior-missing" });
    expect(rt.ctx.anim.state("nobody")).toBeUndefined();
  });

  it("stops and plays on, and a disabled entity keeps its place", () => {
    const { rt } = arenaRuntime([brawler("a", [0, 0], { clip: "idle" })]);
    stepFor(rt, 3);
    rt.ctx.anim.stop("a");
    stepFor(rt, 5);
    expect(rt.ctx.anim.state("a")).toMatchObject({ frame: "f0", into: 2, playing: false });
    rt.ctx.anim.play("a", "idle");
    stepFor(rt, 2);
    expect(rt.ctx.anim.state("a")).toMatchObject({ into: 4, playing: true });
    rt.ctx.setEnabled("a", false);
    stepFor(rt, 4);
    rt.ctx.setEnabled("a", true);
    expect(rt.ctx.anim.state("a")).toMatchObject({ into: 4 });
    stepFor(rt, 2);
    expect(rt.ctx.anim.state("a")).toMatchObject({ frame: "f1", into: 0 });
  });

  it("a seek before tick 0 lands where stepping does", () => {
    const stepped = arenaRuntime([brawler("a", [0, 0], { clip: "attack" })]).rt;
    stepFor(stepped, 4);
    const sought = arenaRuntime([brawler("a", [0, 0], { clip: "attack" })]).rt;
    sought.ctx.behavior<AnimSystem>("anim")!.seek!(4 * DT);
    expect(sought.ctx.anim.state("a")).toEqual(stepped.ctx.anim.state("a"));
    expect(stepFor(sought, 4)).toEqual(stepFor(stepped, 4));
  });
});

describe("frame shapes", () => {
  const box = (cx: number, cy: number, rotDeg = 0) => ({
    type: "box",
    cx,
    cy,
    hw: 0.25,
    hh: 0.25,
    rotDeg,
  });

  it("places a frame's set at the pose, mirrored by the sprite's flip and the instance's", () => {
    const { rt } = arenaRuntime([
      brawler("plain", [2, 1], { clip: "stance" }),
      brawler("flipped", [2, 1], { clip: "stance" }, { flipX: true }),
      brawler(
        "both",
        [2, 1],
        { clip: "stance" },
        { flipX: true },
        {
          transform: { turn: 0, flip: true },
        },
      ),
      brawler("lifted", [2, 1], { clip: "stance" }, { offset: [0, -0.5] }),
    ]);
    expect(rt.ctx.anim.shapes("plain", "hit")).toEqual([box(2.5, 1)]);
    expect(rt.ctx.anim.shapes("flipped", "hit")).toEqual([box(1.5, 1)]);
    expect(rt.ctx.anim.shapes("both", "hit")).toEqual([box(2.5, 1)]);
    expect(rt.ctx.anim.shapes("lifted", "hit")).toEqual([box(2.5, 0.5)]);
    expect(rt.ctx.anim.shapes("plain", "none")).toEqual([]);
    expect(rt.ctx.anim.shapes("nobody", "hit")).toEqual([]);
  });

  it("turns them with the pose, exactly on a quarter turn", () => {
    const { rt } = arenaRuntime([brawler("a", [2, 1], { clip: "stance" })]);
    rt.ctx.poses.set("a", 2, 1, Math.PI / 2, { snap: true });
    expect(rt.ctx.anim.shapes("a", "hit")).toEqual([box(2, 1.5, 90)]);
  });

  it("are only the current frame's", () => {
    const { rt } = arenaRuntime([brawler("a", [0, 0], { clip: "stance" })]);
    stepFor(rt, 4);
    expect(rt.ctx.anim.state("a")?.frame).toBe("f3");
    expect(rt.ctx.anim.shapes("a", "hit")).toEqual([]);
  });

  it("overlapFrameShapes: true when a hit set touches the other's, false when it misses", () => {
    const { rt } = arenaRuntime([
      brawler("a", [0, 0], { clip: "stance" }),
      brawler("b", [1.2, 0], { clip: "stance" }, { flipX: true }),
      brawler("far", [5, 0], { clip: "stance" }, { flipX: true }),
    ]);
    expect(overlapFrameShapes(rt.ctx, "a", "hit", "b", "hit")).toBe(true);
    expect(overlapFrameShapes(rt.ctx, "a", "hit", "b", "hurt")).toBe(false);
    expect(overlapFrameShapes(rt.ctx, "a", "hit", "far", "hit")).toBe(false);
    expect(overlapFrameShapes(rt.ctx, "a", "none", "b", "hit")).toBe(false);
    stepFor(rt, 4);
    expect(overlapFrameShapes(rt.ctx, "a", "hit", "b", "hit")).toBe(false);
  });
});

describe("anim and the run", () => {
  const cast = () => [
    brawler("a", [0, 0], { clip: "attack" }),
    brawler("b", [1, 0], { clip: "beat", speed: 1.5 }),
    brawler("c", [2, 0], { clip: "idle", offset: 2 }),
  ];

  /** A digest of `ticks` steps: each tick's anim events and every entity's anim state. */
  function digest(rt: SceneRuntimeHandle, ticks: number): string {
    const frames: unknown[] = [];
    for (let i = 0; i < ticks; i++) {
      const events = animEvents(rt.step(DT, []).events);
      frames.push([events, ["a", "b", "c"].map((id) => rt.ctx.anim.state(id))]);
    }
    return hashText(JSON.stringify(frames));
  }

  it("a world save mid-clip restores to the same digest", () => {
    const a = arenaRuntime(cast()).rt;
    stepFor(a, 4);
    expect(a.ctx.anim.state("a")).toMatchObject({ clip: "attack", index: 1, into: 0 });
    const captured = captureSave(a, { depth: "world", slot: "s", now: 0 });
    if (!captured.ok) throw new Error(captured.issue.message);
    expect(captured.file.world?.systems).toBeDefined();
    const digestA = digest(a, 20);

    const b = arenaRuntime(cast()).rt;
    const file = JSON.parse(JSON.stringify(captured.file)) as typeof captured.file;
    expect(restoreLoaded(b, file)).toBeNull();
    expect(b.ctx.anim.state("a")).toMatchObject({ clip: "attack", index: 1, into: 0 });
    expect(digest(b, 20)).toBe(digestA);
  });

  it("with a view, hands the sprite system each frame change once; headless there is none and the run is the same", () => {
    const viewed = arenaRuntime([brawler("a", [0, 0], { clip: "idle" })], { view: true });
    const sprites = viewed.rt.ctx.behavior<SpriteSystem>(SPRITE.name)!;
    const setFrame = vi.spyOn(sprites, "setFrame");
    const withView = stepFor(viewed.rt, 19);
    expect(setFrame.mock.calls).toEqual([
      ["a", "f1"],
      ["a", "f0"],
      ["a", "f1"],
    ]);
    expect(viewed.rec!.live.get(spriteViewId("a"))?.sprite?.frame).toEqual({
      x: 16,
      y: 0,
      w: 16,
      h: 16,
    });

    const headless = arenaRuntime([brawler("a", [0, 0], { clip: "idle" })]).rt;
    expect(headless.ctx.behavior(SPRITE.name)).toBeUndefined();
    expect(stepFor(headless, 19)).toEqual(withView);
    expect(headless.ctx.anim.state("a")).toEqual(viewed.rt.ctx.anim.state("a"));
  });

  it("a reconcile swap that changes an anim entity's tint, its pose unchanged, keeps its frame", () => {
    const { rt, rec } = arenaRuntime([brawler("a", [0, 0], { clip: "idle" })], { view: true });
    stepFor(rt, 8);
    const before = rt.ctx.anim.state("a");
    expect(before).toMatchObject({ frame: "f1", into: 1 });
    const report = rt.swap(arena([brawler("a", [0, 0], { clip: "idle" }, { tint: 0xff0000 })]), {
      prefabs: new Map(),
    });
    expect(report).toMatchObject({ ok: true, strategy: "reconcile" });
    expect(rt.ctx.anim.state("a")).toEqual(before);
    const visual = rec!.live.get(spriteViewId("a"))?.sprite;
    expect(visual?.tint).toBe(0xff0000);
    expect(visual?.frame).toEqual({ x: 16, y: 0, w: 16, h: 16 });
    stepFor(rt, 5);
    expect(rt.ctx.anim.state("a")).toMatchObject({ frame: "f0", into: 0 });
  });

  it("raises anim:frame on the same ticks in a playtest and its replay", () => {
    /** Game code that logs every anim event it is handed, as its snapshot. */
    const logger = defineGame({
      id: "anim-log",
      types: [],
      actions: [],
      createRuntime(ctx) {
        const log: unknown[] = [];
        const keep = (e: StepEvent) => void log.push([e.tick, e.type, e.entityId, e.data]);
        return {
          onLoad() {
            ctx.events.on(ANIM_FRAME, keep);
            ctx.events.on(ANIM_END, keep);
          },
          snapshot: () => log,
        };
      },
    });
    const scene: SceneDefinition = {
      v: SCENE_FORMAT_VERSION,
      name: "arena",
      bounds: [-10, -10, 20, 20],
      settings: { physics: "none", gravity: [0, 0] },
      entities: cast() as EntityDef[],
    };
    const run = runPlaytest({
      game: logger,
      scene,
      project: animProject,
      script: { v: 2, steps: [{ wait: 40 }] },
    });
    if (run.blocked) throw new Error(JSON.stringify(run));
    const played = animEvents(run.events);
    expect(played.length).toBeGreaterThan(20);
    expect(played.slice(0, 3)).toEqual([
      [0, ANIM_FRAME, "a", frameData("attack", "f2", 0, "windup")],
      [0, ANIM_FRAME, "b", frameData("beat", "f0", 0, "beat")],
      [1, ANIM_FRAME, "b", frameData("beat", "f1", 1, "beat")],
    ]);
    expect(run.final).toEqual(played);
    const replay = replayRecording({
      game: logger,
      scene,
      project: animProject,
      recording: run.recording,
    });
    if (replay.blocked) throw new Error(JSON.stringify(replay));
    expect(replay.matches, replay.divergence ?? "").toBe(true);
    expect(replay.final).toEqual(played);
  });
});
