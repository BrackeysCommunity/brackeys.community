import { applyOps, describeChange, formatScene, type OpBatch } from "@jams/engine/scene";

import {
  failure,
  issueLine,
  loadScene,
  readArg,
  usage,
  UsageError,
  writeSceneText,
  type Tool,
} from "../context";

export type ApplyInput = { scene?: string; ops?: string; dryRun?: boolean; base?: string };

/** Reports name the scene hash `sceneHash`, as every other command does. */
function renameHash<T extends { hash: string }>({ hash, ...rest }: T) {
  return { ...rest, sceneHash: hash };
}

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

  const result = applyOps(loaded.def, batch);
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

  const { def, ...rest } = renameHash(result);
  const errors = result.issues.filter((i) => i.severity === "error");
  const write = !input.dryRun && errors.length === 0;
  if (write) await writeSceneText(ctx, loaded.name, formatScene(def).text);

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
