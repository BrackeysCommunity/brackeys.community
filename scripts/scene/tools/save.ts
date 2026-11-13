import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, matchesGlob, relative, sep } from "node:path";

import {
  formatSaveFile,
  SLOT_PATTERN,
  SLOT_RULE,
  type SaveDepth,
  type SaveFile,
} from "@jams/engine/game";
import { captureSave, runPlaytest, type SaveBlocker } from "@jams/engine/headless";
import {
  projectPathMatcher,
  SAVE_KIND,
  SAVE_SUFFIX,
  sha256,
  type ProjectOp,
  type Sha256,
} from "@jams/engine/project";
import { MAX_SCRIPT_TICKS, type SceneIssue } from "@jams/engine/scene";

import {
  failure,
  issueLine,
  openScene,
  projectOfFile,
  usage,
  type Tool,
  type ToolContext,
  type ToolResult,
} from "../context";
import { putBlob } from "../hosted";
import { projectRuntime, scanProject, type ProjectHandle } from "../projects";
import { runProjectBatch } from "./assets-apply";
import { projectSceneLibrary } from "./flow";
import { blockedResult, projectRef, readPlaytestScript } from "./playtest";
import { rapierFor } from "./step";

export type SaveInput = {
  scene?: string;
  script?: string;
  /** The tick to save at: the script runs this many simulated ticks first. */
  at?: string;
  /** The fixture to write, `<slot>.save.json`. */
  out?: string;
  depth?: string;
  /** `meta.savedAt` in epoch ms, as the flag's text or a number; default 0, so a fixture's bytes depend only on the run. */
  now?: string | number;
  /** Follow flow requests through the project's scene list, so the save holds the scene, entry and persist the run reached. */
  flow?: boolean;
};

const USAGE =
  "save <scene|file> --script <file|-> --at <tick> --out <file>.save.json [--depth world|progress] [--now ms] [--flow]";

const DEPTHS: readonly SaveDepth[] = ["world", "progress"];

/** `save-unsupported`'s causes, as `worldSaveBlockers` named them. */
function causesOf(issue: SceneIssue): SaveBlocker[] {
  const causes = (issue.detail as { causes?: unknown } | undefined)?.causes;
  return Array.isArray(causes) ? (causes as SaveBlocker[]) : [];
}

function refused(scene: string, issue: SceneIssue): ToolResult {
  const causes = causesOf(issue);
  return {
    exitCode: 1,
    data: { ok: false, scene, issue, ...(causes.length > 0 ? { causes } : {}) },
    text: [
      `${scene}: can't save`,
      issueLine(issue),
      ...causes.map((c) => `    cause ${c.cause}: ${c.message}`),
    ].join("\n"),
  };
}

/**
 * The project's save fixtures as their files hold them now, by the hash of
 * their bytes: what a replay of a run that began from a save finds its
 * fixture in (`ReplayOptions.saves`). A file that can't be read is left out.
 */
export async function projectSaveFixtures(project: ProjectHandle): Promise<Map<Sha256, string>> {
  const { state } = await scanProject(project);
  const out = new Map<Sha256, string>();
  for (const entry of Object.values(state.assets)) {
    if (entry.kind !== SAVE_KIND || entry.deleted !== undefined) continue;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(join(project.dir, ...entry.path.split("/"))));
    } catch {
      continue;
    }
    out.set(await sha256(bytes), new TextDecoder().decode(bytes));
  }
  return out;
}

/**
 * The fixture's path in `project`, with `/` separators; null when it isn't
 * one of the project's assets (outside its directory or asset globs, or a
 * test path such as `__tests__/fixtures/`).
 */
function pathIn(project: ProjectHandle, file: string): string | null {
  const rel = relative(project.dir, file);
  if (rel === "" || rel.startsWith("..")) return null;
  const path = rel.split(sep).join("/");
  return projectPathMatcher(project.file, matchesGlob).isAsset(path) ? path : null;
}

/**
 * Writes the fixture's bytes. Inside a project it goes through the
 * project's writer as any binary asset does: a new path is an
 * `importAsset` (file, sidecar and registry entry), an existing save
 * fixture's a `replaceContent`. Anywhere else it is a plain file.
 */
async function writeFixture(
  ctx: ToolContext,
  out: string,
  bytes: Uint8Array,
): Promise<{ ok: true; project: string | null } | { ok: false; result: ToolResult }> {
  const project = projectOfFile(ctx, out);
  const path = project ? pathIn(project, out) : null;
  if (!project || path === null) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, bytes);
    return { ok: true, project: null };
  }
  const written = await runProjectBatch(
    { ...ctx, project: project.file.id },
    {},
    {
      async build({ view, store }) {
        const sha = await putBlob(store, bytes, {
          kind: SAVE_KIND,
          contentType: "application/json",
        });
        const existing = view.byPath.get(path);
        const op: ProjectOp =
          existing?.kind === SAVE_KIND
            ? { op: "replaceContent", id: existing.id, sha256: sha, bytes: bytes.byteLength }
            : { op: "importAsset", path, sha256: sha, bytes: bytes.byteLength, kind: SAVE_KIND };
        return { v: 1, label: `Save ${basename(out)}`, ops: [op] };
      },
    },
  );
  if (written.exitCode !== 0) return { ok: false, result: written };
  return { ok: true, project: project.file.id };
}

/**
 * Runs an input script on a scene headless to tick `--at` and writes a
 * save fixture there (`captureSave`, `formatSaveFile`): world depth by
 * default, refused as `save-unsupported` with each cause `worldSaveBlockers`
 * names; progress depth on request. The slot is the file's stem. A run that
 * ends before the tick saves nothing. With `flow` the run follows flow
 * requests through the project's scene list, as `playtest --flow` does, and
 * the save is of the scene it is in at the tick.
 */
export const save: Tool<SaveInput> = async (input, ctx) => {
  if (!input.script || !input.out || input.at === undefined) return usage(`scene ${USAGE}`);
  const at = Number(input.at);
  if (!Number.isInteger(at) || at < 1 || at > MAX_SCRIPT_TICKS)
    return usage(`--at takes a tick from 1 to ${MAX_SCRIPT_TICKS}; got ${input.at}`);
  const depth = (input.depth ?? "world") as SaveDepth;
  if (!DEPTHS.includes(depth))
    return usage(`--depth is world or progress; got ${JSON.stringify(input.depth)}`);
  const now =
    typeof input.now === "string"
      ? /^\d+$/.test(input.now)
        ? Number(input.now)
        : Number.NaN
      : (input.now ?? 0);
  if (!Number.isSafeInteger(now) || now < 0)
    return usage(`--now takes a time in epoch milliseconds, 0 or more; got ${input.now}`);
  const name = basename(input.out);
  if (!name.endsWith(SAVE_SUFFIX))
    return usage(`--out names a save fixture, <slot>${SAVE_SUFFIX}; got ${name}`);
  const slot = name.slice(0, -SAVE_SUFFIX.length);
  if (!SLOT_PATTERN.test(slot))
    return usage(
      `--out's name before ${SAVE_SUFFIX} is the save's slot: ${SLOT_RULE}; got ${JSON.stringify(slot)}`,
    );

  const loaded = await openScene(ctx, input.scene, USAGE);
  if (!loaded.ok) return loaded.result;
  const { registry } = loaded;
  const read = await readPlaytestScript(ctx, input.script, loaded.def.name, registry);
  if (!read.ok) return read.result;

  let flow;
  if (input.flow) {
    if (!loaded.project)
      return usage("--flow follows the scene list of the scene's project; this scene is in none");
    const library = await projectSceneLibrary(ctx, loaded.project);
    if (!library)
      return failure(`project "${loaded.project.file.id}" has no scene list for --flow to follow`);
    flow = library;
  }

  const project = loaded.project ? await projectRuntime(loaded.project, registry) : null;
  let captured: ReturnType<typeof captureSave> | null = null;
  const run = runPlaytest({
    rapier: await rapierFor(ctx, loaded.def, registry, project?.engine),
    game: registry.game,
    registry,
    scene: loaded.def,
    prefabs: loaded.prefabs,
    project,
    script: { ...read.script, maxTicks: at },
    projectRef: projectRef(loaded.project),
    ...(flow ? { flow } : {}),
    onEnd: (runtime) => {
      captured = captureSave(runtime, { depth, slot, now });
    },
  });
  const game = registry.game?.id ?? null;
  if (run.blocked) return blockedResult(run, game);
  if (run.ticks < at) {
    const o = run.outcome;
    return failure(
      `the run ended as ${o.result} at tick ${o.tick}${o.cause ? ` (${o.cause})` : ""}, before --at ${at}; nothing was saved`,
      { scene: loaded.name, outcome: o, ticks: run.ticks },
    );
  }
  const result = captured as ReturnType<typeof captureSave> | null;
  if (!result) return failure(`${loaded.name}: the run ended without a world to save`);
  if (!result.ok) return refused(loaded.name, result.issue);

  const file: SaveFile = result.file;
  const bytes = new TextEncoder().encode(formatSaveFile(file));
  const written = await writeFixture(ctx, input.out, bytes);
  if (!written.ok) return written.result;
  const hash = await sha256(bytes);
  return {
    exitCode: 0,
    data: {
      ok: true,
      game,
      scene: file.scene.id,
      ...(file.scene.entry !== undefined ? { entry: file.scene.entry } : {}),
      slot,
      depth: file.depth,
      tick: at,
      out: input.out,
      project: written.project,
      sha256: hash,
      bytes: bytes.byteLength,
    },
    text: `${file.scene.id}: saved ${file.depth} at t${at} to ${input.out} (slot ${slot}, ${bytes.byteLength} B, sha256 ${hash.slice(0, 12)})`,
  };
};
