import { closest } from "./did-you-mean";
import { makeIssue } from "./issues";
import type { PrefabLibrary, PrefabParam, SceneIssue, SceneOp } from "./types";

/** The ops that change a prefab's header rather than its children. */
export type PrefabHeaderOp = Extract<SceneOp, { op: "setPrefabBase" | "exposeParam" }>;

/** A prefab's variant base and own exposed params, as header ops read and leave them. */
export type PrefabHeader = { base?: string; params: Record<string, PrefabParam> };

export type HeaderOpResult = { ok: true; header: PrefabHeader } | { ok: false; issue: SceneIssue };

/** `params` with its names in code-unit order. */
export function sortedParams(params: Record<string, PrefabParam>): Record<string, PrefabParam> {
  const out: Record<string, PrefabParam> = {};
  for (const name of Object.keys(params).sort()) out[name] = params[name]!;
  return out;
}

/**
 * Runs one header op on prefab `id`'s header. A base must be a prefab in
 * `library` other than `id` (`variant-base-unknown`) that doesn't lead
 * back to `id` through bases or nested instances (`prefab-cycle`);
 * removing a param `id` doesn't declare is `op-invalid`. The issue has no
 * path: the caller knows where the op sits. Parameter targets are judged
 * by validation, as any override path is.
 */
export function applyHeaderOp(
  header: PrefabHeader,
  op: PrefabHeaderOp,
  id: string,
  library: PrefabLibrary,
): HeaderOpResult {
  if (op.op === "exposeParam") {
    const params = { ...header.params };
    if (op.param !== null) params[op.name] = structuredClone(op.param);
    else if (op.name in params) delete params[op.name];
    else {
      const suggestion = closest(op.name, Object.keys(params));
      return {
        ok: false,
        issue: makeIssue("op-invalid", {
          message: `Prefab "${id}" declares no parameter "${op.name}"${suggestion ? `; did you mean "${suggestion}"?` : "."}`,
          got: op.name,
          entityIds: [id],
        }),
      };
    }
    return { ok: true, header: { ...withBase(header.base), params: sortedParams(params) } };
  }
  if (op.base === null) return { ok: true, header: { params: header.params } };
  if (op.base === id || !library.has(op.base)) {
    const known = [...library.keys()].filter((k) => k !== id);
    const suggestion = closest(op.base, known);
    return {
      ok: false,
      issue: makeIssue("variant-base-unknown", {
        message:
          op.base === id
            ? `Prefab "${id}" can't be its own base.`
            : `No prefab "${op.base}" to be the base of "${id}"${suggestion ? `; did you mean "${suggestion}"?` : "."}`,
        got: op.base,
        entityIds: [id],
        ...(known.length > 0 ? { expected: known.join(", ") } : {}),
        ...(suggestion
          ? { hint: `{ "op": "setPrefabBase", "base": ${JSON.stringify(suggestion)} }` }
          : {}),
      }),
    };
  }
  const loop = baseLoop(id, op.base, library);
  if (loop)
    return {
      ok: false,
      issue: makeIssue("prefab-cycle", {
        message: `Prefab "${id}" would contain itself: ${[id, ...loop].join(" → ")}.`,
        got: op.base,
        entityIds: [id],
      }),
    };
  return { ok: true, header: { base: op.base, params: header.params } };
}

const withBase = (base: string | undefined) => (base !== undefined ? { base } : {});

/** The chain from `base` back to `id` through bases and nested instances, or null when there is none. */
function baseLoop(id: string, base: string, library: PrefabLibrary): string[] | null {
  const seen = new Set<string>();
  const walk = (at: string, chain: string[]): string[] | null => {
    if (at === id) return chain;
    if (seen.has(at)) return null;
    seen.add(at);
    const p = library.get(at);
    if (!p) return null;
    const next = [
      ...(typeof p.base === "string" ? [p.base] : []),
      ...(p.instances ?? []).map((n) => n.prefab),
    ];
    for (const n of next) {
      const found = walk(n, [...chain, n]);
      if (found) return found;
    }
    return null;
  };
  return walk(base, [base]);
}
