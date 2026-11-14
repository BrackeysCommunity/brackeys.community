// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { ANIM } from "../../game/behaviors/anim";
import { TWEEN } from "../../game/behaviors/tween";
import { defineGame } from "../../game/define";
import { SAVE_RANDOM_KEY, type SaveFile } from "../../game/save-file";
import type { GameDefinition } from "../../game/types";
import type { HeldFile } from "../../project/runtime-view";
import { SAVE_TWEENS_KEY, TWEEN_END } from "../../runtime/behaviors/tween";
import { SAVE_INPUT_KEY } from "../../runtime/runtime";
import { captureSave } from "../../runtime/save-state";
import type { SceneRuntimeHandle } from "../../runtime/types";
import { SCENE_FORMAT_VERSION, type EntityDef } from "../../scene/types";
import { probe as gridPuzzle } from "./grid-puzzle.probe";
import {
  loadRapier,
  playFromSave,
  probePhysics,
  probeProjectView,
  probeRuns,
  probeTimeout,
  probesFrom,
  runGenreProbe,
  variantScene,
  variantScript,
  type GenreProbe,
  type ProbeVariant,
  type SaveRun,
} from "./harness";
import { GENRE_PINS } from "./pins";

const PROBES = probesFrom(
  import.meta.glob<Record<string, unknown>>("./*.probe.ts", { eager: true }),
);

/** The entity the audit adds to every probe's scene. */
const AUDITED = "saves-audit";
/** A small solid in a corner of every probe's scene, which a tween moves before any save. */
const DOOR = "saves-audit-door";
const SHEET = "saves-audit-sheet";
const TEXTURE = "saves-audit-texture";

/** A four-frame atlas of uneven durations, one tag over it, so a clip's frames end on different ticks. */
const AUDIT_FILES: readonly HeldFile[] = [
  {
    path: "art/saves-audit.png",
    sidecar: {
      kind: "asset-sidecar",
      v: 1,
      key: "key-saves-audit-texture",
      id: TEXTURE,
      sha256: "1".repeat(64),
      bytes: 64,
      meta: { format: "png", width: 64, height: 16 },
    },
  },
  {
    path: "art/saves-audit.json",
    sidecar: {
      kind: "asset-sidecar",
      v: 1,
      key: "key-saves-audit-sheet",
      id: SHEET,
      assetKind: "atlas",
      sha256: "2".repeat(64),
      bytes: 512,
      import: { texture: TEXTURE },
      meta: {
        tool: "aseprite",
        frames: Object.fromEntries(
          [70, 110, 50, 130].map((durationMs, i) => [
            `audit-${i}`,
            { x: i * 16, y: 0, w: 16, h: 16, durationMs },
          ]),
        ),
        order: ["audit-0", "audit-1", "audit-2", "audit-3"],
        tags: [{ name: "turn", from: 0, to: 3, direction: "pingpong" }],
        slices: [],
      },
    },
  },
];

/** The middle of a scene's bounds. */
function middle(probe: GenreProbe): [number, number] {
  const [x0, y0, x1, y1] = probe.scene.bounds;
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

/** A sprite playing the atlas's clip at an odd speed, under two looping data tweens. */
function auditedEntity(probe: GenreProbe): EntityDef {
  const [x, y] = middle(probe);
  return {
    id: AUDITED,
    type: "marker",
    at: [x, y],
    behaviors: {
      sprite: { asset: SHEET, frame: "audit-0" },
      [ANIM.name]: { source: SHEET, clip: "turn", speed: 1.5 },
      [TWEEN.name]: {
        tweens: [
          { to: { x: x + 0.5 }, duration: 37, repeat: -1, yoyo: true, ease: "sineInOut" },
          {
            to: { alpha: 0.25 },
            duration: 23,
            delay: 5,
            repeat: -1,
            yoyo: true,
            ease: "bounceOut",
          },
        ],
      },
    },
  } as EntityDef;
}

/** The door's spawn spot and where its tween leaves it. */
function doorSpots(probe: GenreProbe): { at: [number, number]; end: [number, number] } {
  const [x0, y0] = probe.scene.bounds;
  return { at: [x0 + 0.25, y0 + 0.25], end: [x0 + 0.25, y0 + 0.75] };
}

/** The door, whose short tween has ended at every probe's save. */
function auditedDoor(probe: GenreProbe): EntityDef {
  const { at, end } = doorSpots(probe);
  return {
    id: DOOR,
    type: "solid",
    shape: ["box", at[0], at[1], 0.05, 0.05],
    behaviors: { [TWEEN.name]: { tweens: [{ to: { y: end[1] }, duration: 3 }] } },
  } as EntityDef;
}

/** The probe's game, which also starts a looping code tween on the audited entity at load. */
function auditedGame(game: GameDefinition): GameDefinition {
  return {
    ...game,
    createRuntime(ctx) {
      const runtime = game.createRuntime(ctx);
      const onLoad = runtime.onLoad?.bind(runtime);
      runtime.onLoad = (scene) => {
        onLoad?.(scene);
        ctx.tweens.to(AUDITED, {
          to: { rot: 1.5 },
          duration: 41,
          repeat: -1,
          yoyo: true,
          ease: "elasticInOut",
          key: "audit",
        });
      };
      return runtime;
    },
  };
}

/** The probe with the audited entity, its atlas and the code tween added. */
function audited(probe: GenreProbe): GenreProbe {
  return {
    ...probe,
    game: auditedGame(probe.game as GameDefinition),
    scene: {
      ...probe.scene,
      entities: [...(probe.scene.entities ?? []), auditedEntity(probe), auditedDoor(probe)],
    },
    project: { ...probe.project, files: [...(probe.project?.files ?? []), ...AUDIT_FILES] },
  };
}

/**
 * What a world save of the runtime's end holds of animation and tweens: the
 * audited entity's pose and systems, and every tween of the run; whether the
 * door blocks its spawn spot and its tween's end; or why it can't be saved.
 */
function endState(probe: GenreProbe, runtime: SceneRuntimeHandle): unknown {
  const captured = captureSave(runtime, { depth: "world", slot: "audit", now: 0 });
  if (!captured.ok) return { refused: captured.issue.code };
  const world = captured.file.world;
  const blocks = ([x, y]: [number, number]) =>
    runtime.ctx.space.pointAt({ x, y }).some((h) => h.tag.entityId === DOOR);
  const { at, end } = doorSpots(probe);
  return {
    pose: world?.poses[AUDITED],
    systems: world?.systems[AUDITED],
    tweens: world?.systems[SAVE_TWEENS_KEY],
    door: { pose: world?.poses[DOOR], at: blocks(at), end: blocks(end) },
  };
}

/** One save-at-N run of the audited probe, continued in the saving runtime or restored into a fresh one. */
async function auditRun(
  probe: GenreProbe,
  variant: ProbeVariant & { saveAt: number },
  continueSaved: boolean,
): Promise<SaveRun> {
  const a = audited(probe);
  return playFromSave({
    rapier: probePhysics(a, variant) === "none" ? null : await loadRapier(),
    game: a.game as GameDefinition,
    scene: variantScene(a, variant),
    prefabs: a.prefabs,
    library: a.prefabs,
    project: probeProjectView(a),
    script: variantScript(a, variant),
    ...(a.ticks ? { ticks: a.ticks } : {}),
    at: variant.saveAt,
    label: `${probe.id} ${variant.name} audited${continueSaved ? ", continued" : ""}`,
    continueSaved,
    observe: (runtime) => endState(probe, runtime),
  });
}

const SAVED = PROBES.flatMap((probe) =>
  probeRuns(probe)
    .filter((r): r is { name: string; variant: ProbeVariant & { saveAt: number } } =>
      Number.isInteger(r.variant?.saveAt),
    )
    .map(({ name, variant }) => ({ id: probe.id, name, probe, variant })),
);

describe("saves audit: every probe's save-at-N variant with anim and tweens attached", () => {
  it("finds the save variants", () => {
    expect(SAVED.length).toBeGreaterThan(10);
    for (const id of ["grid-puzzle", "shooter", "local-versus", "turn-tactics"])
      expect(SAVED.map((s) => s.id)).toContain(id);
  });

  for (const { id, name, probe, variant } of SAVED) {
    it(
      `${id} ${name}: save-then-continue equals restore-then-continue`,
      async () => {
        const continued = await auditRun(probe, variant, true);
        const restored = await auditRun(probe, variant, false);

        // The save holds what the audited entity's clip and its three tweens were doing.
        const world = continued.save.world;
        expect(Object.keys(world?.systems[AUDITED] ?? {}), id).toContain(ANIM.name);
        const run = world?.systems[SAVE_TWEENS_KEY]?.run as { tweens?: { owner?: string }[] };
        const tweens = run?.tweens ?? [];
        expect(
          tweens.filter((t) => t.owner === AUDITED),
          id,
        ).toHaveLength(3);
        expect(world?.poses[AUDITED], id).toBeDefined();
        // Where the door's tween moved it, its collider went too.
        const door = (continued.observed as { door: { pose?: number[]; end: boolean } }).door;
        expect(door.end, id).toBe(door.pose?.[1] === doorSpots(probe).end[1]);

        expect(restored.outcome).toStrictEqual(continued.outcome);
        expect(restored.ticks).toBe(continued.ticks);
        expect(restored.final).toStrictEqual(continued.final);
        expect(restored.observed).toStrictEqual(continued.observed);
        expect(restored.digest).toBe(continued.digest);
      },
      2 * probeTimeout(probe),
    );
  }
});

/**
 * A tween on `spark` that ends at tick 5, `spark` destroyed at tick 8, and a
 * tween on `rock` from tick 12: a save between holds no tween, no block and
 * no moved entity, only the id the next tween gets.
 */
const tweenIds: GenreProbe = {
  id: "saves-audit-tween-ids",
  rows: ["puzzle"],
  game: defineGame({
    id: "saves-audit-tween-ids",
    types: [],
    actions: [],
    createRuntime: (ctx) => ({
      snapshot: () => ({ live: ctx.exists("spark") }),
      // Nothing of its own to put back: the world save holds the tweens and the entities.
      restore() {},
      beforeStep() {
        if (ctx.tick === 2) ctx.tweens.to("spark", { to: { x: 2 }, duration: 3 });
        if (ctx.tick === 8) ctx.destroy("spark");
        if (ctx.tick === 12) ctx.tweens.to("rock", { to: { x: 3 }, duration: 3 });
      },
    }),
  }) as GameDefinition,
  scene: {
    v: SCENE_FORMAT_VERSION,
    game: "saves-audit-tween-ids",
    name: "saves-audit-tween-ids",
    bounds: [0, 0, 4, 4],
    settings: { physics: "none" },
    entities: [
      { id: "spark", type: "marker", at: [1, 1] },
      { id: "rock", type: "marker", at: [1, 2] },
    ] as EntityDef[],
  },
  script: { v: 2, scene: "saves-audit-tween-ids", steps: [{ wait: 20 }] },
  expect: { result: "none" },
};

/** The grid puzzle's swap rules saved with a pointer button held, where the restored run used to step fewer ticks. */
const HELD_POINTER_SAVES = [14, 16, 19, 21, 40, 42];

/** A run saved at `at`, restored, saved again at each of `again` and restored each time. */
function chain(probe: GenreProbe, variant: ProbeVariant, at: number, again: number[]) {
  return playFromSave({
    rapier: null,
    game: probe.game as GameDefinition,
    scene: variantScene(probe, variant),
    prefabs: probe.prefabs,
    library: probe.prefabs,
    project: probeProjectView(probe),
    script: variantScript(probe, variant),
    ...(probe.ticks ? { ticks: probe.ticks } : {}),
    at,
    again,
    label: `${probe.id} ${variant.name} chained`,
  });
}

const randomOf = (save: SaveFile | undefined) => save?.world?.systems[SAVE_RANDOM_KEY] ?? {};

describe("saves audit: the gaps a save chain found", () => {
  it("a save after every tween ended keeps the id the next tween gets", async () => {
    const run = await runGenreProbe(tweenIds, { name: "saved-between-tweens", saveAt: 10 });
    const ended = run.report.events.filter((e) => e.type === TWEEN_END);
    expect(ended.map((e) => [e.entityId, e.data])).toStrictEqual([
      ["spark", { id: 1 }],
      ["rock", { id: 2 }],
    ]);
    const held = run.fromSave!.save.world?.systems[SAVE_TWEENS_KEY]?.run;
    expect(held).toMatchObject({ next: 2, tweens: [] });
    expect(run.fromSave!.digest).toBe(run.digest);
  });

  it.each(HELD_POINTER_SAVES)(
    "grid-puzzle saved-mid-swap at %i, a pointer button held, continues as the run does",
    async (at) => {
      const run = await runGenreProbe(gridPuzzle as GenreProbe, {
        name: "saved-mid-swap",
        settings: { rules: "swap" },
        saveAt: at,
      });
      const input = run.fromSave!.save.world?.systems[SAVE_INPUT_KEY] as
        | Record<string, { pointer?: { buttons: number } }>
        | undefined;
      expect(input?.[0]?.pointer?.buttons).toBe(1);
      expect(run.fromSave!.ticks).toBe(run.report.ticks);
      expect(run.fromSave!.digest).toBe(run.digest);
    },
    probeTimeout(gridPuzzle as GenreProbe),
  );

  it("versus-behaviors saved-mid-run keeps the spawner's fork through a second save before it spawns again", () => {
    const probe = PROBES.find((p) => p.id === "versus-behaviors")!;
    const variant = probe.variants!.find((v) => v.name === "saved-mid-run")!;
    const run = chain(probe, variant, variant.saveAt!, [variant.saveAt! + 1]);
    expect(Object.keys(randomOf(run.save))).toContain("spawner:sparks");
    expect(randomOf(run.again?.[0])).toStrictEqual(randomOf(run.save));
    expect(run.digest).toBe(GENRE_PINS[probe.id]?.[variant.name]);
  });

  for (const { id, name, probe, variant } of SAVED) {
    it(
      `${id} ${name}: save, restore, save, restore continues as the run does`,
      () => {
        const run = chain(probe, variant, variant.saveAt, [variant.saveAt + 1]);
        expect(run.again).toHaveLength(1);
        expect(run.digest).toBe(GENRE_PINS[id]?.[name]);
      },
      probeTimeout(probe),
    );
  }
});
