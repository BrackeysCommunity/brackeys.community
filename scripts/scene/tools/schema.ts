import { opsJsonSchema, sceneJsonSchema } from "@jams/engine/scene";

import { usage, type Tool } from "../context";

export type SchemaInput = { which?: string };

export const SCHEMAS = { scene: sceneJsonSchema, ops: opsJsonSchema } as const;

export const schema: Tool<SchemaInput> = async (input) => {
  const which = input.which ?? "scene";
  if (!Object.hasOwn(SCHEMAS, which))
    return usage(`scene schema [${Object.keys(SCHEMAS).join("|")}]`);
  const data = SCHEMAS[which as keyof typeof SCHEMAS]();
  return { exitCode: 0, data, text: JSON.stringify(data, null, 2) };
};
