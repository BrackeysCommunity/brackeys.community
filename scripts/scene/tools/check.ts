import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Registry } from "@jams/engine/game";
import { runChecks, type CheckResult } from "@jams/engine/headless";
import { projectView, type ProjectRuntimeView, type ProjectView } from "@jams/engine/project";
import {
  checksPathOf,
  closest,
  parseChecks,
  type ChecksFile,
  type SceneIssue,
} from "@jams/engine/scene";

import {
  failure,
  gameFlag,
  isFileArg,
  isToolResult,
  locateScene,
  openScene,
  usage,
  type Tool,
  type ToolContext,
  type ToolResult,
} from "../context";
import { projectRuntime, scanProject } from "../projects";
import { shownPath } from "./game-manifest";
import { rapierFor } from "./step";

export type CheckInput = { scene?: string; checks?: string; only?: string; game?: string };

const USAGE = "check <scene|file> [--checks file] [--only id] [--game id]";

/** The checks file a scene's checks come from: `--checks`, else `<scene>.checks.json` beside it. */
async function checksFileFor(
  ctx: ToolContext,
  scene: string,
  flag: string | undefined,
): Promise<string | { result: ToolResult }> {
  if (flag !== undefined) return resolve(flag);
  if (isFileArg(scene)) return checksPathOf(resolve(scene));
  const located = await locateScene(ctx, scene);
  return located.ok ? checksPathOf(located.scene.file) : { result: located.result };
}

function resultLine(r: CheckResult): string {
  const mark = r.skipped !== undefined ? "skip" : r.pass ? "pass" : "FAIL";
  return `  ${mark} ${r.id} (${r.kind}) ${r.message}`;
}

/** Runs a scene's `.checks.json`; exit 1 when a check fails. */
export const check: Tool<CheckInput> = async (input, ctx) => {
  const { scene } = input;
  if (!scene || scene === "-") return usage(`scene ${USAGE}`);
  const under = input.game === undefined ? undefined : gameFlag(ctx, input.game);
  if (isToolResult(under)) return under;
  const loaded = await openScene(ctx, scene, USAGE, under);
  if (!loaded.ok) return loaded.result;
  const { registry, def } = loaded;
  const game = registry.game?.id ?? null;

  const file = await checksFileFor(ctx, scene, input.checks);
  if (typeof file !== "string") return file.result;
  const shown = shownPath(file);
  const read = await readChecksFile(file, registry, { scene, game });
  if (read === null) return failure(`No checks file at ${shown}.`, { checks: file });
  if (isToolResult(read)) return read;

  let checks = read.file.checks;
  if (input.only !== undefined) {
    const ids = checks.map((c) => c.id);
    checks = checks.filter((c) => c.id === input.only);
    if (checks.length === 0) {
      const guess = closest(input.only, ids);
      return usage(
        `--only: no check ${JSON.stringify(input.only)}${guess ? `; did you mean "${guess}"?` : ""} (checks: ${ids.join(", ") || "none"})`,
      );
    }
  }

  let project: ProjectRuntimeView | null = null;
  let view: ProjectView | undefined;
  if (loaded.project) {
    const scan = await scanProject(loaded.project);
    project = await projectRuntime(loaded.project, registry, scan);
    view = projectView(scan.state, loaded.project.kinds);
  }
  const report = runChecks({
    rapier: await rapierFor(ctx, def, registry, project?.engine),
    project,
    ...(view ? { view } : {}),
    scene: def,
    prefabs: loaded.prefabs,
    registry,
    checks: { ...read.file, checks },
    readFile: read.readFile,
  });
  const failed = report.results.filter((r) => !r.pass).length;
  const skipped = report.results.filter((r) => r.skipped !== undefined).length;
  const passed = report.results.length - failed - skipped;
  const runs = game ? `game ${game}` : "no game";
  return {
    exitCode: report.ok ? 0 : 1,
    data: { ok: report.ok, scene, game, checks: file, results: report.results },
    text: [
      `${def.name} ${runs}: ${passed} passed, ${failed} failed, ${skipped} skipped (${shown})`,
      ...report.results.map(resultLine),
    ].join("\n"),
  };
};

/** A parsed checks file and the reader for the files it names, relative to it. */
export type ReadChecks = { file: ChecksFile; readFile: (path: string) => string };

/**
 * The checks file at `file` parsed for `registry`, with a reader that
 * resolves the paths it names beside it; null when there is no file. One
 * that doesn't read is the failing result, its data carrying `data`.
 */
export async function readChecksFile(
  file: string,
  registry: Registry,
  data: Record<string, unknown> = {},
): Promise<ReadChecks | ToolResult | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return null;
    throw e;
  }
  const parsed = parseChecks(text, registry);
  if (!parsed.ok)
    return {
      exitCode: 1,
      data: { ok: false, ...data, checks: file, issues: parsed.issues },
      text: checksFileLines(shownPath(file), parsed.issues).join("\n"),
    };
  const dir = dirname(file);
  return { file: parsed.file, readFile: (path) => readFileSync(resolve(dir, path), "utf8") };
}

/** A checks file that doesn't read, as the CLI prints it: the file, then each issue with its line and hint. */
function checksFileLines(
  shown: string,
  issues: readonly Pick<SceneIssue, "path" | "line" | "message" | "hint">[],
): string[] {
  return [
    `${shown}: invalid checks file`,
    ...issues.map(
      (i) =>
        `  error ${i.path || "/"}${i.line !== undefined ? `:${i.line}` : ""} ${i.message}${i.hint ? `\n    hint: ${i.hint}` : ""}`,
    ),
  ];
}
