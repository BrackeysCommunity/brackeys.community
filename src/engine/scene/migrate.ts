import { makeIssue } from "./issues";
import { SCENE_FORMAT_VERSION, type SceneIssue } from "./types";

/**
 * `MIGRATIONS[n]` lifts an untyped v`n` document to v`n + 1`. Each step ships
 * with a frozen fixture test; only the current version exists as Zod.
 */
export type Migration = (raw: unknown) => unknown;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * v1 → v2: groups become declared, with a local origin. v1 groups were
 * folders with world coordinates, so each group a v1 entity names is
 * declared at `[0, 0]` and nothing moves.
 */
function v1ToV2(raw: unknown): unknown {
  const doc = raw as Record<string, unknown>;
  const names = new Set<string>();
  if (Array.isArray(doc.entities))
    for (const e of doc.entities)
      if (isRecord(e) && typeof e.group === "string") names.add(e.group);
  const out: Record<string, unknown> = { ...doc, v: 2 };
  if (names.size > 0) {
    const groups: Record<string, unknown> = {};
    for (const name of [...names].sort()) groups[name] = { at: [0, 0] };
    out.groups = groups;
  }
  return out;
}

/**
 * v2 → v3: only `v` changes. Every v3 addition is optional and defaults to
 * v2's behaviour, so scenes, prefabs and fragments carry over as they are.
 */
function v2ToV3(raw: unknown): unknown {
  return { ...(raw as Record<string, unknown>), v: 3 };
}

export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({
  1: v1ToV2,
  2: v2ToV3,
});

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
