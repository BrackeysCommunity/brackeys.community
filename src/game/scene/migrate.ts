import { makeIssue } from "./issues";
import { SCENE_FORMAT_VERSION, type SceneIssue } from "./types";

/**
 * `MIGRATIONS[n]` lifts an untyped v`n` document to v`n + 1`. Each step ships
 * with a frozen fixture test; only the current version exists as Zod.
 */
export type Migration = (raw: unknown) => unknown;
export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({});

export type MigrateResult =
  | { ok: true; raw: unknown; from: number }
  | { ok: false; issue: SceneIssue };

export function migrate(
  raw: unknown,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  target: number = SCENE_FORMAT_VERSION,
): MigrateResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      issue: makeIssue("schema", {
        message: "a scene must be a JSON object",
        path: "",
        expected: "object",
        got: Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw,
      }),
    };
  }
  const v = (raw as Record<string, unknown>).v;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    return {
      ok: false,
      issue: makeIssue("schema", {
        message:
          v === undefined
            ? "the scene has no format version `v`"
            : `\`v\` must be a positive integer; got ${JSON.stringify(v)}`,
        path: "/v",
        expected: `integer 1..${target}`,
        got: v === undefined ? "missing" : JSON.stringify(v),
        hint: `Set "v": ${target}.`,
      }),
    };
  }
  if (v > target) {
    return {
      ok: false,
      issue: makeIssue("version-newer", {
        message: `the scene is format v${v}, but this engine reads up to v${target}`,
        path: "/v",
        expected: `<= ${target}`,
        got: String(v),
      }),
    };
  }
  let doc: unknown = raw;
  for (let step = v; step < target; step++) {
    const lift = migrations[step];
    if (!lift) {
      return {
        ok: false,
        issue: makeIssue("schema", {
          message: `no migration from scene format v${step} to v${step + 1}`,
          path: "/v",
          got: String(v),
        }),
      };
    }
    doc = lift(doc);
  }
  return { ok: true, raw: doc, from: v };
}
