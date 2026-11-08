import type { EngineIssueCode, IssueCode, IssueCodeInfo, SceneIssue } from "./types";

export type { IssueCodeInfo } from "./types";

/**
 * Every code the engine reports; a game's own `<game-id>/<code>` codes sit
 * beside them in `registry.issueCodes`. Codes, severities and the `fixable`
 * flag are public contract: renaming or removing one is a breaking change.
 */
export const ISSUE_CODES: Readonly<Record<EngineIssueCode, IssueCodeInfo>> = {
  schema: {
    severity: "error",
    summary: "The document doesn't match the scene schema, isn't valid JSON, or has a bad `v`.",
    hint: "Fix the value at `path`; `expected` and `got` say what the schema wants. Print the schema with `vp run scene schema scene`.",
    fixable: false,
  },
  "unknown-key": {
    severity: "error",
    summary: "A key the schema doesn't define.",
    hint: "Rename it to the suggested key, or remove it. Bulk keys are a registered type's name, or `<type>:<material>` for a type with material bulk keys.",
    fixable: false,
  },
  "unknown-type": {
    severity: "error",
    summary: "An entity's `type` isn't registered, or the entity has no `type`.",
    hint: "Use one of the registered types; a game's own types need the scene's top-level `game` key.",
    fixable: false,
  },
  "unknown-game": {
    severity: "error",
    summary: "The scene names a game this tool has no registry for.",
    hint: "Open the scene with that game's tools, or remove `game` to use engine primitives only.",
    fixable: false,
  },
  "bad-shape": {
    severity: "error",
    summary:
      "A shape tuple with an unknown tag, the wrong number of values, or a non-positive size.",
    hint: 'Write the tuple in its documented form, e.g. ["box", cx, cy, hw, hh] with hw and hh > 0.',
    fixable: false,
  },
  "bad-id": {
    severity: "error",
    summary: "An id that doesn't match ^[a-z0-9][a-z0-9-]{0,47}$.",
    hint: "Use lowercase letters, digits and '-', starting with a letter or digit, at most 48 characters.",
    fixable: false,
  },
  "version-newer": {
    severity: "error",
    summary: "The scene was written by a newer engine than this one.",
    hint: "Upgrade the engine; a newer file is never truncated or downgraded.",
    fixable: false,
  },
  "dup-id": {
    severity: "error",
    summary: "Two entities share an id.",
    hint: "Give the later entity a new id, e.g. by appending -2.",
    fixable: false,
  },
  "dangling-ref": {
    severity: "error",
    summary: "A reference names an id that doesn't exist.",
    hint: "Point the reference at an existing id, or remove it.",
    fixable: true,
  },
  "ref-type": {
    severity: "error",
    summary: "A reference targets an entity of a type it can't target.",
    hint: "Point the reference at an entity of an allowed type, or remove it.",
    fixable: true,
  },
  "poly-invalid": {
    severity: "error",
    summary: "A poly that is non-convex, self-intersecting or has zero area.",
    hint: "Make the points convex, split it into convex polys, or use a chain where the field allows one.",
    fixable: true,
  },
  "chain-invalid": {
    severity: "error",
    summary: "A chain with a zero-length segment.",
    hint: "Remove the repeated point.",
    fixable: true,
  },
  "path-invalid": {
    severity: "error",
    summary: "A path with fewer than 2 points or a speed that isn't positive.",
    hint: "Give the path at least two distinct points and a speed > 0 (px/s).",
    fixable: false,
  },
  "prefab-unknown": {
    severity: "error",
    summary: "An instance names a prefab that doesn't exist.",
    hint: "Name an existing prefab, or remove the instance.",
    fixable: false,
  },
  "path-degenerate": {
    severity: "warn",
    summary: "A path repeats a point, which the runtime skips.",
    hint: "Drop the repeated point.",
    fixable: true,
  },
  "non-integer": {
    severity: "warn",
    summary: "A coordinate or size isn't a whole number of pixels.",
    hint: "Round it; scene geometry is integer pixels.",
    fixable: true,
  },
  "out-of-bounds": {
    severity: "warn",
    summary: "Something lies outside the scene's bounds, where the camera can't reach.",
    hint: "Move it inside `bounds`, or grow `bounds` with a setScene op.",
    fixable: true,
  },
  "hidden-layer": {
    severity: "info",
    summary: "An entity sits on a layer that is hidden.",
    hint: "Show the layer, or move the entity to a visible one.",
    fixable: false,
  },
  "unused-override": {
    severity: "warn",
    summary: "A prefab override names no child of the prefab, or no field that child can have.",
    hint: "Drop the override with revertOverride, or fix its key: `<childId>.<field.path>`.",
    fixable: true,
  },
  "follower-hits-solid": {
    severity: "warn",
    summary: "A path follower, or a solid riding it, swept along the path, runs into a solid.",
    hint: "Move the path or the solid so the follower's shape clears it along every segment, the loop's closing one included.",
    fixable: false,
  },
  "solid-overlap": {
    severity: "info",
    summary: "Two static solids overlap; they may be one shape drawn twice or mergeable.",
    hint: "Merge them into one shape, or move one so they only touch.",
    fixable: false,
  },
  "stale-base": {
    severity: "error",
    summary:
      "A batch's `base` hash doesn't match the current scene, so its bulk references may point at other entries.",
    hint: "Re-read the scene and retry against the returned hash, or promote the bulk entry to an id so the reference stays stable.",
    fixable: false,
  },
  "ref-not-found": {
    severity: "error",
    summary: "An op refers to an id or bulk entry that doesn't exist.",
    hint: "Re-read the scene for the current ids and `~key:index` references.",
    fixable: false,
  },
  "op-invalid": {
    severity: "error",
    summary: "An op is malformed, or applying it would leave an entity that fails the schema.",
    hint: "Check the op against `vp run scene schema ops` and the entity against `vp run scene schema scene`.",
    fixable: false,
  },
  "id-taken": {
    severity: "error",
    summary: "An op would create or rename to an id that is already in use.",
    hint: "Pick an unused id, or omit it on add to get a generated one.",
    fixable: false,
  },
  "asset-missing": {
    severity: "error",
    summary: "A reference names an asset the project has no live asset for.",
    hint: "Point it at an existing asset (the message suggests the closest id), restore the asset from the trash, or remove the reference.",
    fixable: false,
  },
  "asset-kind": {
    severity: "error",
    summary:
      "An asset's kind isn't registered, doesn't fit the file's extension or the op, or a one-per-project kind has a second asset.",
    hint: "Use a kind the project registers, with a path whose extension that kind matches; an immutable kind (recordings) can't take new content.",
    fixable: false,
  },
  "asset-in-use": {
    severity: "error",
    summary: "An asset can't be deleted while other assets reference it.",
    hint: "Remove or repoint the references `detail.referrers` lists, or delete with `force` and fix them after.",
    fixable: false,
  },
  "asset-id-taken": {
    severity: "error",
    summary: "Two live assets share an id.",
    hint: "Rename the later one with changeAssetId; the project's server appends -2 until then.",
    fixable: false,
  },
  "path-taken": {
    severity: "error",
    summary: "Two live assets share a path, or paths that differ only in case.",
    hint: "Move or rename one of them; the project's server suffixes the later one's file name until then.",
    fixable: false,
  },
  "hash-mismatch": {
    severity: "error",
    summary:
      "Bytes don't match the content hash claimed for them, or an op names a hash the content store doesn't hold.",
    hint: "Upload the bytes to the content store first and use the hash it returns.",
    fixable: false,
  },
  "code-skew": {
    severity: "warn",
    summary:
      "A newer build of the game's code changed this kind's schema, so this client can only read docs of that kind.",
    hint: "Reload with the newer build to edit again.",
    fixable: false,
  },
  "asset-too-large": {
    severity: "error",
    summary: "An asset is larger than its kind allows.",
    hint: "Shrink the file, or split it into several assets.",
    fixable: false,
  },
  "import-failed": {
    severity: "error",
    summary:
      "An imported file couldn't be read as its kind: its header or JSON isn't what the kind expects.",
    hint: "Re-export the file from its tool, or import it as another kind.",
    fixable: false,
  },
  "quota-exceeded": {
    severity: "error",
    summary: "The project is out of room for what the op adds.",
    hint: "The message names the limit; empty the trash or remove unused assets, then retry.",
    fixable: false,
  },
};

/**
 * A `SceneIssue` with the code's severity and hint filled in. A game's codes
 * are looked up in `codes`, which is `registry.issueCodes` for them.
 */
export function makeIssue(
  code: IssueCode,
  fields: Partial<Omit<SceneIssue, "code">> & { message: string },
  codes: Readonly<Record<string, IssueCodeInfo>> = ISSUE_CODES,
): SceneIssue {
  const info = codes[code];
  if (!info) throw new Error(`makeIssue: unknown issue code "${code}"`);
  return {
    ...fields,
    severity: fields.severity ?? info.severity,
    code,
    message: fields.message,
    entityIds: fields.entityIds ?? [],
    hint: fields.hint ?? info.hint,
  };
}

function escapeSegment(segment: string | number): string {
  return String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
}

/** RFC 6901 pointer from path segments; `[]` is the root, `""`. */
export function jsonPointer(segments: readonly (string | number)[]): string {
  return segments.map((s) => `/${escapeSegment(s)}`).join("");
}

export function pointerSegments(pointer: string): string[] {
  if (pointer === "") return [];
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** The line of `pointer`, or of its nearest ancestor that has one. */
export function lineAt(lines: ReadonlyMap<string, number>, pointer: string): number | undefined {
  let p = pointer;
  for (;;) {
    const line = lines.get(p);
    if (line !== undefined) return line;
    if (p === "") return undefined;
    p = p.slice(0, p.lastIndexOf("/"));
  }
}
