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

/**
 * True for any id the runtime made rather than the loaded scene file: with
 * `#` in it (a spawn, a runtime instance's children such as `gate#2/door`)
 * or a sublevel label before a `:` (`cellar:door`, `cellar:~solid:0`; a
 * bulk id's own `~solid:0` isn't one).
 */
export function isRuntimeId(id: string): boolean {
  return id.includes("#") || sublevelLabelOf(id) !== null;
}

const LABEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

/**
 * The sublevel label `id` is prefixed with, or null: `cellar` for
 * `cellar:door`, `cellar:lamp-1/bulb` and `cellar:~solid:0`.
 */
export function sublevelLabelOf(id: string): string | null {
  const colon = id.indexOf(":");
  if (colon <= 0) return null;
  const label = id.slice(0, colon);
  return LABEL_PATTERN.test(label) ? label : null;
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

/**
 * A sublevel entity's id: `<label>:<id>`, or `<label>:<inst>/<child>` for
 * an instance's child, the label an `ID_PATTERN` word. `:` is outside the
 * scene and runtime id patterns, so a sublevel id never names a main-scene
 * entity, a runtime spawn or anything a scene file can hold.
 */
export const SUBLEVEL_ID_PATTERN =
  /^[a-z0-9][a-z0-9-]{0,47}:[a-z0-9][a-z0-9-]{0,47}(?:\/[a-z0-9][a-z0-9-]{0,47}){0,8}$/;

/** The id the sublevel `label` gives its entity `id`: `sublevelId("cellar", "door")` is `"cellar:door"`. */
export function sublevelId(label: string, id: string): string {
  return `${label}:${id}`;
}

/** `cellar:door` as `{ label: "cellar", id: "door" }`; null for anything that isn't a sublevel id. */
export function parseSublevelId(id: string): { label: string; id: string } | null {
  if (!SUBLEVEL_ID_PATTERN.test(id)) return null;
  const colon = id.indexOf(":");
  return { label: id.slice(0, colon), id: id.slice(colon + 1) };
}
