import type { z } from "zod";

import { makeIssue } from "../../scene/issues";
import type { InspectEnv, InspectResult } from "../kinds/define";

/** The `import-failed` result for the file at `env.path`, read as `kind`. */
export function importFailed(kind: string, env: InspectEnv, reason: string): InspectResult<never> {
  const path = typeof env?.path === "string" ? env.path : "the file";
  return {
    ok: false,
    issue: makeIssue("import-failed", {
      message: `"${path}" can't be imported as ${kind}: ${reason}.`,
      expected: kind,
    }),
  };
}

/**
 * A blob kind's `inspect` that never throws: the settings are judged by the
 * kind's schema first, and the reader's meta by its meta schema after.
 * Anything the reader refuses or that goes wrong is `import-failed`.
 */
export function guardedInspect<M, S>(
  kind: string,
  schemas: { settings: z.ZodType<S>; meta: z.ZodType<M> },
  read: (bytes: Uint8Array, settings: S, env: InspectEnv) => InspectResult<M>,
): (bytes: Uint8Array, settings: S, env: InspectEnv) => InspectResult<M> {
  return (bytes, settings, env) => {
    try {
      if (!(bytes instanceof Uint8Array)) return importFailed(kind, env, "no bytes were given");
      const parsed = schemas.settings.safeParse(settings ?? {});
      if (!parsed.success) return importFailed(kind, env, "its import settings are invalid");
      const result = read(bytes, parsed.data, env);
      if (!result.ok) return result;
      if (!schemas.meta.safeParse(result.meta).success)
        return importFailed(kind, env, "what its header gives isn't valid metadata");
      return result;
    } catch {
      return importFailed(kind, env, "its header couldn't be read");
    }
  };
}
