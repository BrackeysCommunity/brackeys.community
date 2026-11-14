import type { Registry } from "../game/types";
import { pxPerMetreOf } from "../game/units";
import {
  fragmentBounds,
  fragmentOf,
  parseFragment,
  placeFragment,
  takenIds,
  withSubtrees,
  type SceneFragment,
} from "../scene/fragment";
import { sceneHash } from "../scene/hash";
import { makeIssue } from "../scene/issues";
import { parseChildRef, sceneFrames } from "../scene/resolve";
import type {
  OpBatch,
  PrefabLibrary,
  Pt,
  Ref,
  SceneDefinition,
  SceneIssue,
  SceneOp,
} from "../scene/types";
import { snapToPixel } from "../scene/units";
import { snapToGrid } from "./snap";
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
  /** Centre the fragment's box here (the cursor, world metres). Omitted, it keeps its own position. */
  at?: Pt;
  /** Grid snapping for `at`: the move is a whole number of grid steps, so grid-aligned pieces stay aligned. */
  snap?: SnapSettings;
  /** Added after centring, metres on whole world px, e.g. one grid step for duplicate. */
  offset?: Pt;
};

export type PasteResult =
  | { ok: true; batch: OpBatch; select: Ref[]; issues: SceneIssue[] }
  | { ok: false; issues: SceneIssue[] };

function snapDelta(d: number, snap: SnapSettings | undefined, pxPerMetre: number): number {
  return snap?.enabled && snap.step > 0
    ? snapToGrid(d, snap.step, pxPerMetre)
    : snapToPixel(d, pxPerMetre);
}

/**
 * The batch that pastes clipboard text into `def`: the fragment's box
 * centred under `at` and snapped, ids that clash renamed (`lift` →
 * `lift-2`), references inside the fragment following the renames, and
 * references out of it kept when their target exists in `def`, else
 * cleared with a `dangling-ref` warning. The fragment's roots land under
 * nothing, and what sits under them comes along. Instances keep their
 * prefab, params and overrides under a fresh id when theirs is taken; one
 * whose prefab isn't in `prefabs` is left out with a `prefab-unknown`
 * warning. One batch of `addBulk`, `add` and `instantiate` ops; `select`
 * names what it adds.
 */
export function pasteFragment(input: string | SceneFragment, opts: PasteOptions): PasteResult {
  const pasted = pasteWithIds(input, opts);
  if (!pasted.ok) return pasted;
  const { ids: _ids, ...result } = pasted;
  return result;
}

function pasteWithIds(
  input: string | SceneFragment,
  opts: PasteOptions,
): (PasteResult & { ok: false }) | (PasteResult & { ok: true; ids: Record<string, Ref> }) {
  const { def, registry, prefabs } = opts;
  const ppm = pxPerMetreOf(registry);
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
      snapDelta(opts.at[0] - (box.minX + box.maxX) / 2, opts.snap, ppm),
      snapDelta(opts.at[1] - (box.minY + box.maxY) / 2, opts.snap, ppm),
    ];
  }
  if (opts.offset)
    by = [snapToPixel(by[0] + opts.offset[0], ppm), snapToPixel(by[1] + opts.offset[1], ppm)];

  const { ops, select, ids, issues } = placeFragment(fragment, def, registry, by, prefabs);
  if (ops.length === 0) return { ok: false, issues };
  const count = select.length;
  return {
    ok: true,
    batch: { label: count === 1 ? "Paste" : `Paste ${count} items`, ops },
    select,
    ids,
    issues,
  };
}

/**
 * The selection copied and pasted one grid `step` (metres) down and to the right
 * (Mod+D), instances and what sits under the selection included. Each copy
 * of an entity or instance with a parent goes back under that parent, where
 * a `reparent` keeps it next to its original. `from` is the scene the
 * selection is read from when it differs from `def`.
 */
export function duplicateSelection(
  def: SceneDefinition,
  refs: readonly Ref[],
  registry: Registry,
  step: number,
  opts: { from?: SceneDefinition; prefabs?: PrefabLibrary } = {},
): PasteResult {
  const { prefabs } = opts;
  const from = opts.from ?? def;
  const fragment = fragmentOf(from, refs, registry, prefabs);
  const result = pasteWithIds(fragment, {
    def,
    registry,
    ...(prefabs ? { prefabs } : {}),
    offset: [step, step],
  });
  if (!result.ok) return result;
  const { ids, ...pasted } = result;
  const frames = sceneFrames(from, registry, prefabs);
  const copied = new Set(withSubtrees(from, refs, registry, prefabs).map((e) => e.ref));
  const here = takenIds(def);
  const under = new Map<Ref, Ref[]>();
  for (const root of [...fragment.entities, ...(fragment.instances ?? [])]) {
    if (root.parent !== undefined || !copied.has(root.id)) continue;
    const copy = ids[root.id];
    const parent = frames.parentOf(root.id);
    if (copy === undefined || parent === undefined) continue;
    if (!here.has(parseChildRef(parent)?.instance ?? parent)) continue;
    under.set(parent, [...(under.get(parent) ?? []), copy]);
  }
  const reparents = [...under].map(
    ([parent, refs]) => ({ op: "reparent", refs, parent }) satisfies SceneOp,
  );
  return {
    ...pasted,
    batch: { ...pasted.batch, label: "Duplicate", ops: [...pasted.batch.ops, ...reparents] },
  };
}

/**
 * The clipboard text for the selection and the batch that removes it,
 * instances and what sits under the selection included, each child before
 * its parent. An instance's child (`gate-2/door`) can't be removed from
 * its prefab, so the batch turns it off on that instance with an
 * `<child>.off` override; one whose instance is cut as well is left to it.
 */
export function cutSelection(
  def: SceneDefinition,
  refs: readonly Ref[],
  registry: Registry,
  prefabs?: PrefabLibrary,
): { text: string; batch: OpBatch } {
  const tree = withSubtrees(def, [...new Set(refs)], registry, prefabs);
  const own = tree
    .filter(({ ref }) => !parseChildRef(ref))
    .sort((a, b) => b.depth - a.depth)
    .map(({ ref }) => ref);
  const removed = new Set(own);
  const offs = new Map<string, Record<string, unknown>>();
  for (const { ref } of tree) {
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
