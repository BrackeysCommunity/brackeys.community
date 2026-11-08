import { ID_PATTERN } from "../game/fields";
import type { AssetKey, ProjectId } from "./types";

/**
 * Sync doc names: `project:<project>` for a project's registry,
 * `scene:<project>.<key>` for a scene and `asset:<project>.<key>` for every
 * other doc kind. Names use the asset's key, which never changes, so
 * changing an asset's id never renames its doc.
 */
export type DocName =
  | { kind: "project"; project: ProjectId }
  | { kind: "scene"; project: ProjectId; key: AssetKey }
  | { kind: "asset"; project: ProjectId; key: AssetKey };

export type DocNameKind = DocName["kind"];

export const DOC_NAME_KINDS: readonly DocNameKind[] = ["project", "scene", "asset"];

/** The longest name of each kind: a 48-character project id, and a 48-character key after the dot. */
export const DOC_NAME_MAX_LENGTH: Readonly<Record<DocNameKind, number>> = {
  project: 56,
  scene: 103,
  asset: 103,
};

const isKind = (s: string): s is DocNameKind => (DOC_NAME_KINDS as readonly string[]).includes(s);

/** The parts of a doc name, or null when it isn't one of the three forms. */
export function parseDocName(name: string): DocName | null {
  const colon = name.indexOf(":");
  if (colon < 0) return null;
  const kind = name.slice(0, colon);
  if (!isKind(kind) || name.length > DOC_NAME_MAX_LENGTH[kind]) return null;
  const rest = name.slice(colon + 1);
  if (kind === "project") return ID_PATTERN.test(rest) ? { kind, project: rest } : null;
  const dot = rest.indexOf(".");
  if (dot < 0) return null;
  const project = rest.slice(0, dot);
  const key = rest.slice(dot + 1);
  return ID_PATTERN.test(project) && ID_PATTERN.test(key) ? { kind, project, key } : null;
}

/** The doc name for `ref`; throws when its project id or key doesn't match ID_PATTERN. */
export function docNameOf(ref: DocName): string {
  if (!ID_PATTERN.test(ref.project)) throw new RangeError(`bad project id "${ref.project}"`);
  if (ref.kind === "project") return `project:${ref.project}`;
  if (!ID_PATTERN.test(ref.key)) throw new RangeError(`bad asset key "${ref.key}"`);
  return `${ref.kind}:${ref.project}.${ref.key}`;
}
