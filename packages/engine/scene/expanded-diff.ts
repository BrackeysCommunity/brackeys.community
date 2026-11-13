import type { SceneDiff } from "../game/live";
import { sameValue } from "../project/canonical";
import type { ExpandedScene, RuntimeEntity } from "./types";

/**
 * The entities that differ between `before` and `after`: `added` and
 * `changed` (as `after` holds them) in `after`'s order, `removed` ids in
 * `before`'s.
 */
export function diffEntities(
  before: readonly RuntimeEntity[],
  after: readonly RuntimeEntity[],
): { added: RuntimeEntity[]; removed: string[]; changed: RuntimeEntity[] } {
  const prev = new Map(before.map((e) => [e.id, e]));
  const next = new Set(after.map((e) => e.id));
  const removed = before.filter((e) => !next.has(e.id)).map((e) => e.id);
  const added = after.filter((e) => !prev.has(e.id));
  const changed = after.filter((e) => {
    const was = prev.get(e.id);
    return was !== undefined && !sameValue(was, e);
  });
  return { added, removed, changed };
}

const headerOf = (s: ExpandedScene) => ({ name: s.name, bounds: s.bounds, settings: s.settings });

/**
 * What changed between two expansions of a scene: `added` and `changed` in
 * `next`'s order, `removed` in `prev`'s, and `header` when the name, bounds
 * or settings differ.
 */
export function diffExpanded(prev: ExpandedScene, next: ExpandedScene): SceneDiff {
  const { added, removed, changed } = diffEntities(prev.entities, next.entities);
  return {
    added: added.map((e) => e.id),
    removed,
    changed: changed.map((e) => e.id),
    header: !sameValue(headerOf(prev), headerOf(next)),
  };
}
