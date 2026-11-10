import {
  PREFAB_SCENE_OPS,
  projectView,
  type ProjectApplyResult,
  type ProjectOpBatch,
} from "@jams/engine/project";
import {
  applyOps,
  describeChange,
  sceneHash,
  type OpBatch,
  type SceneOp,
} from "@jams/engine/scene";
import { applyProjectBatchToFiles } from "@jams/engine/vite";

import { failure, issueLine, loadScene, readArg, usage, UsageError, type Tool } from "../context";
import { scanProject, withLiveMaterials } from "../projects";

export type ApplyInput = { scene?: string; ops?: string; dryRun?: boolean; base?: string };

/** Reports name the scene hash `sceneHash`, as every other command does. */
function renameHash<T extends { hash: string }>({ hash, ...rest }: T) {
  return { ...rest, sceneHash: hash };
}

/**
 * Applies a batch to a scene's file. The batch is tried with `applyOps`
 * (its `base` is the scene hash; stale exits 3), then applied as one
 * `editScene` project op through `applyProjectBatchToFiles`, the way the dev
 * server applies it live: prefab ops follow the project's id, path and trash
 * rules and write sidecars and the registry. `--dry-run` runs that project
 * batch in memory too, so it reports what the write would refuse. The trial
 * judges asset ids and sprite frames against the scene's project, as
 * `validate` does. A batch that would leave error-severity issues writes
 * nothing.
 */
export const apply: Tool<ApplyInput> = async (input, ctx) => {
  if (!input.ops) return usage("scene apply <scene> --ops <file|-> [--dry-run] [--base hash]");
  const loaded = await loadScene(ctx, input.scene, "apply --ops <file|->");
  if (!loaded.ok) return loaded.result;

  let batch: OpBatch;
  try {
    batch = JSON.parse(await readArg(ctx, input.ops)) as OpBatch;
  } catch (e) {
    if (e instanceof UsageError) return usage(e.message);
    if ((e as { code?: string }).code === "ENOENT") return failure(`Not found: ${input.ops}.`);
    return failure(`--ops is not JSON: ${(e as Error).message}`);
  }
  if (input.base && batch && typeof batch === "object" && !("base" in batch)) {
    batch = { ...batch, base: input.base };
  }

  const home = loaded.scene.project;
  const project = projectView((await scanProject(home)).state, home.kinds);
  const result = applyOps(loaded.def, batch, loaded.registry, {
    prefabs: loaded.prefabs,
    project,
  });
  if (!result.ok) {
    return {
      exitCode: result.issue.code === "stale-base" ? 3 : 1,
      data: { ...renameHash(result), scene: loaded.name, written: false },
      text: [
        `${loaded.name}: op ${result.failedAt} failed (scene ${result.hash})`,
        issueLine(result.issue),
      ].join("\n"),
    };
  }

  const { def: _def, prefabs: _prefabs, ...rest } = renameHash(result);
  const errors = result.issues.filter((i) => i.severity === "error");
  const write = !input.dryRun && errors.length === 0;
  if (errors.length === 0) {
    const projectBatch: ProjectOpBatch = {
      v: 1,
      ...(batch.label ? { label: batch.label } : {}),
      ops: [{ op: "editScene", id: loaded.name, ops: batch.ops as SceneOp[] }],
    };
    const files = await withLiveMaterials(loaded.scene.project);
    const applied = await applyProjectBatchToFiles(files, projectBatch, { dryRun: !write });
    if (!applied.ok)
      return refused(loaded.name, sceneHash(loaded.def), batch.ops as SceneOp[], applied);
  }

  const verb = input.dryRun ? "would change" : write ? "changed" : "not written (errors)";
  const lines = [
    `${loaded.name}: ${verb}, ${result.diff.length} ${result.diff.length === 1 ? "change" : "changes"}, hash ${result.hash}`,
    ...result.diff.map((c) => `  ${describeChange(c)}`),
    ...(result.created.length > 0 ? [`  created ${result.created.join(", ")}`] : []),
    ...result.issues.map(issueLine),
  ];
  return {
    exitCode: errors.length > 0 ? 1 : 0,
    data: { ...rest, scene: loaded.name, dryRun: Boolean(input.dryRun), written: write },
    text: lines.join("\n"),
  };
};

/**
 * The scene op a project refusal answers: the prefab op naming an asset the
 * issue names, else the first prefab op, else the first op.
 */
function refusedAt(ops: readonly SceneOp[], issue: { entityIds?: readonly string[] }): number {
  const prefabOps = ops.flatMap((op, i) => (PREFAB_SCENE_OPS.includes(op.op) ? [i] : []));
  const named = prefabOps.find((i) => {
    const op = ops[i]!;
    return "id" in op && typeof op.id === "string" && (issue.entityIds ?? []).includes(op.id);
  });
  return named ?? prefabOps[0] ?? 0;
}

/**
 * A batch the scene accepts but the project refuses (an id or path another
 * asset holds, a prefab still in use): `sceneHash` is the unchanged file's.
 */
function refused(
  scene: string,
  sceneHash: string,
  ops: readonly SceneOp[],
  applied: Extract<ProjectApplyResult, { ok: false }>,
) {
  const failedAt = refusedAt(ops, applied.issue);
  return {
    exitCode: 1 as const,
    data: { ok: false, failedAt, issue: applied.issue, scene, sceneHash, written: false },
    text: [
      `${scene}: op ${failedAt} not applied (scene ${sceneHash})`,
      issueLine(applied.issue),
    ].join("\n"),
  };
}
