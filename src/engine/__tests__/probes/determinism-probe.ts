/**
 * The determinism probe: the same three workloads under each Rapier build,
 * each reduced to a digest of every float it produced. Same-machine replay
 * holds when two runs on one machine agree; cross-machine replay holds when
 * another machine (CI's Linux image, a container) prints the same digests.
 *
 * Runs under vitest (`determinism.test.ts`) and directly under Bun, which
 * prints the digests as JSON: `bun src/engine/__tests__/probes/determinism-probe.ts`.
 * The standard `@dimforge/rapier2d` can't build a World under Bun, so Bun
 * only runs the `-compat` builds.
 */
import { readFileSync } from "node:fs";

import { createRegistry } from "../../game/define";
import { fuzz } from "../../headless/fuzz";
import { runProbe } from "../../headless/headless";
import { expandScene } from "../../scene/expand";
import { hashText } from "../../scene/hash";
import { parseSceneOrThrow } from "../../scene/parse";
import type { RapierModule } from "../../types";
import { ENGINE_PARITY_SCRIPT } from "../fixtures/parity-script";
import { testGame } from "../fixtures/test-game";

export type Flavour = "rapier2d" | "rapier2d-compat" | "rapier2d-deterministic-compat";

export type ProbeDigests = {
  /** The 600-tick parity script on `engine-yard`: final state, events and stats. */
  script: string;
  /** Twenty 600-tick fuzz rollouts on `engine-yard`: what each touched and how it ended. */
  fuzz: string;
  /** Forty rotating boxes and circles dropped into a bin for 600 ticks: every pose, every 10 ticks. */
  pile: string;
};

async function muted<T>(init: () => Promise<T>): Promise<T> {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await init();
  } finally {
    console.warn = warn;
  }
}

/** Loads one Rapier build, initialised; null when this runtime can't. */
export async function loadFlavour(flavour: Flavour): Promise<RapierModule | null> {
  try {
    if (flavour === "rapier2d") return (await import("@dimforge/rapier2d")) as RapierModule;
    const mod =
      flavour === "rapier2d-compat"
        ? await import("@dimforge/rapier2d-compat")
        : await import("@dimforge/rapier2d-deterministic-compat");
    await muted(() => mod.default.init());
    return mod.default as unknown as RapierModule;
  } catch {
    return null;
  }
}

const registry = createRegistry(testGame);
const def = parseSceneOrThrow(
  readFileSync(new URL("../../scenes/engine-yard.json", import.meta.url), "utf8"),
  registry,
);
const scene = expandScene(def, registry);

/** The parity script's full report, for checks the digest leaves out. */
export function scriptReport(rapier: RapierModule) {
  return runProbe({ rapier, game: testGame, registry, scene, ...ENGINE_PARITY_SCRIPT });
}

/**
 * The digest hashes only the stats fields the pin was taken over, by name
 * and in that order, so a stats field added later (`behaviors`, `backend`)
 * leaves the pin comparable with engines that predate it.
 */
function scriptDigest(rapier: RapierModule): string {
  const report = scriptReport(rapier);
  const { bodies, colliders, tags, entities, perType } = report.stats;
  const stats = { bodies, colliders, tags, entities, perType };
  return hashText(JSON.stringify([report.final, report.events, stats]));
}

function fuzzDigest(rapier: RapierModule): string {
  const report = fuzz({
    rapier,
    game: testGame,
    registry,
    scene: def,
    seed: 6,
    rollouts: 20,
    ticks: 600,
  });
  if (report.blocked) throw new Error("engine-yard blocked the fuzz");
  const ended = Object.entries(report.results).filter(([, n]) => n > 0);
  return hashText(JSON.stringify([report.touched, report.untouched, ended, report.ticks]));
}

/** Plain Rapier, no engine: the most chaotic case, where any float difference compounds. */
function pileDigest(rapier: RapierModule): string {
  const world = new rapier.World({ x: 0, y: 900 });
  const ground = world.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(0, 0));
  world.createCollider(rapier.ColliderDesc.cuboid(400, 10).setTranslation(0, 300), ground);
  world.createCollider(rapier.ColliderDesc.cuboid(10, 300).setTranslation(-400, 0), ground);
  world.createCollider(rapier.ColliderDesc.cuboid(10, 300).setTranslation(400, 0), ground);
  const bodies = [];
  for (let i = 0; i < 40; i++) {
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(-300 + (i % 8) * 75 + (i % 3) * 5, -200 - Math.floor(i / 8) * 60)
        .setRotation(i * 0.37)
        .setAngvel((i % 5) - 2),
    );
    world.createCollider(
      i % 2 === 0
        ? rapier.ColliderDesc.cuboid(14 + (i % 4) * 3, 10 + (i % 3) * 4).setRestitution(0.2)
        : rapier.ColliderDesc.ball(12 + (i % 5) * 2).setFriction(0.3),
      body,
    );
    bodies.push(body);
  }
  const poses: number[] = [];
  for (let tick = 0; tick < 600; tick++) {
    world.step();
    if (tick % 10 === 9) {
      for (const b of bodies) {
        const p = b.translation();
        poses.push(p.x, p.y, b.rotation());
      }
    }
  }
  world.free();
  return hashText(JSON.stringify(poses));
}

export function probeDigests(rapier: RapierModule): ProbeDigests {
  return { script: scriptDigest(rapier), fuzz: fuzzDigest(rapier), pile: pileDigest(rapier) };
}

/** Every build this runtime can load, with its digests. */
export async function runDeterminismProbe(
  flavours: readonly Flavour[] = ["rapier2d", "rapier2d-compat", "rapier2d-deterministic-compat"],
): Promise<Partial<Record<Flavour, ProbeDigests>>> {
  const out: Partial<Record<Flavour, ProbeDigests>> = {};
  for (const flavour of flavours) {
    const rapier = await loadFlavour(flavour);
    if (rapier) out[flavour] = probeDigests(rapier);
  }
  return out;
}

if ((import.meta as { main?: boolean }).main) {
  const digests = await runDeterminismProbe(["rapier2d-compat", "rapier2d-deterministic-compat"]);
  console.log(
    JSON.stringify(
      {
        platform: `${process.platform}-${process.arch}`,
        runtime: `bun ${process.versions.bun}`,
        digests,
      },
      null,
      2,
    ),
  );
}
