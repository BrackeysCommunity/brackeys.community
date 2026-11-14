// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { ANIM } from "../../game/behaviors/anim";
import { TWEEN } from "../../game/behaviors/tween";
import type { GameDefinition } from "../../game/types";
import type { HeldFile } from "../../project/runtime-view";
import { SAVE_TWEENS_KEY } from "../../runtime/behaviors/tween";
import { captureSave } from "../../runtime/save-state";
import type { SceneRuntimeHandle } from "../../runtime/types";
import type { EntityDef } from "../../scene/types";
import {
  loadRapier,
  playFromSave,
  probePhysics,
  probeProjectView,
  probeRuns,
  probeTimeout,
  probesFrom,
  variantScene,
  variantScript,
  type GenreProbe,
  type ProbeVariant,
  type SaveRun,
} from "./harness";

const PROBES = probesFrom(
  import.meta.glob<Record<string, unknown>>("./*.probe.ts", { eager: true }),
);

/** The entity the audit adds to every probe's scene. */
const AUDITED = "saves-audit";
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
    scene: { ...probe.scene, entities: [...(probe.scene.entities ?? []), auditedEntity(probe)] },
    project: { ...probe.project, files: [...(probe.project?.files ?? []), ...AUDIT_FILES] },
  };
}

/**
 * What a world save of the runtime's end holds of animation and tweens: the
 * audited entity's pose and systems, and every tween of the run; or why it
 * can't be saved.
 */
function endState(runtime: SceneRuntimeHandle): unknown {
  const captured = captureSave(runtime, { depth: "world", slot: "audit", now: 0 });
  if (!captured.ok) return { refused: captured.issue.code };
  const world = captured.file.world;
  return {
    pose: world?.poses[AUDITED],
    systems: world?.systems[AUDITED],
    tweens: world?.systems[SAVE_TWEENS_KEY],
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
    observe: endState,
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
