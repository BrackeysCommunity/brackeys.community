/**
 * The `occupant` behavior's schema: an entity that keeps its grid cell in
 * step with its pose. Zod only; the system lives in
 * `runtime/behaviors/occupant.ts`.
 */
import { z } from "zod";

import { defineBehavior, handleType } from "../behaviors";

const occupantFields = {
  blocks: z
    .boolean()
    .optional()
    .describe("Whether its cell is impassable to paths while it stands there; default true."),
};

/** An `occupant` block as an entity carries it. */
export type OccupantBlock = z.infer<z.ZodObject<typeof occupantFields>>;

/** Nothing beside `fields` yet. */
export type OccupantHandle = Record<never, never>;

export const OCCUPANT = defineBehavior({
  name: "occupant",
  handle: handleType<OccupantHandle>(),
  description: "Stands on the grid cell under its pose, where paths and game code see it.",
  fields: occupantFields,
  inspector: { category: "world" },
});
