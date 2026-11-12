import { z } from "zod";

const PAD_ID = /^pad:\d+$/;

/** A `DeviceId`, as input scripts and recordings write it. */
export const deviceIdSchema = z
  .union([
    z.enum(["keyboard", "pointer", "touch"]),
    z
      .templateLiteral(["pad:", z.number().int()])
      .refine((d) => PAD_ID.test(d), "a pad is `pad:<n>`, n a whole number from 0")
      .meta({ pattern: PAD_ID.source }),
  ])
  .describe("A device: `keyboard`, `pointer`, `touch` or `pad:<n>`, n in connection order.");
