/** Validation across a project's docs: each doc's own checks, then the checks that read other docs. */
import { makeIssue } from "../scene/issues";
import type { SceneIssue } from "../scene/types";
import { parseAssetDoc, type KindEnv, type KindRegistry } from "./kinds";
import { byPathThenKey, docLookup, type DocKindDef } from "./kinds/define";
import { withId } from "./snapshot";
import type { AssetEntry, AssetId, AssetKindName, ProjectView } from "./types";

/**
 * Every doc's `validate` (through `parseAssetDoc`: JSON, migrations,
 * schema, then the kind's own checks), then every kind's `crossValidate`
 * over a lookup of the docs in `texts` that parse, in path order. A doc
 * with no text in `texts` is skipped. Each issue names its doc first in
 * `entityIds`. Never throws: a check that throws reports as a `schema`
 * error on its doc.
 */
export function validateProject(
  view: ProjectView,
  texts: ReadonlyMap<AssetId, string>,
  kinds: KindRegistry,
  env: KindEnv,
): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const entries = [...view.byId.values()].sort(byPathThenKey);
  const docs: { entry: AssetEntry; def: DocKindDef }[] = [];
  for (const entry of entries) {
    const def = kinds.get(entry.kind);
    if (def?.storage === "doc") docs.push({ entry, def });
  }

  const parsed = new Map<AssetKindName, Map<AssetId, unknown>>();
  for (const { entry, def } of docs) {
    const text = texts.get(entry.id);
    if (text === undefined) continue;
    const found = guarded(entry, "validating", () => {
      const read = parseAssetDoc(def, text, env);
      if (read.ok) {
        const ofKind = parsed.get(entry.kind) ?? new Map<AssetId, unknown>();
        parsed.set(entry.kind, ofKind.set(entry.id, read.value));
      }
      return read.issues;
    });
    issues.push(...withId(entry.id, found));
  }

  const lookup = docLookup(parsed);
  for (const { entry, def } of docs) {
    if (!def.crossValidate || !parsed.get(entry.kind)?.has(entry.id)) continue;
    const value = lookup.doc(entry.kind, entry.id);
    const found = guarded(entry, "cross-validating", () => def.crossValidate!(value, lookup, env));
    issues.push(...withId(entry.id, found));
  }
  return issues;
}

function guarded(
  entry: AssetEntry,
  doing: string,
  check: () => readonly SceneIssue[],
): readonly SceneIssue[] {
  try {
    return check();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return [
      makeIssue("schema", {
        message: `${doing} "${entry.id}" (${entry.path}) threw: ${detail}`,
        entityIds: [entry.id],
      }),
    ];
  }
}
