import { vi } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import type { GameDefinition } from "../../game/types";
import { runPlaytest } from "../../headless/playtest";
import type { InputScript, PlaytestReport } from "../../headless/playtest-types";
import { replayRecording, type ReplayReport } from "../../headless/recording";
import { scenePhysics } from "../../scene/expand";
import { hashText } from "../../scene/hash";
import type { PrefabLibrary, SceneDefinition, SceneSettings } from "../../scene/types";
import type { RapierModule } from "../../types";
import { loadCompatRapier } from "../fixtures/compat-rapier";

/** Plan 53's matrix rows, by id; matrix.ts maps each to the milestones that deliver it. */
export type GenreRow =
  | "platformer"
  | "top-down"
  | "twin-stick"
  | "puzzle"
  | "card-board"
  | "tactics"
  | "visual-novel"
  | "racing"
  | "physics-sandbox"
  | "rts"
  | "tower-defense"
  | "rhythm"
  | "roguelike"
  | "metroidvania"
  | "point-and-click"
  | "idle"
  | "endless-runner"
  | "fighting"
  | "local-multiplayer"
  | "online-multiplayer";

/** Another run of a probe: settings over the scene's own, and the seed `ctx.random` gets. */
export type ProbeVariant = {
  name: string;
  settings?: Partial<SceneSettings>;
  /** Overrides the script's `seed` (`PlayOptions.seed`); omitted, the script's or the default. */
  seed?: number | string;
};

export type GenreProbe<S = unknown> = {
  id: string;
  rows: readonly GenreRow[];
  /** Needs of those rows not yet delivered, with the milestone that will. */
  pending?: Partial<Record<GenreRow, string>>;
  game: GameDefinition<S>;
  /** Built in code from primitives and the probe's own types. */
  scene: SceneDefinition;
  /** Every prefab the run may place: the scene's instances and `ctx.instantiate` both draw on it. */
  prefabs?: PrefabLibrary;
  script: InputScript;
  expect: { result: string; maxTicks?: number };
  /** Settings the probe also runs under; the sweep needs gravity zero, sideways and physics none covered. */
  variants?: readonly ProbeVariant[];
  /** How long one run (play and replay) may take in a test; default `PROBE_TIMEOUT_MS`. */
  timeoutMs?: number;
};

export type ProbeRun = {
  report: PlaytestReport;
  replay: ReplayReport;
  digest: string;
  /** Whether a Rapier module was ever handed to the run. */
  usedRapier: boolean;
};

/** The name pins.ts files a probe's run without a variant under. */
export const DEFAULT_VARIANT = "default";

/** A probe run's test timeout when the probe names none. */
export const PROBE_TIMEOUT_MS = 60_000;

/** The test timeout for each of a probe's runs. */
export function probeTimeout(probe: GenreProbe): number {
  return probe.timeoutMs ?? PROBE_TIMEOUT_MS;
}

let compat: Promise<RapierModule> | null = null;

/** Loads the `-compat` Rapier build once; a spy, so a file can assert it never ran. */
export const loadRapier = vi.fn(() => (compat ??= loadCompatRapier()));

/** The probe's scene with the variant's settings over its own. */
export function variantScene(probe: GenreProbe, variant?: ProbeVariant): SceneDefinition {
  if (!variant?.settings) return probe.scene;
  return { ...probe.scene, settings: { ...probe.scene.settings, ...variant.settings } };
}

/** The backend a probe's run resolves to, before anything loads. */
export function probePhysics(probe: GenreProbe, variant?: ProbeVariant): "rapier" | "none" {
  const registry = createRegistry(probe.game as GameDefinition);
  return scenePhysics(variantScene(probe, variant), registry);
}

/** The probe's script with the variant's seed over its own. */
export function variantScript(probe: GenreProbe, variant?: ProbeVariant): InputScript {
  if (variant?.seed === undefined) return probe.script;
  return { ...probe.script, seed: variant.seed };
}

/** What a run is pinned by: how it ended, what it emitted, and the game's end state. */
function runDigest(report: PlaytestReport): string {
  return hashText(
    JSON.stringify([
      report.outcome,
      report.ticks,
      report.slots,
      report.recording.end,
      report.events,
      report.trail.pts,
    ]),
  );
}

function blockedMessage(
  what: string,
  run: { stage: string; issues: unknown; scriptIssues: unknown },
) {
  return `${what} blocked at ${run.stage}: ${JSON.stringify({ issues: run.issues, scriptIssues: run.scriptIssues })}`;
}

/**
 * Plays a probe headless (under a variant's settings and seed when given),
 * replays its recording, and digests the run. The probe's prefabs go to both
 * runs as the scene's and as the library `ctx.instantiate` draws on. Rapier is
 * loaded only when the scene's physics resolves to it; a physics-free run
 * gets `rapier: null`.
 */
export async function runGenreProbe<S>(
  probe: GenreProbe<S>,
  variant?: ProbeVariant,
): Promise<ProbeRun> {
  const p = probe as GenreProbe;
  const scene = variantScene(p, variant);
  const rapier = probePhysics(p, variant) === "none" ? null : await loadRapier();
  const label = `${probe.id} ${variant?.name ?? DEFAULT_VARIANT}`;

  const report = runPlaytest({
    rapier,
    game: p.game,
    scene,
    prefabs: p.prefabs,
    library: p.prefabs,
    script: variantScript(p, variant),
  });
  if (report.blocked) throw new Error(blockedMessage(`${label}: the playtest`, report));

  const replay = replayRecording({
    rapier,
    game: p.game,
    scene,
    prefabs: p.prefabs,
    library: p.prefabs,
    recording: report.recording,
  });
  if (replay.blocked) throw new Error(blockedMessage(`${label}: the replay`, replay));

  return {
    report: report as PlaytestReport,
    replay: replay as ReplayReport,
    digest: runDigest(report as PlaytestReport),
    usedRapier: rapier !== null,
  };
}

function isProbe(value: unknown): value is GenreProbe {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<GenreProbe>;
  return (
    typeof p.id === "string" &&
    Array.isArray(p.rows) &&
    !!p.game &&
    !!p.scene &&
    !!p.script &&
    typeof p.expect === "object"
  );
}

/**
 * The probes a `*.probe.ts` glob found, sorted by id: every exported probe of
 * each module. Throws on a duplicate id or a variant named twice or
 * `default`, since pins.ts files runs by those names.
 */
export function probesFrom(modules: Record<string, Record<string, unknown>>): GenreProbe[] {
  const probes = [
    ...new Set(Object.values(modules).flatMap((mod) => Object.values(mod).filter(isProbe))),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const [i, probe] of probes.entries()) {
    if (probes[i - 1]?.id === probe.id) throw new Error(`two genre probes are named ${probe.id}`);
    const names = new Set<string>([DEFAULT_VARIANT]);
    for (const v of probe.variants ?? []) {
      if (names.has(v.name)) throw new Error(`${probe.id}: variant name ${v.name} is taken`);
      names.add(v.name);
    }
  }
  return probes;
}

/** A probe's runs: its default, then each variant in order. */
export function probeRuns(probe: GenreProbe): { name: string; variant?: ProbeVariant }[] {
  return [
    { name: DEFAULT_VARIANT },
    ...(probe.variants ?? []).map((v) => ({ name: v.name, variant: v })),
  ];
}
