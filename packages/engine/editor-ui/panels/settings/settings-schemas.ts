import { z } from "zod";

import type { Registry } from "../../../game/types";
import { gameSettingsKind, inputMapKind } from "../../../project/index";
import { unwrapSchema } from "../../../scene/schema";

type Shape = Readonly<Record<string, z.ZodType>>;

const shapeOf = (schema: unknown): Shape =>
  schema instanceof z.ZodObject ? (schema.shape as Shape) : {};

const objectAt = (shape: Shape, key: string): z.ZodObject => {
  const inner = shape[key] ? unwrapSchema(shape[key]) : undefined;
  return inner instanceof z.ZodObject ? inner : z.object({});
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
