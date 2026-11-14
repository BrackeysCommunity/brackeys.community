import {
  applyOpsToDoc,
  docMeta,
  layoutFromDoc,
  type PrefabDocWriter,
  type ProjectSession,
} from "@jams/engine/collab";
import type { Registry } from "@jams/engine/game";
import {
  gameSettingsEntries,
  PREFAB_SCENE_OPS,
  runtimeView,
  type ProjectOpBatch,
} from "@jams/engine/project";
import { describeChange, type OpBatch, type SceneOp } from "@jams/engine/scene";
import * as Y from "yjs";

import {
  failure,
  issueLine,
  isFileArg,
  hostedOptions,
  readArg,
  registryOf,
  usage,
  UsageError,
  type Tool,
} from "../context";
import {
  agentOrigin,
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_URL,
  findScene,
  openLiveProject,
  ProjectClientError,
} from "../project-client";

export { DEFAULT_AGENT_ID };

export type ApplyLiveInput = {
  scene?: string;
  ops?: string;
  url?: string;
  agent?: string;
  onBehalfOf?: string;
  /** A hosted project's agent token (`--token`); `JAMS_AGENT_TOKEN` when left out. */
  token?: string;
  dryRun?: boolean;
  base?: string;
  timeoutMs?: number;
};

/** Lets a trial on a copy of the scene doc run prefab ops; the project batch writes the prefab docs. */
const TRIAL_PREFABS: PrefabDocWriter = { plan: () => ({ ok: true, write: () => [] }) };

/** The project's game-settings `engine` block as the server holds it, read the way Play reads it. */
async function liveEngine(
  session: ProjectSession,
  registry: Registry,
): Promise<Readonly<Record<string, unknown>>> {
  const [entry] = gameSettingsEntries(session.view());
  const name = entry ? session.docNameFor(entry) : null;
  if (!entry || !name)
    return runtimeView(session.view(), new Map(), registry, session.kinds).engine;
  const opened = await session.open(name);
  try {
    const value = opened.layout ? layoutFromDoc(opened.doc, opened.layout) : null;
    return runtimeView(session.view(), new Map([[entry.id, value]]), registry, session.kinds)
      .engine;
  } finally {
    session.release(name);
  }
}

const USAGE =
  "scene apply <scene> --live --ops <file|-> [--url ws://…|https://site [--token t]] [--agent id] [--on-behalf-of user] [--dry-run]";

/**
 * Applies a batch to a scene on a running dev server as an agent client of
 * its project: the batch is tried on a copy of the scene doc as the server
 * has it, then sent as one `editScene` project op, so prefab ops write the
 * prefab docs they name. `~` refs resolve against the doc as it is when the
 * batch lands, so a batch needs no `base` (one it brings is still checked,
 * and failing it is exit 1, not 3). Like `apply`, the trial judges asset ids,
 * sprite frames and the physics the scene resolves to against the project
 * as the server has it, and a batch
 * that would leave error-severity issues isn't applied.
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

  const url = input.url ?? DEFAULT_PROJECT_URL;
  const origin = agentOrigin({ agent: input.agent, onBehalfOf: input.onBehalfOf });
  let head = { scene: input.scene, live: true, url, actor: origin };

  let live;
  try {
    live = await openLiveProject({
      projects: ctx.projects,
      url,
      project: ctx.project,
      find: findScene(input.scene),
      origin,
      prefabs: true,
      write: !input.dryRun,
      timeoutMs: input.timeoutMs,
      ...hostedOptions(ctx, input.token),
    });
  } catch (e) {
    if (e instanceof ProjectClientError)
      return e.exitCode === 2 ? usage(e.message) : failure(e.message, { scene: input.scene, url });
    throw e;
  }
  const { client, project } = live;
  head = { ...head, actor: client.origin };
  const { session } = client;
  const name = session.docNameFor(session.view().byId.get(input.scene)!)!;
  try {
    const opened = await session.open(name);
    let meta;
    try {
      meta = docMeta(opened.doc);
      if (!meta) return failure(`${name} synced empty: the server didn't seed it.`, head);
      const registry = registryOf(ctx, meta.game, project);
      if (!registry)
        return failure(
          `${input.scene} is for game "${meta.game}", which no project of the CLI's has.`,
        );

      // A copy shows what the batch would do without touching the shared doc.
      const scratch = new Y.Doc();
      Y.applyUpdate(scratch, Y.encodeStateAsUpdate(opened.doc));
      const trial = applyOpsToDoc(scratch, batch, origin, registry, {
        prefabs: session.prefabLibrary(),
        prefabWriter: TRIAL_PREFABS,
        project: { ...session.view(), engine: await liveEngine(session, registry) },
      });
      scratch.destroy();
      if (!trial.ok) {
        const { hash, ...rest } = trial;
        return {
          exitCode: 1,
          data: { ...rest, ...head, project: project.file.id, sceneHash: hash, written: false },
          text: [
            `${input.scene} (live): op ${trial.failedAt} failed (scene ${hash})`,
            issueLine(trial.issue),
          ].join("\n"),
        };
      }

      const errors = trial.issues.filter((i) => i.severity === "error");
      const write = !input.dryRun && errors.length === 0;
      const sceneOps = (Array.isArray(batch.ops) ? batch.ops : []) as SceneOp[];
      const projectBatch: ProjectOpBatch = {
        v: 1,
        ...(batch.label ? { label: batch.label } : {}),
        ops: [{ op: "editScene", id: input.scene, ops: sceneOps }],
      };
      const prefabOps = sceneOps.some((o) => PREFAB_SCENE_OPS.includes(o?.op));
      if (write || (prefabOps && errors.length === 0)) {
        const sent = write ? await client.apply(projectBatch) : await client.trial(projectBatch);
        if (!sent.ok)
          return {
            exitCode: 1,
            data: { ok: false, ...head, issue: sent.issue, written: false },
            text: [`${input.scene} (live): not applied`, issueLine(sent.issue)].join("\n"),
          };
      }

      const { def: _def, keys: _keys, refKeys: _refKeys, hash, ...rest } = trial;
      const verb = input.dryRun ? "would change" : write ? "changed" : "not applied (errors)";
      const lines = [
        `${input.scene} (live): ${verb}, ${trial.diff.length} ${trial.diff.length === 1 ? "change" : "changes"}, hash ${hash}`,
        ...trial.diff.map((c) => `  ${describeChange(c)}`),
        ...(trial.created.length > 0 ? [`  created ${trial.created.join(", ")}`] : []),
        ...trial.issues.map(issueLine),
      ];
      return {
        exitCode: errors.length > 0 ? 1 : 0,
        data: {
          ...rest,
          ...head,
          project: project.file.id,
          sceneHash: hash,
          dryRun: Boolean(input.dryRun),
          written: write,
        },
        text: lines.join("\n"),
      };
    } finally {
      session.release(name);
    }
  } catch (e) {
    if (e instanceof ProjectClientError) return failure(e.message, { ...head, written: false });
    throw e;
  } finally {
    await client.close().catch(() => undefined);
  }
};
