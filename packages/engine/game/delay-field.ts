import { z } from "zod";

/**
 * A wait or a length of time as a `Delay` takes it: whole ticks, or `{ ms }`
 * rounded to ticks once at the run's rate (`delayTicks`). The inspector
 * draws it as one number with a ticks/ms switch.
 */
export const delayField = (description: string, min: number) =>
  z
    .union([
      z.number().int().min(min).describe("Ticks.").meta({ unit: "ticks" }),
      z.strictObject({
        ms: z.number().min(min).describe("Milliseconds, rounded to ticks once at the run's rate."),
      }),
    ])
    .describe(description);
