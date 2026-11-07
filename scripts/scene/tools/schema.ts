import {
  checksJsonSchema,
  fragmentJsonSchema,
  inputScriptJsonSchema,
  opsJsonSchema,
  prefabJsonSchema,
  recordingJsonSchema,
  sceneJsonSchema,
} from "@jams/engine/scene";

import { gameFlag, isToolResult, usage, type Tool } from "../context";

export type SchemaInput = { which?: string; game?: string };

export const SCHEMAS = {
  scene: sceneJsonSchema,
  ops: opsJsonSchema,
  script: inputScriptJsonSchema,
  checks: checksJsonSchema,
  recording: () => recordingJsonSchema(),
  fragment: fragmentJsonSchema,
  prefab: prefabJsonSchema,
} as const;

/**
 * The scene, op-batch, input-script, checks-file, fragment or prefab JSON
 * Schema of one game's registry, the engine's without `--game`; recordings
 * have one schema for every game.
 */
export const schema: Tool<SchemaInput> = async (input, ctx) => {
  const which = input.which ?? "scene";
  if (!Object.hasOwn(SCHEMAS, which))
    return usage(`scene schema [${Object.keys(SCHEMAS).join("|")}] [--game id]`);
  const registry = gameFlag(ctx, input.game);
  if (isToolResult(registry)) return registry;
  const data = SCHEMAS[which as keyof typeof SCHEMAS](registry);
  return { exitCode: 0, data, text: JSON.stringify(data, null, 2) };
};
