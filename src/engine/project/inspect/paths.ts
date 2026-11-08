import type { AssetPath } from "../types";

const isName = (segment: string) => segment !== "" && segment !== "." && segment !== "..";

/**
 * The project path of a file another file names from beside `from` (an
 * atlas's `meta.image`, a font's page). Backslashes read as slashes; `.` and
 * `..` resolve against `from`'s folder. A name that is absolute or climbs
 * out of the project keeps only its file name, so it can still find a
 * sibling. Null when the name ends in no file name.
 */
export function siblingPath(from: AssetPath, name: string): AssetPath | null {
  const segments = name.replace(/\\/g, "/").split("/");
  const base = segments[segments.length - 1] ?? "";
  if (!isName(base)) return null;
  const folder = from.split("/").slice(0, -1);
  const sibling = [...folder, base].join("/");
  if (segments[0] === "" || /^[A-Za-z]:$/.test(segments[0] ?? "")) return sibling;
  const out = [...folder];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") out.push(segment);
    else if (out.pop() === undefined) return sibling;
  }
  return out.join("/");
}
