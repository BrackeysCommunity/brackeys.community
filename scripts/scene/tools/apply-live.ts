import { applyOpsToDoc, type SceneOrigin } from "@jams/engine/collab";
import { describeChange, type OpBatch } from "@jams/engine/scene";
import * as Y from "yjs";

import {
  failure,
  issueLine,
  isFileArg,
  readArg,
  registryOf,
  usage,
  UsageError,
  type Tool,
} from "../context";
import { DEFAULT_LIVE_URL, LiveError, openLiveScene } from "../live";

export type ApplyLiveInput = {
  scene?: string;
  ops?: string;
  url?: string;
  agent?: string;
  onBehalfOf?: string;
  dryRun?: boolean;
  base?: string;
  timeoutMs?: number;
};

/** The agent id a live batch is logged under when `--agent` is left out. */
export const DEFAULT_AGENT_ID = "scene-cli";

const USAGE =
  "scene apply <scene> --live --ops <file|-> [--url ws://…] [--agent id] [--on-behalf-of user] [--dry-run]";

/**
 * Applies a batch to the live scene doc on a collab server as an agent
 * client: connect, sync, apply in one transaction with an `agent` origin,
 * wait for the server to acknowledge it, disconnect. `~` refs resolve
 * against the doc as it is when the batch lands, so a batch needs no `base`
 * (one it brings is still checked, and failing it is exit 1, not 3). Like
 * `apply`, a batch that would leave error-severity issues isn't applied.
 */
export const applyLive: Tool<ApplyLiveInput> = async (input, ctx) => {
  if (!input.ops || !input.scene) return usage(USAGE);
  if (isFileArg(input.scene) || input.scene === "-")
    return usage("scene apply --live takes a scene name; file paths are read-only");

  let batch: OpBatch;
  try {
    batch = JSON.parse(await readArg(ctx, input.ops)) as OpBatch;
  } catch (e) {
    if (e instanceof UsageError) return usage(e.message);
    if ((e as { code?: string }).code === "ENOENT") return failure(`Not found: ${input.ops}.`);
    return failure(`--ops is not JSON: ${(e as Error).message}`);
  }
  if (input.base && batch && typeof batch === "object" && !("base" in batch))
    batch = { ...batch, base: input.base };

  const url = input.url ?? DEFAULT_LIVE_URL;
  const origin: SceneOrigin = {
    kind: "agent",
    agentId: input.agent ?? DEFAULT_AGENT_ID,
    ...(input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {}),
  };

  let live;
  try {
    live = await openLiveScene({ url, scene: input.scene, timeoutMs: input.timeoutMs });
  } catch (e) {
    if (e instanceof LiveError) return failure(e.message, { scene: input.scene, url });
    throw e;
  }
  try {
    const registry = registryOf(ctx, live.meta.game);
    if (!registry)
      return failure(`${input.scene} is for game "${live.meta.game}", which the CLI doesn't know.`);

    // A scratch copy shows what the batch would do without touching the shared doc.
    const scratch = new Y.Doc();
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(live.doc));
    const trial = applyOpsToDoc(scratch, batch, origin, registry);
    scratch.destroy();
    const head = { scene: input.scene, live: true, url, actor: origin };
    if (!trial.ok) {
      const { hash, ...rest } = trial;
      return {
        exitCode: 1,
        data: { ...rest, ...head, sceneHash: hash, written: false },
        text: [
          `${input.scene} (live): op ${trial.failedAt} failed (scene ${hash})`,
          issueLine(trial.issue),
        ].join("\n"),
      };
    }

    const errors = trial.issues.filter((i) => i.severity === "error");
    const write = !input.dryRun && errors.length === 0;
    let result = trial;
    if (write) {
      const applied = applyOpsToDoc(live.doc, batch, origin, registry);
      if (!applied.ok)
        throw new Error(`the batch failed on the live doc: ${applied.issue.message}`);
      result = applied;
      try {
        await live.pushed();
      } catch (e) {
        if (e instanceof LiveError) return failure(e.message, { ...head, written: false });
        throw e;
      }
    }

    const { def: _def, keys: _keys, refKeys: _refKeys, hash, ...rest } = result;
    const verb = input.dryRun ? "would change" : write ? "changed" : "not applied (errors)";
    const lines = [
      `${input.scene} (live): ${verb}, ${result.diff.length} ${result.diff.length === 1 ? "change" : "changes"}, hash ${hash}`,
      ...result.diff.map((c) => `  ${describeChange(c)}`),
      ...(result.created.length > 0 ? [`  created ${result.created.join(", ")}`] : []),
      ...result.issues.map(issueLine),
    ];
    return {
      exitCode: errors.length > 0 ? 1 : 0,
      data: { ...rest, ...head, sceneHash: hash, dryRun: Boolean(input.dryRun), written: write },
      text: lines.join("\n"),
    };
  } finally {
    live.close();
  }
};
