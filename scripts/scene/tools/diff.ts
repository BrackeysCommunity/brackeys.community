import {
  applyOps,
  describeChange,
  diffScenes,
  sceneHash,
  type OpBatch,
  type SceneChange,
  type SceneDefinition,
} from "@jams/engine/scene";

import {
  failure,
  gitShow,
  issueLine,
  isFileArg,
  locateScene,
  openScene,
  parseSceneText,
  readArg,
  usage,
  UsageError,
  type Tool,
  type ToolResult,
} from "../context";

export type DiffInput = { a?: string; b?: string; git?: string; ops?: string };

const USAGE = "scene diff <scene|file|-> (<scene|file|-> | --git <rev> | --ops <file|->)";

type Side = { scene: string; sceneHash: string };

function report(from: Side, to: Side, changes: SceneChange[]): ToolResult {
  const lines = [
    `${from.scene} ${from.sceneHash} -> ${to.scene} ${to.sceneHash}: ${changes.length} ${changes.length === 1 ? "change" : "changes"}`,
    ...changes.map((c) => `  ${describeChange(c)}`),
  ];
  return {
    exitCode: 0,
    data: { ok: true, from, to, changed: changes.length > 0, changes },
    text: lines.join("\n"),
  };
}

/** The scene file a name or path stands for, to read it at a git revision. */
async function fileOf(ctx: Parameters<Tool<DiffInput>>[1], arg: string) {
  if (isFileArg(arg)) return { ok: true as const, file: arg };
  const located = await locateScene(ctx, arg);
  return located.ok ? { ok: true as const, file: located.scene.file } : located;
}

/**
 * What changed between two scenes: entities by id (renames detected by
 * content), scene fields and settings, and bulk entries per key. The second
 * side is another scene, the same file at a git revision, or the first
 * scene with an op batch applied (nothing is written).
 */
export const diff: Tool<DiffInput> = async (input, ctx) => {
  const sides = [input.b, input.git, input.ops].filter((s) => s !== undefined);
  if (!input.a || sides.length !== 1) return usage(USAGE);

  const a = await openScene(ctx, input.a, "diff");
  if (!a.ok) return a.result;
  const from: Side = { scene: a.name, sceneHash: sceneHash(a.def) };

  if (input.ops !== undefined) {
    let batch: OpBatch;
    try {
      batch = JSON.parse(await readArg(ctx, input.ops)) as OpBatch;
    } catch (e) {
      if (e instanceof UsageError) return usage(e.message);
      if ((e as { code?: string }).code === "ENOENT") return failure(`Not found: ${input.ops}.`);
      return failure(`--ops is not JSON: ${(e as Error).message}`);
    }
    const result = applyOps(a.def, batch, a.registry, { validate: "none" });
    if (!result.ok) {
      return {
        exitCode: result.issue.code === "stale-base" ? 3 : 1,
        data: { ok: false, from, failedAt: result.failedAt, issue: result.issue },
        text: [`${a.name}: op ${result.failedAt} failed`, issueLine(result.issue)].join("\n"),
      };
    }
    return report(from, { scene: `${a.name}+ops`, sceneHash: result.hash }, result.diff);
  }

  let other: { name: string; def: SceneDefinition };
  if (input.git !== undefined) {
    if (input.a === "-") return usage("scene diff --git needs a scene name or file, not -");
    const file = await fileOf(ctx, input.a);
    if (!file.ok) return file.result;
    let text: string;
    try {
      text = await (ctx.gitShow ?? gitShow)(file.file, input.git);
    } catch (e) {
      const why = (e as { stderr?: string }).stderr?.trim() || (e as Error).message;
      return failure(`git show ${input.git} failed: ${why.split("\n")[0]}`);
    }
    const parsed = await parseSceneText(ctx, `${input.a}@${input.git}`, text);
    if (!parsed.ok) return parsed.result;
    other = parsed;
  } else {
    if (input.a === "-" && input.b === "-") return usage("scene diff: only one side can be -");
    const b = await openScene(ctx, input.b, "diff");
    if (!b.ok) return b.result;
    other = b;
  }

  // With --git the revision is the old side, like `git diff <rev> -- <file>`.
  const [older, newer] =
    input.git !== undefined
      ? [
          { name: other.name, def: other.def },
          { name: a.name, def: a.def },
        ]
      : [{ name: a.name, def: a.def }, other];
  return report(
    { scene: older.name, sceneHash: sceneHash(older.def) },
    { scene: newer.name, sceneHash: sceneHash(newer.def) },
    diffScenes(older.def, newer.def),
  );
};
