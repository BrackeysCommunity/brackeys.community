// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { defineBehavior } from "../../game/behaviors";
import { createRegistry, defineGame } from "../../game/define";
import type { EngineContext } from "../../game/types";
import { createHeadlessRuntime } from "../../headless/headless";
import { composePose, lerpPose, relativePose, type Pose } from "../../runtime/poses";
import type { SceneRuntimeHandle } from "../../runtime/types";
import { expandScene } from "../../scene/expand";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type ExpandedScene,
  type RuntimeEntity,
} from "../../scene/types";
import type { RapierModule } from "../../types";
import { stressRig, type StressRig } from "../fixtures/stress-rig";
import { withParents } from "../fixtures/tree-rig";

/**
 * What the scene tree costs. Every comparison steps its runtimes in turn,
 * tick by tick, and compares median tick times, so whatever else loads the
 * machine falls on each side alike; wall-clock baselines from another
 * machine never decide a result here, they are only printed beside it.
 */

const WARM_TICKS = 30;
const MEASURED_TICKS = 300;
/** The stress scenes are timed over as many ticks as `scene step --timing` runs. */
const STRESS_TICKS = 600;
/** How much slower a tree-carried child may be than the same move written by hand through `ctx.setPose`. */
const FOLLOW_BUDGET = 2;
/** How much the scene tree may add to the movers' and combined stress scenes' tick. */
const STRESS_BUDGET = 1.1;
/**
 * Races of each stress scene, each on runtimes loaded afresh; its result is
 * their median. One race's ratio spreads by ±0.06 between runs of the same
 * code, more than half the budget's margin, so a single race can't decide it.
 * A budgeted scene stops racing once a majority of the rounds falls on one
 * side of its budget, since the rest can't move the median across it.
 */
const STRESS_ROUNDS = 5;
/**
 * The first runtimes a process steps run the engine's hot paths 5–10%
 * faster than later ones, and more so on the side with more to carry, so
 * each stress scene first races once unmeasured. That depends on how many
 * runtimes ran, not how long, so the settling race is short.
 */
const SETTLE_TICKS = 120;

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const median = (xs: readonly number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const ms = (x: number) => x.toFixed(3);

/** Steps every run `warm` ticks, then times `measured` ticks of each, in turn. */
function race(runs: readonly SceneRuntimeHandle[], warm: number, measured: number): number[] {
  const ticks: number[][] = runs.map(() => []);
  for (let i = 0; i < warm + measured; i++) {
    for (const [n, rt] of runs.entries()) {
      const t0 = performance.now();
      rt.step(rt.ctx.time.tickMs, []);
      if (i >= warm) ticks[n]!.push(performance.now() - t0);
    }
  }
  return ticks.map(median);
}

// ─── Following ───────────────────────────────────────────

const PARENTS = 200;
const PER_PARENT = 10;
const SPIN = "tree-budget/spin";

/** How each run moves the children of the spinning markers. */
type Carry = "tree" | "by-hand" | "set-pose" | "none";

/**
 * A game whose `tree-budget/spin` markers circle their start and turn, writing
 * their pose `writes` times a tick. With `carry: "by-hand"` the system then
 * poses each marker's children itself, composed from the local poses they
 * had at load, as the tree does for a parented child.
 */
function spinGame(carry: Carry, children: ReadonlyMap<string, readonly string[]>, writes = 1) {
  const spin = defineBehavior({
    name: SPIN,
    description: "Circles the entity round where it started, turning as it goes.",
    fields: { turn: z.number().default(Math.PI).describe("Angular speed, rad/s; default π.") },
    system(ctx: EngineContext) {
      type Spinner = {
        cx: number;
        cy: number;
        angle: number;
        turn: number;
        /** Measured at the first step, once the children exist. */
        locals: { id: string; local: Pose }[] | null;
      };
      const spinners = new Map<string, Spinner>();
      return {
        attach(id, block) {
          const at = ctx.poses.get(id)!;
          spinners.set(id, {
            cx: at.x,
            cy: at.y,
            angle: 0,
            turn: Number(block.turn),
            locals: carry === "by-hand" || carry === "set-pose" ? null : [],
          });
        },
        detach: (id) => void spinners.delete(id),
        step(dtMs) {
          for (const [id, s] of spinners) {
            const at = ctx.poses.get(id)!;
            s.locals ??= (children.get(id) ?? []).map((child) => ({
              id: child,
              local: relativePose(ctx.poses.get(child)!, at),
            }));
            s.angle += (s.turn * dtMs) / 1000;
            const x = s.cx + 0.5 * Math.cos(s.angle);
            const y = s.cy + 0.5 * Math.sin(s.angle);
            if (writes > 1) ctx.poses.set(id, x, y);
            ctx.poses.set(id, x, y, s.angle);
            for (const { id: child, local } of s.locals) {
              const p = composePose(x, y, s.angle, local);
              if (carry === "set-pose") ctx.setPose(child, p.x, p.y, p.rot);
              else ctx.poses.set(child, p.x, p.y, p.rot);
            }
          }
        },
        clear: () => spinners.clear(),
        size: () => spinners.size,
      };
    },
  });
  return defineGame({
    id: "tree-budget",
    types: [],
    actions: [],
    behaviors: [spin],
    world: { physics: "none", gravity: [0, 0] },
    time: { kind: "fixed", rate: 60 },
    createRuntime: () => ({ snapshot: () => null }),
  });
}

/** `PARENTS` spinning markers on a grid, each with `PER_PARENT` markers round it. */
function spinScene(): { entities: EntityDef[]; children: Map<string, string[]> } {
  const entities: EntityDef[] = [];
  const children = new Map<string, string[]>();
  for (let p = 0; p < PARENTS; p++) {
    const [px, py] = [(p % 20) * 5, Math.floor(p / 20) * 5];
    const id = `parent-${p}`;
    entities.push({ id, type: "marker", at: [px, py], behaviors: { [SPIN]: {} } });
    const kids: string[] = [];
    for (let c = 0; c < PER_PARENT; c++) {
      const a = (c / PER_PARENT) * 2 * Math.PI;
      const r = 0.3 + (c % 4) * 0.5;
      const kid = `child-${p}-${c}`;
      kids.push(kid);
      entities.push({ id: kid, type: "marker", at: [px + r * Math.cos(a), py + r * Math.sin(a)] });
    }
    children.set(id, kids);
  }
  return { entities, children };
}

function openSpin(carry: Carry, writes = 1): SceneRuntimeHandle {
  const { entities, children } = spinScene();
  const game = spinGame(carry, children, writes);
  const registry = createRegistry(game);
  const scene = expandScene(
    {
      v: SCENE_FORMAT_VERSION,
      game: game.id,
      name: `spin-${carry}`,
      bounds: [-5, -5, 105, 55],
      settings: { physics: "none", gravity: [0, 0] },
      entities,
    },
    registry,
  );
  if (carry === "tree")
    withParents(
      scene,
      Object.fromEntries(
        [...children].flatMap(([parent, kids]) => kids.map((kid) => [kid, parent])),
      ),
    );
  return createHeadlessRuntime({ rapier: null, game, registry, scene });
}

// ─── The stress scenes ───────────────────────────────────

type StressScene = "movers" | "rooms" | "combined";

/**
 * Each stress scene before the scene tree existed. `ratio` is its median
 * tick time over the same scene with its riders' `attach` dropped, raced
 * as `measure` races it, settling race included (the engine before the
 * tree, on the owner's machine): the cost of carrying riders, as a share
 * of the rest of the scene, which another machine's speed moves far less
 * than wall time. `mean` is what `scene step --timing` printed over 600
 * ticks then, ms per tick; it is printed beside this run's numbers and
 * never decides a result.
 */
const BEFORE_TREE: Readonly<Record<StressScene, { ratio: number; mean: number }>> = {
  movers: { ratio: 1.18, mean: 4.746 },
  rooms: { ratio: 1.01, mean: 1.963 },
  combined: { ratio: 1.03, mean: 5.049 },
};

/**
 * The scene as it loads, and as it loaded before instances had nodes: the
 * nodes gone, and each child that named one as its parent a root. A
 * parent from an `attach` stays, as the rider it was then.
 */
function withoutNodes(scene: ExpandedScene): ExpandedScene {
  const nodes = new Set(scene.entities.filter((e) => e.type === "node").map((e) => e.id));
  const entities: RuntimeEntity[] = [];
  for (const e of scene.entities) {
    if (nodes.has(e.id)) continue;
    if (e.parent === undefined || !nodes.has(e.parent)) entities.push(e);
    else {
      const { parent: _, ...root } = e;
      entities.push(root as RuntimeEntity);
    }
  }
  return { ...scene, entities };
}

/** Every rider's parent dropped: the scene with nothing for the tree to carry. */
function withoutRiders(scene: ExpandedScene): ExpandedScene {
  return {
    ...scene,
    entities: scene.entities.map((e) => {
      if (e.parent === undefined) return e;
      const { parent: _, ...root } = e;
      return root as RuntimeEntity;
    }),
  };
}

describe("scene tree budgets", () => {
  it(`carries ${PARENTS * PER_PARENT} children of ${PARENTS} moving parents within ${FOLLOW_BUDGET}× the same moves through ctx.setPose`, () => {
    const runs = [
      openSpin("tree"),
      openSpin("set-pose"),
      openSpin("by-hand"),
      openSpin("none"),
      openSpin("tree", 2),
    ];
    const [tree, setPose, byHand, still] = runs as [
      SceneRuntimeHandle,
      SceneRuntimeHandle,
      SceneRuntimeHandle,
      SceneRuntimeHandle,
    ];
    expect(tree.ctx.tree.children("parent-0")).toHaveLength(PER_PARENT);
    expect(setPose.ctx.tree.parent("child-0-0")).toBeNull();

    const [treeMs, setPoseMs, byHandMs, stillMs, twiceMs] = race(
      runs,
      WARM_TICKS,
      MEASURED_TICKS,
    ) as [number, number, number, number, number];

    // The same work: every child ends where the hand-written carry put it.
    for (const id of ["child-0-0", `child-${PARENTS - 1}-${PER_PARENT - 1}`]) {
      const want = byHand.ctx.poses.get(id)!;
      for (const rt of [tree, setPose]) {
        const got = rt.ctx.poses.get(id)!;
        expect(got.x, id).toBeCloseTo(want.x, 9);
        expect(got.y, id).toBeCloseTo(want.y, 9);
        expect(got.rot, id).toBeCloseTo(want.rot, 9);
      }
      expect(still.ctx.poses.get(id), id).not.toStrictEqual(want);
    }

    const children = PARENTS * PER_PARENT;
    const cost = (x: number) =>
      `${ms(x - stillMs)} ms/tick (${ms(((x - stillMs) / children) * 1000)} µs a child)`;
    console.info(
      `${children} children under ${PARENTS} moving parents (${children + PARENTS} entities), median ms/tick: ` +
        `children still ${ms(stillMs)}, carried by the tree ${ms(treeMs)}, through ctx.setPose ${ms(setPoseMs)}, ` +
        `through ctx.poses.set ${ms(byHandMs)}, the tree with each parent written twice ${ms(twiceMs)}. ` +
        `Following costs ${cost(treeMs)}; ctx.setPose ${cost(setPoseMs)}; ctx.poses.set ${cost(byHandMs)}. ` +
        `Tree / ctx.setPose ${(treeMs / setPoseMs).toFixed(3)}, two writes / one ${(twiceMs / treeMs).toFixed(3)}`,
    );
    expect(treeMs).toBeLessThanOrEqual(setPoseMs * FOLLOW_BUDGET);
    for (const rt of runs) rt.destroy();
  }, 120_000);

  describe("the stress game", () => {
    let rig: StressRig;
    let open: (scene: ExpandedScene) => SceneRuntimeHandle;

    beforeAll(async () => {
      rig = await stressRig();
      open = (scene) =>
        createHeadlessRuntime({ rapier, game: rig.game, registry: rig.registry, scene });
    });

    /**
     * Steps the scene as it loads, without its riders and, when it has
     * instances, without their nodes, all in turn, up to `STRESS_ROUNDS`
     * times after a settling race; prints each against the scene's numbers
     * from before the tree. The ratios are to the riderless scene's tick,
     * the median of the rounds'. With a `budget` (a multiple of the ratio
     * before the tree) the rounds stop once a majority of them decides it.
     */
    function measure(name: StressScene, budget?: number) {
      const before = BEFORE_TREE[name];
      const limit = budget === undefined ? undefined : before.ratio * budget;
      const majority = (STRESS_ROUNDS >> 1) + 1;
      const decided = (ratios: readonly number[]) =>
        limit !== undefined &&
        (ratios.filter((r) => r <= limit).length >= majority ||
          ratios.filter((r) => r > limit).length >= majority);
      const scene = rig.expand(name);
      const nodes = scene.entities.filter((e) => e.type === "node").length;
      const parented = scene.entities.filter((e) => e.parent !== undefined).length;
      const variants =
        nodes > 0
          ? [scene, withoutRiders(scene), withoutNodes(scene)]
          : [scene, withoutRiders(scene)];
      const child = scene.entities.find((e) => e.parent !== undefined)!;
      const rounds: { loadedMs: number; riderlessMs: number; nodelessMs: number | undefined }[] =
        [];
      for (let round = -1; round < STRESS_ROUNDS; round++) {
        const runs = variants.map(open);
        const [loaded, riderless] = runs as [SceneRuntimeHandle, SceneRuntimeHandle];
        expect(loaded.ctx.tree.parent(child.id)).toBe(child.parent);
        expect(riderless.ctx.tree.parent(child.id)).toBeNull();
        const [loadedMs, riderlessMs, nodelessMs] = race(
          runs,
          0,
          round < 0 ? SETTLE_TICKS : STRESS_TICKS,
        ) as [number, number, number | undefined];
        if (round >= 0) rounds.push({ loadedMs, riderlessMs, nodelessMs });
        for (const rt of runs) rt.destroy();
        if (decided(rounds.map((r) => r.loadedMs / r.riderlessMs))) break;
      }
      const ratios = rounds.map((r) => r.loadedMs / r.riderlessMs);
      const ratio = median(ratios);
      const loadedMs = median(rounds.map((r) => r.loadedMs));
      const riderlessMs = median(rounds.map((r) => r.riderlessMs));
      const nodelessMs = nodes > 0 ? median(rounds.map((r) => r.nodelessMs!)) : undefined;
      console.info(
        `stress/${name} (${scene.entities.length} entities, ${nodes} nodes, ${parented} with a parent), ` +
          `median ms/tick over ${STRESS_TICKS}, median of ${rounds.length} rounds: as loaded ${ms(loadedMs)}, without riders ${ms(riderlessMs)}` +
          (nodelessMs === undefined
            ? ""
            : `, without nodes ${ms(nodelessMs)} (as loaded / without nodes ${(loadedMs / nodelessMs).toFixed(3)})`) +
          `; as loaded / without riders ${ratio.toFixed(3)} (rounds ${ratios.map((r) => r.toFixed(3)).join(", ")}), ` +
          `before the tree ${before.ratio.toFixed(3)} (${((ratio / before.ratio - 1) * 100).toFixed(1)}%); ` +
          `scene step before the tree, mean ${ms(before.mean)} ms/tick`,
      );
      return { ratio, nodes, limit };
    }

    it(`movers: within ${STRESS_BUDGET}× its tick before the tree`, () => {
      const { ratio, nodes, limit } = measure("movers", STRESS_BUDGET);
      expect(nodes).toBe(0);
      expect(ratio).toBeLessThanOrEqual(limit!);
    }, 300_000);

    it(`combined: within ${STRESS_BUDGET}× its tick before the tree`, () => {
      const { ratio, nodes, limit } = measure("combined", STRESS_BUDGET);
      expect(nodes).toBeGreaterThan(0);
      expect(ratio).toBeLessThanOrEqual(limit!);
    }, 300_000);

    it("rooms: reports what its instance nodes cost", () => {
      expect(measure("rooms").nodes).toBeGreaterThan(0);
    }, 300_000);
  });

  it("draws a child 4 m from a parent turning a full turn a second within a pixel of its arc", () => {
    const RADIUS = 4;
    const TURN = 2 * Math.PI;
    const game = spinGame("none", new Map());
    const registry = createRegistry(game);
    const scene = expandScene(
      {
        v: SCENE_FORMAT_VERSION,
        game: game.id,
        name: "drawing-error",
        bounds: [-10, -10, 10, 10],
        settings: { physics: "none", gravity: [0, 0] },
        entities: [
          { id: "hub", type: "marker", at: [0, 0], behaviors: { [SPIN]: { turn: TURN } } },
          { id: "arm", type: "marker", at: [RADIUS, 0] },
        ],
      },
      registry,
    );
    withParents(scene, { arm: "hub" });
    const rt = createHeadlessRuntime({ rapier: null, game, registry, scene });
    const local = rt.ctx.tree.local("arm")!;
    const rate = rt.ctx.time.rate;

    // The view draws each entity along the straight line between its last two
    // tick poses; the true child sits on its parent's interpolated pose.
    let worst = 0;
    for (let tick = 0; tick < rate; tick++) {
      rt.step(rt.ctx.time.tickMs, []);
      const [hubPrev, hubCur] = [rt.ctx.poses.prev("hub")!, rt.ctx.poses.get("hub")!];
      const [armPrev, armCur] = [rt.ctx.poses.prev("arm")!, rt.ctx.poses.get("arm")!];
      for (let k = 0; k <= 20; k++) {
        const alpha = k / 20;
        const drawn = lerpPose(armPrev, armCur, alpha);
        const hub = lerpPose(hubPrev, hubCur, alpha);
        const arc = composePose(hub.x, hub.y, hub.rot, local);
        worst = Math.max(worst, Math.hypot(drawn.x - arc.x, drawn.y - arc.y));
      }
    }
    // The chord's sagitta: the arc's farthest point from the line between two ticks.
    const sagitta = RADIUS * (1 - Math.cos(TURN / rate / 2));
    const pxPerM = game.world?.lengthUnit ?? 100;
    console.info(
      `drawing error, child ${RADIUS} m from a parent turning ${((TURN * 180) / Math.PI).toFixed(0)}°/s at ${rate} ticks/s: ` +
        `${ms(worst * 1000)} mm (sagitta ${ms(sagitta * 1000)} mm), ${ms(worst * pxPerM)} px at ${pxPerM} px/m`,
    );
    expect(worst).toBeCloseTo(sagitta, 6);
    expect(worst * pxPerM).toBeLessThan(1);
    rt.destroy();
  });
});
