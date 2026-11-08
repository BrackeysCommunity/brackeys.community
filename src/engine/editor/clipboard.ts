import type { Registry } from "../game/types";
import {
  fragmentBounds,
  fragmentOf,
  parseFragment,
  placeFragment,
  type SceneFragment,
} from "../scene/fragment";
import { sceneHash } from "../scene/hash";
import { makeIssue } from "../scene/issues";
import { parseChildRef } from "../scene/resolve";
import type {
  OpBatch,
  PrefabLibrary,
  Pt,
  Ref,
  SceneDefinition,
  SceneIssue,
  SceneOp,
} from "../scene/types";
import type { SnapSettings } from "./tools";

export { nextFreeId } from "../scene/fragment";

/**
 * The selection as clipboard text: a pretty-printed `SceneFragment`, for
 * `text/plain`. `def` is the document; with `prefabs`, refs to instance
 * children (`gate-2/door`) copy them as plain entities.
 */
export function copySelection(
  def: SceneDefinition,
  refs: readonly Ref[],
  registry: Registry,
  prefabs?: PrefabLibrary,
): string {
  return `${JSON.stringify(fragmentOf(def, refs, registry, prefabs), null, 2)}\n`;
}

export type PasteOptions = {
  def: SceneDefinition;
  registry: Registry;
  /** The project's prefabs: a pasted instance needs its prefab here, and its box counts in centring. */
  prefabs?: PrefabLibrary;
  /** Centre the fragment's box here (the cursor, world px). Omitted, it keeps its own position. */
  at?: Pt;
  /** Grid snapping for `at`: the move is a whole number of grid steps, so grid-aligned pieces stay aligned. */
  snap?: SnapSettings;
  /** Added after centring, e.g. one grid step for duplicate. */
  offset?: Pt;
};

export type PasteResult =
  | { ok: true; batch: OpBatch; select: Ref[]; issues: SceneIssue[] }
  | { ok: false; issues: SceneIssue[] };

function snapDelta(d: number, snap: SnapSettings | undefined): number {
  return snap?.enabled ? Math.round(d / snap.step) * snap.step : Math.round(d);
}

/**
 * The batch that pastes clipboard text into `def`: the fragment's box
 * centred under `at` and snapped, ids that clash renamed (`lift` →
 * `lift-2`), references inside the fragment following the renames, and
 * references out of it kept when their target exists in `def`, else
 * cleared with a `dangling-ref` warning. Instances keep their prefab,
 * params and overrides under a fresh id when theirs is taken; one whose
 * prefab isn't in `prefabs` is left out with a `prefab-unknown` warning.
 * One batch of `addBulk`, `add` and `instantiate` ops; `select` names what
 * it adds.
 */
export function pasteFragment(input: string | SceneFragment, opts: PasteOptions): PasteResult {
  const { def, registry, prefabs } = opts;
  const parsed = parseFragment(input, registry);
  if (!parsed.ok) return parsed;
  const fragment = parsed.fragment;
  const bulk = Object.entries(fragment.bulk ?? {}).filter(([, entries]) => entries.length > 0);
  if (fragment.entities.length === 0 && bulk.length === 0 && !fragment.instances?.length) {
    return {
      ok: false,
      issues: [makeIssue("schema", { message: "the fragment is empty", path: "" })],
    };
  }

  let by: Pt = [0, 0];
  const box = opts.at && fragmentBounds(fragment, registry, prefabs);
  if (opts.at && box) {
    by = [
      snapDelta(opts.at[0] - (box.minX + box.maxX) / 2, opts.snap),
      snapDelta(opts.at[1] - (box.minY + box.maxY) / 2, opts.snap),
    ];
  }
  if (opts.offset) by = [by[0] + Math.round(opts.offset[0]), by[1] + Math.round(opts.offset[1])];

  const { ops, select, issues } = placeFragment(fragment, def, registry, by, prefabs);
  if (ops.length === 0) return { ok: false, issues };
  const count = select.length;
  return {
    ok: true,
    batch: { label: count === 1 ? "Paste" : `Paste ${count} items`, ops },
    select,
    issues,
  };
}

/**
 * The selection copied and pasted one grid `step` down and to the right
 * (Mod+D), instances included. `from` is the scene the selection is read
 * from when it differs from `def`.
 */
export function duplicateSelection(
  def: SceneDefinition,
  refs: readonly Ref[],
  registry: Registry,
  step: number,
  opts: { from?: SceneDefinition; prefabs?: PrefabLibrary } = {},
): PasteResult {
  const { prefabs } = opts;
  const result = pasteFragment(fragmentOf(opts.from ?? def, refs, registry, prefabs), {
    def,
    registry,
    ...(prefabs ? { prefabs } : {}),
    offset: [step, step],
  });
  return result.ok ? { ...result, batch: { ...result.batch, label: "Duplicate" } } : result;
}

/**
 * The clipboard text for the selection and the batch that removes it,
 * instances included. An instance's child (`gate-2/door`) can't be removed
 * from its prefab, so the batch turns it off on that instance with an
 * `<child>.off` override; one whose instance is cut as well is left to it.
 */
export function cutSelection(
  def: SceneDefinition,
  refs: readonly Ref[],
  registry: Registry,
  prefabs?: PrefabLibrary,
): { text: string; batch: OpBatch } {
  const unique = [...new Set(refs)];
  const own = unique.filter((r) => !parseChildRef(r));
  const removed = new Set(own);
  const offs = new Map<string, Record<string, unknown>>();
  for (const ref of unique) {
    const child = parseChildRef(ref);
    if (!child || removed.has(child.instance)) continue;
    offs.set(child.instance, { ...offs.get(child.instance), [`${child.child}.off`]: true });
  }
  const ops: SceneOp[] = [
    ...(own.length > 0 ? [{ op: "remove", refs: own } satisfies SceneOp] : []),
    ...[...offs].map(([ref, set]) => ({ op: "override", ref, set }) satisfies SceneOp),
  ];
  return {
    text: copySelection(def, refs, registry, prefabs),
    batch: { label: "Cut", base: sceneHash(def), ops },
  };
}
