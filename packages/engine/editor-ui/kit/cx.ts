type ClassValue = string | false | null | undefined | 0;

/** Joins the truthy class names, for the kit's `je-*` classes and a caller's own. */
export function cx(...classes: readonly ClassValue[]): string {
  let out = "";
  for (const c of classes) if (c) out = out ? `${out} ${c}` : c;
  return out;
}
