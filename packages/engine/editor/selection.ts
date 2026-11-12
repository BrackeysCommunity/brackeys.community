import type { Ref } from "../scene/types";

export type SelectMode = "replace" | "add" | "toggle" | "range";

/**
 * The next selection. `range` replaces it with everything in `order`
 * between the anchor (the last selected ref) and `refs[0]`, and keeps the
 * anchor last so the next range starts from the same place. Without an
 * anchor in `order` it selects `refs[0]` alone.
 */
export function select(
  sel: readonly Ref[],
  refs: readonly Ref[],
  mode: SelectMode,
  order?: readonly Ref[],
): Ref[] {
  switch (mode) {
    case "replace":
      return dedupe(refs);
    case "add":
      return dedupe([...sel, ...refs]);
    case "toggle": {
      const next = [...sel];
      for (const r of refs) {
        const at = next.indexOf(r);
        if (at >= 0) next.splice(at, 1);
        else next.push(r);
      }
      return next;
    }
    case "range": {
      const target = refs[0];
      const anchor = sel[sel.length - 1];
      if (target === undefined) return [...sel];
      const from = anchor === undefined || !order ? -1 : order.indexOf(anchor);
      const to = order ? order.indexOf(target) : -1;
      if (from < 0 || to < 0) return [target];
      const span = order!.slice(Math.min(from, to), Math.max(from, to) + 1);
      return [...span.filter((r) => r !== anchor), anchor!];
    }
  }
}

/** Drops refs the document no longer has. */
export function prune(sel: readonly Ref[], existing: Iterable<Ref>): Ref[] {
  const has = existing instanceof Set ? existing : new Set(existing);
  return sel.filter((r) => has.has(r));
}

/** Follows renames and shifted bulk indices; a ref mapped to `null` is dropped. */
export function remap(
  sel: readonly Ref[],
  renames: ReadonlyMap<Ref, Ref | null> | Readonly<Record<Ref, Ref | null>>,
): Ref[] {
  const get = (r: Ref) =>
    renames instanceof Map
      ? renames.get(r)
      : Object.hasOwn(renames, r)
        ? (renames as Record<Ref, Ref | null>)[r]
        : undefined;
  const out: Ref[] = [];
  for (const r of sel) {
    const to = get(r);
    if (to !== null) out.push(to ?? r);
  }
  return dedupe(out);
}

function dedupe(refs: readonly Ref[]): Ref[] {
  return [...new Set(refs)];
}
