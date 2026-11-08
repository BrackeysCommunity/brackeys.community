import {
  createKindRegistry,
  docKindJsonSchema,
  projectJsonSchema,
  projectOpsJsonSchema,
  projectSnapshotJsonSchema,
  sidecarJsonSchema,
  type KindEnv,
  type KindRegistry,
} from "@jams/engine/project";
import {
  checksJsonSchema,
  fragmentJsonSchema,
  inputScriptJsonSchema,
  opsJsonSchema,
  prefabJsonSchema,
  recordingJsonSchema,
  sceneJsonSchema,
  type Registry,
} from "@jams/engine/scene";

import { gameFlag, inScope, isToolResult, scopeError, usage, type Tool } from "../context";

export type SchemaInput = { which?: string; game?: string };

type Builder = (registry: Registry, kinds: KindRegistry) => Record<string, unknown>;

/** A doc kind's content schema, as its kind defines it for `registry`. */
const kindSchema =
  (kind: string): Builder =>
  (registry, kinds) => {
    const def = kinds.get(kind);
    if (def?.storage !== "doc") throw new Error(`no doc kind "${kind}"`);
    const env: KindEnv = { registry, project: null };
    return docKindJsonSchema(def, env);
  };

export const SCHEMAS = {
  scene: (r) => sceneJsonSchema(r),
  ops: (r) => opsJsonSchema(r),
  script: (r) => inputScriptJsonSchema(r),
  checks: (r) => checksJsonSchema(r),
  recording: () => recordingJsonSchema(),
  fragment: (r) => fragmentJsonSchema(r),
  prefab: (r) => prefabJsonSchema(r),
  project: () => projectJsonSchema(),
  "asset-sidecar": () => sidecarJsonSchema(),
  "project-ops": () => projectOpsJsonSchema(),
  "project-snapshot": () => projectSnapshotJsonSchema(),
  material: kindSchema("material"),
  "game-settings": kindSchema("game-settings"),
  "data-table": kindSchema("data-table"),
} as const satisfies Record<string, Builder>;

export const SCHEMA_NAMES = Object.keys(SCHEMAS) as (keyof typeof SCHEMAS)[];

export const SCHEMA_USAGE = `scene schema [${SCHEMA_NAMES.join("|")}|<doc kind>] [--game id] [--project id]`;

/**
 * The JSON Schema `which` names, for one game's registry (the engine's
 * without `--game`, `--project`'s game with it): the scene, op-batch,
 * input-script, checks, fragment and prefab schemas, the recording schema
 * every game shares, the project file, sidecar, project-op and snapshot
 * schemas, and any doc kind's content schema by the kind's name.
 */
export const schema: Tool<SchemaInput> = async (input, ctx) => {
  const which = input.which ?? "scene";
  const scoped = scopeError(ctx);
  if (scoped) return scoped;
  const project = ctx.project === undefined ? undefined : inScope(ctx)[0];
  if (project && input.game !== undefined && input.game !== project.game?.id)
    return usage(
      `--game ${input.game}: project "${project.file.id}" ${project.game ? `is for game "${project.game.id}"` : "has no game"}`,
    );
  const registry = project ? project.registry : gameFlag(ctx, input.game);
  if (isToolResult(registry)) return registry;
  const kinds =
    project?.kinds ??
    ctx.projects.find((p) => p.registry === registry)?.kinds ??
    createKindRegistry(registry.game);
  let build: Builder | undefined;
  if (Object.hasOwn(SCHEMAS, which)) build = SCHEMAS[which as keyof typeof SCHEMAS];
  else if (kinds.get(which)?.storage === "doc") build = kindSchema(which);
  if (!build) return usage(SCHEMA_USAGE);
  const data = build(registry, kinds);
  return { exitCode: 0, data, text: JSON.stringify(data, null, 2) };
};
