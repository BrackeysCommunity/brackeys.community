import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_BUILD_TARGET,
  DEFAULT_ZIP_TARGET,
  exportTargetNames,
  formatBytes,
  planContent,
  type ExportInput,
  type ExportPlan,
} from "@jams/engine/export";
import { createRegistry, withProject } from "@jams/engine/game";
import {
  gameSettingsEntries,
  projectView,
  RELEASE_FILE,
  releaseId,
  type ReleaseManifest,
  type ReleaseTarget,
} from "@jams/engine/project";
import { closest, type SceneIssue } from "@jams/engine/scene";
import { createExportBuild, fileContentStore, snapshotFiles } from "@jams/engine/vite";
import wasm from "vite-plugin-wasm";
import { build, type Plugin } from "vite-plus";

import { engineBundleReport } from "../../engine-bundle-report";
import {
  failure,
  issueLine,
  usage,
  type Tool,
  type ToolContext,
  type ToolResult,
} from "../context";
import { ensurePackedEngine } from "../engine-dist";
import { projectById, type ProjectHandle } from "../projects";
import { manifestSummary, shownPath } from "./game-manifest";
import { loadProject, problemLines } from "./project-show";

export type GameBuildInput = {
  id?: string;
  /** Any release target; one with no `EXPORT_TARGETS` row is `export-target-unsupported`. Default `DEFAULT_BUILD_TARGET`. */
  target?: string;
  /** Default `dist/games/<id>/<target>`. */
  out?: string;
  rapier?: string;
  allowOverBudget: boolean;
};

/** `--target` lists the targets this engine builds, so it grows with the table. */
export const targetFlag = (fallback?: string) => {
  const names = exportTargetNames();
  const ordered = fallback ? [fallback, ...names.filter((n) => n !== fallback)] : names;
  return `[--target ${ordered.join("|")}]`;
};

export const GAME_BUILD_USAGE = `game build <id> ${targetFlag()} [--out dist/games/<id>/<target>] [--rapier standard|compat] [--allow-over-budget]`;

/** The target `game export --zip` builds when none is given. */
export const ZIP_TARGET = DEFAULT_ZIP_TARGET;

const RAPIER_FLAVOURS = ["standard", "compat"] as const;
type RapierFlavour = (typeof RAPIER_FLAVOURS)[number];

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Vite's dependency cache for export builds, apart from the site's `node_modules/.vite`. */
const CACHE_DIR = join(REPO_ROOT, "node_modules", ".vite-game-build");

/** Where `game build <id>` writes when `--out` is left out, relative to the working directory. */
export const defaultBuildOut = (id: string, target: string) => join("dist", "games", id, target);

/** The bundle report (`engineBundleReport`) of a build at `out`: beside it, never inside, so it never ships. */
export const bundleReportDir = (out: string) => `${resolve(out)}.bundle-report`;

const isError = (i: SceneIssue) => i.severity === "error";

/** What a build ships of Rapier, as the summary's wasm line and as data. */
export type WasmReport = {
  line: string;
  data: {
    bytes: number;
    package: string | null;
    version: string | null;
    /** `-compat` carries its wasm inside the code, so `bytes` is 0 and the code is larger. */
    inlined: boolean;
    scenes: string[];
  };
};

/**
 * The wasm line, printed either way: the bytes are the budget's measured
 * `wasmBytes`, the scenes those the manifest records as Rapier.
 */
export function wasmOf(m: ReleaseManifest): WasmReport {
  const bytes = m.budget.measured.wasmBytes;
  const scenes = m.flow.scenes.filter((s) => s.physics === "rapier").map((s) => s.id);
  const rapier = m.build.rapier;
  if (!rapier)
    return {
      line: `wasm: ${formatBytes(bytes)} (no listed scene uses Rapier)`,
      data: { bytes, package: null, version: null, inlined: false, scenes },
    };
  const inlined = rapier.file === null;
  const where = inlined ? ` inlined in the code (${formatBytes(rapier.bytes)})` : "";
  return {
    line: `wasm: ${formatBytes(bytes)} (${rapier.package} ${rapier.version}${where}, scenes: ${scenes.join(", ")})`,
    data: { bytes, package: rapier.package, version: rapier.version, inlined, scenes },
  };
}

/** A finished build: where it is and what it holds. */
export type BuiltGame = {
  project: ProjectHandle;
  out: string;
  report: string;
  plan: ExportPlan;
  release: string;
};

/** A build's outcome: the tool result, and the build when one was written. */
export type GameBuildOutcome = { result: ToolResult; built: BuiltGame | null };

function projectOf(
  ctx: ToolContext,
  id: string | undefined,
  cmd: string,
): ProjectHandle | ToolResult {
  const known = ctx.projects.map((p) => p.file.id);
  const list = `(projects: ${known.join(", ") || "none"})`;
  if (id === undefined) return usage(`${cmd} <id> ${list}`);
  const found = projectById(ctx.projects, id);
  if (found) return found;
  const guess = closest(id, known);
  return usage(
    `${cmd}: no project ${JSON.stringify(id)}${guess ? `; did you mean "${guess}"?` : ""} ${list}`,
  );
}

/**
 * The project's files as an export plans them: its view (with this code's
 * schema hashes as the build stamps, so the release pins what
 * `project snapshot` pins), canonical doc texts, the registry with its
 * materials and asset choices, the game-settings `engine` block and the
 * snapshot. A doc that doesn't parse can't be pinned, so it fails here.
 */
export async function exportInputOf(
  project: ProjectHandle,
  target: ReleaseTarget,
): Promise<ExportInput | ToolResult> {
  const game = project.game;
  if (!game)
    return failure(`${project.file.id} has no game module; only a game's project builds`, {
      project: project.file.id,
    });
  const loaded = await loadProject(project);
  const unpinned = [...loaded.view.byId.values()].filter(
    (e) => e.sha256 === undefined && !loaded.texts.has(e.id),
  );
  if (unpinned.length > 0) {
    const paths = new Set(unpinned.map((e) => e.path));
    const why = loaded.problems.filter((p) => paths.has(p.path));
    const result = failure(
      `${project.file.id}: ${unpinned.map((e) => `"${e.id}" (${e.path})`).join(", ")} can't ship: no canonical text or content hash`,
      { project: project.file.id, unpinned: unpinned.map((e) => e.id), problems: why },
    );
    return { ...result, text: [result.text, ...problemLines(why, [])].join("\n") };
  }
  const snapshot = await snapshotFiles({ ...project, registry: loaded.registry });
  const build = Object.fromEntries(
    Object.entries(snapshot.build).map(([kind, hash]) => [
      kind,
      { hash, buildAt: 0, engine: snapshot.engine },
    ]),
  );
  const view = projectView({ ...loaded.state, build }, project.kinds);
  const [settings] = gameSettingsEntries(view);
  const block = settings ? (loaded.values.get(settings.id) as { engine?: unknown }) : undefined;
  const engine =
    block?.engine && typeof block.engine === "object"
      ? (block.engine as Record<string, unknown>)
      : {};
  return {
    project: project.file,
    view,
    texts: loaded.texts,
    kinds: project.kinds,
    registry: withProject(createRegistry(game), view, loaded.values),
    game,
    engine,
    target,
    snapshot,
  };
}

/** Empties `out` for a build: refused when it holds files that aren't an earlier build's. */
async function clearOut(out: string): Promise<ToolResult | null> {
  let entries: string[];
  try {
    if (!(await stat(out)).isDirectory())
      return failure(`--out ${shownPath(out)} isn't a directory`);
    entries = await readdir(out);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
  if (entries.length > 0 && !entries.includes(RELEASE_FILE))
    return failure(
      `--out ${shownPath(out)} holds files and no ${RELEASE_FILE}, so it isn't an earlier build; pick an empty or new directory`,
    );
  await rm(out, { recursive: true, force: true });
  return null;
}

/**
 * Builds project `input.id` into `--out`: plans what ships, runs Vite with
 * the export plugin (and `vite-plugin-wasm` when the standard Rapier
 * ships), writes the bundle report beside the output and returns the plan.
 * Planning errors stop it before anything is written; a build whose plan
 * has error issues is written and fails, except `export-over-budget` with
 * `--allow-over-budget`.
 */
export async function buildGame(
  input: GameBuildInput,
  ctx: ToolContext,
  cmd = "game build",
  defaultTarget: string = DEFAULT_BUILD_TARGET,
): Promise<GameBuildOutcome> {
  const fail = (result: ToolResult): GameBuildOutcome => ({ result, built: null });
  const project = projectOf(ctx, input.id, cmd);
  if ("exitCode" in project) return fail(project);
  const id = project.file.id;
  const rapier = (input.rapier ?? project.file.export?.rapier ?? "standard") as RapierFlavour;
  if (!RAPIER_FLAVOURS.includes(rapier))
    return fail(
      usage(`${cmd}: --rapier is ${RAPIER_FLAVOURS.join(" or ")}, not "${input.rapier}"`),
    );
  const target = (input.target ?? defaultTarget) as ReleaseTarget;

  const exportInput = await exportInputOf(project, target);
  if ("exitCode" in exportInput) return fail(exportInput);
  const content = await planContent(exportInput);
  if (content.issues.some(isError)) {
    const issues = [...content.issues];
    return fail({
      exitCode: 1,
      data: { ok: false, project: id, target, issues },
      text: [`${id} ${target}: can't build`, ...issues.map(issueLine)].join("\n"),
    });
  }

  const unpacked = await ensurePackedEngine();
  if (unpacked) return fail(failure(`${id}: ${unpacked}`));

  const out = resolve(input.out ?? defaultBuildOut(id, target));
  const refused = await clearOut(out);
  if (refused) return fail(refused);
  const report = bundleReportDir(out);
  await rm(report, { recursive: true, force: true });

  let plan: ExportPlan | null = null;
  const exportPlugin = createExportBuild({
    input: exportInput,
    modules: {
      game: {
        path: resolve(project.dir, project.file.game!.module),
        export: project.file.game!.export,
      },
      ui: project.file.ui
        ? { path: resolve(project.dir, project.file.ui.module), export: project.file.ui.export }
        : null,
    },
    content: fileContentStore(project.cacheDir),
    rapier,
    onPlan: (p) => (plan = p),
  });
  await mkdir(out, { recursive: true });
  try {
    await build({
      configFile: false,
      root: project.dir,
      base: "./",
      mode: "production",
      // Vite takes DEV and NODE_ENV from the caller's NODE_ENV, not the mode, so
      // a build run under vitest or a dev server would keep dev-only branches.
      define: {
        "import.meta.env.DEV": "false",
        "import.meta.env.PROD": "true",
        "process.env.NODE_ENV": JSON.stringify("production"),
      },
      logLevel: "warn",
      envDir: false,
      cacheDir: join(CACHE_DIR, id),
      // `@jams/engine` resolves as a consumer's install does: through the
      // workspace link to the packed `dist`, never the source. Kept as the
      // link's path so the bundle report names the package, not its folder.
      resolve: { preserveSymlinks: true },
      plugins: [
        ...(content.needsRapier && rapier === "standard" ? [wasm()] : []),
        exportPlugin as unknown as Plugin,
        engineBundleReport({ dir: report }),
      ],
      build: {
        outDir: out,
        emptyOutDir: false,
        target: "es2022",
        assetsInlineLimit: 0,
        reportCompressedSize: false,
        // `-compat` inlines its wasm as base64, so its chunk is a few MB by design.
        chunkSizeWarningLimit: 8192,
      },
    });
  } catch (error) {
    return fail(
      failure(`${id}: the build failed: ${error instanceof Error ? error.message : String(error)}`),
    );
  }
  const finished = plan as ExportPlan | null;
  if (!finished) return fail(failure(`${id}: the export plugin finished no plan`));
  const release = await releaseId(finished.manifest);
  const built: BuiltGame = { project, out, report, plan: finished, release };

  const overBudget = finished.issues.some((i) => i.code === "export-over-budget");
  const blocking = finished.issues.filter(
    (i) => isError(i) && !(input.allowOverBudget && i.code === "export-over-budget"),
  );
  const summary = manifestSummary(finished.manifest);
  const wasmLine = wasmOf(finished.manifest);
  const text = [
    `${id} ${target}: wrote ${shownPath(out)} (release ${release})`,
    ...summary.lines,
    `  ${wasmLine.line}`,
    `  bundle report ${shownPath(report)}`,
    ...finished.issues.map(issueLine),
    ...(overBudget
      ? [
          input.allowOverBudget
            ? "over budget, allowed by --allow-over-budget"
            : "over budget: the build is written but fails; --allow-over-budget accepts it",
        ]
      : []),
  ].join("\n");
  return {
    result: {
      exitCode: blocking.length > 0 ? 1 : 0,
      data: {
        ok: blocking.length === 0,
        project: id,
        target,
        out,
        report,
        release,
        ...summary.data,
        wasm: wasmLine.data,
        overBudget,
        issues: finished.issues,
      },
      text,
    },
    built,
  };
}

/**
 * Builds a project into a static bundle: plans what ships, runs Vite with
 * the export plugin, writes the files and `release.json`, and prints the
 * plan's summary. Exit 1 on an error issue.
 */
export const gameBuild: Tool<GameBuildInput> = async (input, ctx) =>
  (await buildGame(input, ctx)).result;
