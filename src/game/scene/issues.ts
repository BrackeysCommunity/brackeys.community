import type { IssueCode, SceneIssue, Severity } from "./types";

export type IssueCodeInfo = { severity: Severity; summary: string; hint: string; fixable: boolean };

/**
 * Every code an engine tool can report. Codes, severities and the `fixable`
 * flag are public contract: renaming or removing one is a breaking change.
 */
export const ISSUE_CODES: Record<IssueCode, IssueCodeInfo> = {
  schema: {
    severity: "error",
    summary: "The document doesn't match the scene schema, isn't valid JSON, or has a bad `v`.",
    hint: "Fix the value at `path`; `expected` and `got` say what the schema wants. Print the schema with `vp run scene schema scene`.",
    fixable: false,
  },
  "unknown-key": {
    severity: "error",
    summary: "A key the schema doesn't define.",
    hint: "Rename it to the suggested key, or remove it. Bulk keys are `solid`, `solid:<material>`, `cloud` and `anchor`.",
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
    summary: "A reference targets an entity of a behavior it can't target.",
    hint: "Point the reference at an entity of an allowed behavior, or remove it.",
    fixable: true,
  },
  "spawn-missing": {
    severity: "error",
    summary: "The scene has no spawn point.",
    hint: "Add one with a setSpawn op; a spawn is the player's feet, so put it on top of a floor.",
    fixable: false,
  },
  "spawn-overlap": {
    severity: "error",
    summary: "Two spawns' 60x60 player boxes overlap.",
    hint: "Move one spawn at least 60px from the other horizontally or vertically.",
    fixable: false,
  },
  "poly-invalid": {
    severity: "error",
    summary: "A poly that is non-convex, self-intersecting or has zero area.",
    hint: "Make the points convex, split it into convex polys, or (on solid and sensor) use a chain.",
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
    summary: "A mover path with fewer than 2 points or a speed that isn't positive.",
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
    summary: "A mover path repeats a point, which the runtime skips.",
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
    summary: "Something lies outside the scene's bounds, where the camera and Shaper can't reach.",
    hint: "Move it inside `bounds`, or grow `bounds` with a setScene op.",
    fixable: true,
  },
  "wind-rotation": {
    severity: "warn",
    summary: "A rotated wind zone; the player ignores wind rotation today.",
    hint: "Set rot to 0.",
    fixable: true,
  },
  "no-goal": {
    severity: "warn",
    summary: "The scene has no goal or exit sensor, so a run can't finish.",
    hint: 'Add a sensor entity with kind "goal" or "exit".',
    fixable: false,
  },
  "no-kill-plane": {
    severity: "info",
    summary: "Nothing stops a fall: no hazard sensor spans the bottom of the bounds.",
    hint: 'Add a hazard sensor across the full width of bounds near maxY, e.g. ["box", cx, maxY, halfWidth, 8].',
    fixable: false,
  },
  "hidden-layer": {
    severity: "info",
    summary: "An entity sits on a layer that is hidden.",
    hint: "Show the layer, or move the entity to a visible one.",
    fixable: false,
  },
  "unused-override": {
    severity: "info",
    summary: "A prefab override sets a field to the prefab's own value.",
    hint: "Remove the override.",
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
};

export function makeIssue(
  code: IssueCode,
  fields: Partial<Omit<SceneIssue, "code">> & { message: string },
): SceneIssue {
  const info = ISSUE_CODES[code];
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
