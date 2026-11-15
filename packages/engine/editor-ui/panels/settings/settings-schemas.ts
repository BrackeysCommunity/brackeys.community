import { z } from "zod";

import type { Registry } from "../../../game/types";
import { gameSettingsKind, inputMapKind } from "../../../project/index";
import { soundKind } from "../../../project/kinds/sound";
import { synthKind } from "../../../project/kinds/synth";
import { unwrapSchema } from "../../../scene/schema";

type Shape = Readonly<Record<string, z.ZodType>>;

const shapeOf = (schema: unknown): Shape =>
  schema instanceof z.ZodObject ? (schema.shape as Shape) : {};

/** `schema`'s object under its optional and other wrappers, or null for anything else. */
const objectOf = (schema: unknown): z.ZodObject | null => {
  const inner = schema instanceof z.ZodType ? unwrapSchema(schema) : null;
  return inner instanceof z.ZodObject ? inner : null;
};

const objectAt = (shape: Shape, key: string): z.ZodObject => objectOf(shape[key]) ?? z.object({});

/** The object each item of the list at `key` is, or null. */
const itemAt = (shape: Shape, key: string): z.ZodObject | null => {
  const list = shape[key] ? unwrapSchema(shape[key]) : null;
  return list instanceof z.ZodArray ? objectOf(list.element) : null;
};

/** The game-settings kind's own schema under `registry`: its `engine` and `game` blocks. */
export function gameSettingsBlocks(registry: Registry): { engine: z.ZodObject; game: z.ZodObject } {
  const shape = shapeOf(gameSettingsKind.schema({ registry, project: null }));
  return { engine: objectAt(shape, "engine"), game: objectAt(shape, "game") };
}

/** The input-map kind's own schema under `registry`: its seats and deadzone, and one touch control. */
export function inputMapParts(registry: Registry): { seats: z.ZodObject; touch: z.ZodObject } {
  const shape = shapeOf(inputMapKind.schema({ registry, project: null }));
  const touch = shape.touch ? unwrapSchema(shape.touch) : undefined;
  const control = touch instanceof z.ZodArray ? unwrapSchema(touch.element as z.ZodType) : null;
  return {
    seats: z.object({
      ...(shape.players ? { players: shape.players } : {}),
      ...(shape.deadzone ? { deadzone: shape.deadzone } : {}),
    }),
    touch: control instanceof z.ZodObject ? control : z.object({}),
  };
}

/** The sound kind's own schema under `registry`'s buses: the file, one variant and one trigger. */
export function soundShapes(registry: Registry): {
  root: z.ZodObject | null;
  variant: z.ZodObject | null;
  trigger: z.ZodObject | null;
} {
  const root = objectOf(soundKind.schema({ registry, project: null }));
  const shape = shapeOf(root);
  return { root, variant: itemAt(shape, "variants"), trigger: itemAt(shape, "on") };
}

/** The synth kind's own schema: a patch's fields. */
export const synthObject = (): z.ZodObject | null => objectOf(synthKind.schema());
