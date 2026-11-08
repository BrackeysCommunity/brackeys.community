import { sameValue as same } from "../project/canonical";
import { closest } from "./did-you-mean";
import { makeIssue } from "./issues";
import type {
  OverridePath,
  Prefab,
  PrefabLibrary,
  PrefabParam,
  SceneIssue,
  SceneOp,
} from "./types";

/**
 * The ops that change a prefab's header rather than its children:
 * `setPrefabBase`, `exposeParam`, and `override` / `revertOverride` with no
 * `ref`, which act on the prefab's own overrides of its variant base.
 */
export type PrefabHeaderOp =
  | Extract<SceneOp, { op: "setPrefabBase" | "exposeParam" }>
  | (Extract<SceneOp, { op: "override" | "revertOverride" }> & { ref?: undefined });

/** A prefab's variant base, own exposed params and own overrides, as header ops read and leave them. */
export type PrefabHeader = {
  base?: string;
  params: Record<string, PrefabParam>;
  overrides: Record<OverridePath, unknown>;
};

export type HeaderOpResult = { ok: true; header: PrefabHeader } | { ok: false; issue: SceneIssue };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Whether `op` changes the header of the prefab doc it is sent to. */
export function isHeaderOp(op: unknown): op is PrefabHeaderOp {
  if (!isRecord(op)) return false;
  if (op.op === "setPrefabBase" || op.op === "exposeParam") return true;
  return (op.op === "override" || op.op === "revertOverride") && op.ref === undefined;
}

/** `prefab`'s header as header ops read it; none for no prefab. */
export function headerOf(prefab: Prefab | undefined): PrefabHeader {
  return {
    ...(prefab?.base !== undefined ? { base: prefab.base } : {}),
    params: sortedParams(structuredClone(prefab?.params ?? {})),
    overrides: structuredClone(prefab?.overrides ?? {}),
  };
}

/** A header's fields as a prefab carries them: empty params and overrides written as absent. */
export function headerFields(header: PrefabHeader): Pick<Prefab, "base" | "params" | "overrides"> {
  return {
    ...(header.base !== undefined ? { base: header.base } : {}),
    ...(Object.keys(header.params).length > 0 ? { params: structuredClone(header.params) } : {}),
    ...(Object.keys(header.overrides).length > 0
      ? { overrides: structuredClone(header.overrides) }
      : {}),
  };
}

/** `params` with its names in code-unit order. */
export function sortedParams(params: Record<string, PrefabParam>): Record<string, PrefabParam> {
  const out: Record<string, PrefabParam> = {};
  for (const name of Object.keys(params).sort()) out[name] = params[name]!;
  return out;
}

/** Sets `key` in an override map, dropping the keys it contains or that contain it. */
export function setOverride(overrides: Record<string, unknown>, key: string, value: unknown): void {
  for (const other of Object.keys(overrides))
    if (other !== key && (other.startsWith(`${key}.`) || key.startsWith(`${other}.`)))
      delete overrides[other];
  overrides[key] = structuredClone(value);
}

/** Drops `paths` (every key, when omitted) from an override map, with the keys inside each. */
export function revertOverrides(
  overrides: Record<string, unknown>,
  paths: readonly string[] | undefined,
): void {
  for (const key of paths ?? Object.keys(overrides)) {
    delete overrides[key];
    for (const other of Object.keys(overrides))
      if (other.startsWith(`${key}.`)) delete overrides[other];
  }
}

/**
 * The header ops that take `to` back to `from`: a `setPrefabBase` for a
 * changed base, an `exposeParam` per changed param, and `revertOverride`
 * then `override` (both with no ref) for changed overrides.
 */
export function headerOpsBetween(to: PrefabHeader, from: PrefabHeader): PrefabHeaderOp[] {
  const ops: PrefabHeaderOp[] = [];
  if (from.base !== to.base) ops.push({ op: "setPrefabBase", base: from.base ?? null });
  const names = new Set([...Object.keys(from.params), ...Object.keys(to.params)]);
  for (const name of [...names].sort()) {
    const param = from.params[name];
    if (!same(param, to.params[name]))
      ops.push({ op: "exposeParam", name, param: param ? structuredClone(param) : null });
  }
  const revert = Object.keys(to.overrides)
    .filter((k) => !same(to.overrides[k], from.overrides[k]))
    .sort();
  const set = Object.keys(from.overrides)
    .filter((k) => !same(to.overrides[k], from.overrides[k]))
    .sort();
  if (revert.length > 0) ops.push({ op: "revertOverride", paths: revert });
  if (set.length > 0)
    ops.push({
      op: "override",
      set: Object.fromEntries(set.map((k) => [k, structuredClone(from.overrides[k])])),
    });
  return ops;
}

/**
 * Runs one header op on prefab `id`'s header. A base must be a prefab in
 * `library` other than `id` (`variant-base-unknown`) that doesn't lead
 * back to `id` (`prefab-cycle`, `id` itself included) through bases or
 * nested instances; removing a param `id` doesn't declare is `op-invalid`,
 * as is an `override` that sets nothing. The issue's path is relative to
 * the op (`/base`, `/name`, `/set`); the caller prefixes where it sits.
 * Parameter targets and override paths are judged by validation, as any
 * override path is.
 */
export function applyHeaderOp(
  header: PrefabHeader,
  op: PrefabHeaderOp,
  id: string,
  library: PrefabLibrary,
): HeaderOpResult {
  switch (op.op) {
    case "override": {
      const keys = Object.keys(op.set);
      if (keys.length === 0)
        return {
          ok: false,
          issue: makeIssue("op-invalid", {
            message: `override of prefab "${id}"'s own overrides sets nothing.`,
            path: "/set",
            entityIds: [id],
          }),
        };
      const overrides = { ...header.overrides };
      for (const key of keys) setOverride(overrides, key, op.set[key]);
      return { ok: true, header: { ...header, overrides } };
    }
    case "revertOverride": {
      const overrides = { ...header.overrides };
      revertOverrides(overrides, op.paths);
      return { ok: true, header: { ...header, overrides } };
    }
    case "exposeParam": {
      const params = { ...header.params };
      if (op.param !== null) params[op.name] = structuredClone(op.param);
      else if (op.name in params) delete params[op.name];
      else {
        const suggestion = closest(op.name, Object.keys(params));
        return {
          ok: false,
          issue: makeIssue("op-invalid", {
            message: `Prefab "${id}" declares no parameter "${op.name}"${suggestion ? `; did you mean "${suggestion}"?` : "."}`,
            path: "/name",
            got: op.name,
            entityIds: [id],
          }),
        };
      }
      return { ok: true, header: { ...header, params: sortedParams(params) } };
    }
    case "setPrefabBase":
      return setBase(header, op.base, id, library);
  }
}

function setBase(
  header: PrefabHeader,
  base: string | null,
  id: string,
  library: PrefabLibrary,
): HeaderOpResult {
  const { base: _was, ...rest } = header;
  if (base === null) return { ok: true, header: rest };
  if (base === id)
    return {
      ok: false,
      issue: makeIssue("prefab-cycle", {
        message: `Prefab "${id}" would contain itself: it can't be its own base.`,
        path: "/base",
        got: base,
        entityIds: [id],
      }),
    };
  if (!library.has(base)) {
    const known = [...library.keys()].filter((k) => k !== id);
    const suggestion = closest(base, known);
    return {
      ok: false,
      issue: makeIssue("variant-base-unknown", {
        message: `No prefab "${base}" to be the base of "${id}"${suggestion ? `; did you mean "${suggestion}"?` : "."}`,
        path: "/base",
        got: base,
        entityIds: [id],
        ...(known.length > 0 ? { expected: known.join(", ") } : {}),
        ...(suggestion
          ? { hint: `{ "op": "setPrefabBase", "base": ${JSON.stringify(suggestion)} }` }
          : {}),
      }),
    };
  }
  const loop = baseLoop(id, base, library);
  if (loop)
    return {
      ok: false,
      issue: makeIssue("prefab-cycle", {
        message: `Prefab "${id}" would contain itself: ${[id, ...loop].join(" → ")}.`,
        path: "/base",
        got: base,
        entityIds: [id],
      }),
    };
  return { ok: true, header: { ...rest, base } };
}

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
