/**
 * The `lifetime` behavior's schema: an entity that goes away a time after
 * it spawns or is enabled. Zod only; the system lives in
 * `runtime/behaviors/lifetime.ts`.
 */
import { z } from "zod";

import { defineBehavior } from "../behaviors";

const lifetimeFields = {
  ticks: z.number().int().min(1).optional().describe("Ticks until it goes; give this or `ms`."),
  ms: z
    .number()
    .positive()
    .optional()
    .describe(
      "Milliseconds until it goes, rounded to ticks at the run's rate; give this or `ticks`.",
    ),
  // oxlint-disable-next-line unicorn/no-thenable -- a block field, never awaited
  then: z.enum(["destroy", "disable"]).optional().describe("Default destroy."),
};

/** A `lifetime` block as an entity carries it. */
export type LifetimeBlock = z.infer<z.ZodObject<typeof lifetimeFields>>;

export const LIFETIME = defineBehavior({
  name: "lifetime",
  description: "Destroys or disables the entity a time after it spawns or is enabled.",
  fields: lifetimeFields,
  template: { ticks: 60 },
  refine(block) {
    const given = (block.ticks === undefined ? 0 : 1) + (block.ms === undefined ? 0 : 1);
    return given === 1 ? undefined : "lifetime takes exactly one of `ticks` or `ms`";
  },
  inspector: { category: "world" },
});
