import type { ProjectApplyResult, ProjectOpBatch } from "@jams/engine/project";
import { applyOps, describeChange, type OpBatch, type SceneOp } from "@jams/engine/scene";
import { applyProjectBatchToFiles, type FileProject } from "@jams/engine/vite";

import { failure, issueLine, loadScene, readArg, usage, UsageError, type Tool } from "../context";
import { overlayMaterials, scanProject, type ProjectHandle } from "../projects";

export type ApplyInput = { scene?: string; ops?: string; dryRun?: boolean; base?: string };

/** Reports name the scene hash `sceneHash`, as every other command does. */
function renameHash<T extends { hash: string }>({ hash, ...rest }: T) {
  return { ...rest, sceneHash: hash };
}

/** The project as a file batch sees it: its material assets as their files hold them now. */
async function fileProject(project: ProjectHandle): Promise<FileProject> {
  const registry = await overlayMaterials(project, project.registry, await scanProject(project));
  return { ...project, registry };
}

/**
 * Applies a batch to a scene's file. The batch is tried with `applyOps`
 * (its `base` is the scene hash; stale exits 3), then applied as one
 * `editScene` project op through `applyProjectBatchToFiles`, the way the dev
 * server applies it live: prefab ops follow the project's id, path and trash
 * rules and write sidecars and the registry. `--dry-run` runs that project
 * batch in memory too, so it reports what the write would refuse. A batch
 * that would leave error-severity issues writes nothing.
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

  const result = applyOps(loaded.def, batch, loaded.registry, { prefabs: loaded.prefabs });
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
    const files = await fileProject(loaded.scene.project);
    const applied = await applyProjectBatchToFiles(files, projectBatch, { dryRun: !write });
    if (!applied.ok) return refused(loaded.name, rest.sceneHash, applied);
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

/** A batch the scene accepts but the project refuses (an id or path another asset holds). */
function refused(
  scene: string,
  sceneHash: string,
  applied: Extract<ProjectApplyResult, { ok: false }>,
) {
  return {
    exitCode: 1 as const,
    data: { ok: false, scene, sceneHash, issue: applied.issue, written: false },
    text: [`${scene}: not applied`, issueLine(applied.issue)].join("\n"),
  };
}
