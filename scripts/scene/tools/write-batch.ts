import type { OpBatch } from "@jams/engine/scene";

import { failure, hostedOptions, usage, type ToolContext, type ToolResult } from "../context";
import { ProjectClientError, readLiveScene } from "../project-client";
import { apply } from "./apply";
import { applyLive } from "./apply-live";
import type { WriterFlags } from "./assets-apply";

/**
 * A scene's canonical text as the dev server's doc has it now, or the tool
 * result for a failed read: a usage error, or a failure naming the scene.
 */
export async function liveSceneText(
  ctx: ToolContext,
  opts: { scene: string; url?: string; token?: string; timeoutMs?: number },
  extra: Record<string, unknown> = {},
): Promise<{ text: string } | ToolResult> {
  try {
    const { text } = await readLiveScene({
      projects: ctx.projects,
      project: ctx.project,
      url: opts.url,
      scene: opts.scene,
      timeoutMs: opts.timeoutMs,
      ...hostedOptions(ctx, opts.token),
    });
    return { text };
  } catch (e) {
    if (e instanceof ProjectClientError)
      return e.exitCode === 2
        ? usage(e.message)
        : failure(e.message, { scene: opts.scene, ...extra });
    throw e;
  }
}

/** Writes a scene batch a tool built as `scene apply` does: to the dev server's doc with `live`, else to the scene file. */
export function writeSceneBatch(
  input: WriterFlags & { scene: string },
  ctx: ToolContext,
  batch: OpBatch,
): Promise<ToolResult> {
  const text = JSON.stringify(batch);
  const via = { ...ctx, readStdin: async () => text };
  if (input.live)
    return applyLive(
      {
        scene: input.scene,
        ops: "-",
        url: input.url,
        agent: input.agent,
        onBehalfOf: input.onBehalfOf,
        token: input.token,
        dryRun: input.dryRun,
        base: input.base,
        timeoutMs: input.timeoutMs,
      },
      via,
    );
  return apply({ scene: input.scene, ops: "-", dryRun: input.dryRun, base: input.base }, via);
}
