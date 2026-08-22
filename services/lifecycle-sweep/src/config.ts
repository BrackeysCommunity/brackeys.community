import { z } from "zod";

import { parseServiceConfig } from "../../../src/lib/service-config.ts";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
});

export const config = parseServiceConfig(schema);
export type Config = typeof config;
