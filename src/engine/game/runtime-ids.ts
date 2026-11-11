/**
 * Ids of entities made at runtime: `<name>#<label>`, where the name is a
 * type's or a prefab's and the label a per-name counter or a game's own
 * word. `#` is outside the scene id patterns, so a runtime id never names
 * a scene entity and can't be written into a scene.
 */

/** `<name>#<label>`: the name an `ID_PATTERN` id, the label digits (a counter) or an `ID_PATTERN` word. */
export const RUNTIME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}#[a-z0-9][a-z0-9-]{0,47}$/;

/** The id the `n`th spawn of `name` gets: `runtimeId("bullet", 12)` is `"bullet#12"`. */
export function runtimeId(name: string, n: number): string {
  return `${name}#${n}`;
}

/** True for any id with `#` in it, a runtime instance's children (`gate#2/door`) included. */
export function isRuntimeId(id: string): boolean {
  return id.includes("#");
}

/**
 * `gate#2/door` as `{ name: "gate", label: "2", child: "door" }`; null for
 * anything that isn't a runtime id or a child of one.
 */
export function parseRuntimeId(id: string): { name: string; label: string; child?: string } | null {
  const slash = id.indexOf("/");
  const head = slash === -1 ? id : id.slice(0, slash);
  if (!RUNTIME_ID_PATTERN.test(head)) return null;
  const hash = head.indexOf("#");
  const out: { name: string; label: string; child?: string } = {
    name: head.slice(0, hash),
    label: head.slice(hash + 1),
  };
  if (slash !== -1) {
    const child = id.slice(slash + 1);
    if (child === "" || child.includes("#")) return null;
    out.child = child;
  }
  return out;
}
