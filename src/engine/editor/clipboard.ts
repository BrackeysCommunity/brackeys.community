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
import type { OpBatch, Pt, Ref, SceneDefinition, SceneIssue } from "../scene/types";
import type { SnapSettings } from "./tools";

export { nextFreeId } from "../scene/fragment";

/** The selection as clipboard text: a pretty-printed `SceneFragment`, for `text/plain`. */
export function copySelection(
  def: SceneDefinition,
  refs: readonly Ref[],
  registry: Registry,
): string {
  return `${JSON.stringify(fragmentOf(def, refs, registry), null, 2)}\n`;
}

export type PasteOptions = {
  def: SceneDefinition;
  registry: Registry;
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
 * cleared with a `dangling-ref` warning. One batch of `add` and `addBulk`
 * ops; `select` names what it adds.
 */
export function pasteFragment(input: string | SceneFragment, opts: PasteOptions): PasteResult {
  const { def, registry } = opts;
  const parsed = parseFragment(input, registry);
  if (!parsed.ok) return parsed;
  const fragment = parsed.fragment;
  const bulk = Object.entries(fragment.bulk ?? {}).filter(([, entries]) => entries.length > 0);
  if (fragment.entities.length === 0 && bulk.length === 0) {
    return {
      ok: false,
      issues: [makeIssue("schema", { message: "the fragment is empty", path: "" })],
    };
  }

  let by: Pt = [0, 0];
  const box = opts.at && fragmentBounds(fragment, registry);
  if (opts.at && box) {
    by = [
      snapDelta(opts.at[0] - (box.minX + box.maxX) / 2, opts.snap),
      snapDelta(opts.at[1] - (box.minY + box.maxY) / 2, opts.snap),
    ];
  }
  if (opts.offset) by = [by[0] + Math.round(opts.offset[0]), by[1] + Math.round(opts.offset[1])];

  const { ops, select, issues } = placeFragment(fragment, def, registry, by);
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
 * (Mod+D). `from` is the scene the selection is read from when it differs
 * from `def`, e.g. the resolved view.
 */
export function duplicateSelection(
  def: SceneDefinition,
  refs: readonly Ref[],
  registry: Registry,
  step: number,
  opts: { from?: SceneDefinition } = {},
): PasteResult {
  const result = pasteFragment(fragmentOf(opts.from ?? def, refs, registry), {
    def,
    registry,
    offset: [step, step],
  });
  return result.ok ? { ...result, batch: { ...result.batch, label: "Duplicate" } } : result;
}

/** The clipboard text for the selection and the batch that removes it. */
export function cutSelection(
  def: SceneDefinition,
  refs: readonly Ref[],
  registry: Registry,
): { text: string; batch: OpBatch } {
  const bulk = refs.some((r) => r.startsWith("~"));
  return {
    text: copySelection(def, refs, registry),
    batch: {
      label: "Cut",
      ...(bulk ? { base: sceneHash(def) } : {}),
      ops: refs.length > 0 ? [{ op: "remove", refs: [...new Set(refs)] }] : [],
    },
  };
}
