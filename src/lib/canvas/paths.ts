/**
 * Vault paths: the rules every canvas, note and attachment path follows, so
 * the Obsidian plugin can write any of them as a file on any OS. Shared by
 * the site, `canvas-sync` and the plugin, so no `@/` imports.
 *
 * A path is relative to its scope's folder, `/`-separated, with no leading
 * or trailing slash. Folders are implicit in paths, as in Obsidian.
 */

type PathKind = "canvas" | "note" | "image";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"]);

const MAX_SEGMENT_BYTES = 255;
const MAX_PATH_BYTES = 1_024;

// oxlint-disable-next-line no-control-regex -- control characters are exactly what's refused
const FORBIDDEN_CHARS = /[\\:*?"<>|\u0000-\u001f\u007f]/;
// oxlint-disable-next-line no-control-regex
const FORBIDDEN_CHARS_GLOBAL = /[\\:*?"<>|\u0000-\u001f\u007f]/g;

/** Windows refuses these as a file's stem, whatever the extension. */
const RESERVED_STEMS = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

const encoder = new TextEncoder();
const byteLength = (s: string) => encoder.encode(s).length;

function extensionOf(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function pathKind(path: string): PathKind | null {
  const ext = extensionOf(path);
  if (ext === "canvas") return "canvas";
  if (ext === "md") return "note";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return null;
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The parent folder, or `""` at the scope's root. */
export function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** What the site shows as the title: the basename without its extension. */
export function pathTitle(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

/**
 * What uniqueness compares, mirroring the database's generated `path_key`
 * (`lower(normalize(path, NFC))`). The database is the authority; this is for
 * checks before a round trip.
 */
export function pathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

type PathProblem =
  | "empty"
  | "too-long"
  | "segment-too-long"
  | "empty-segment"
  | "forbidden-character"
  | "edge-space-or-dot"
  | "reserved-name"
  | "wrong-kind";

type PathCheck = { ok: true; path: string; kind: PathKind } | { ok: false; problem: PathProblem };

function segmentProblem(segment: string): PathProblem | null {
  if (!segment) return "empty-segment";
  if (byteLength(segment) > MAX_SEGMENT_BYTES) return "segment-too-long";
  if (FORBIDDEN_CHARS.test(segment)) return "forbidden-character";
  if (/^[ .]|[ .]$/.test(segment)) return "edge-space-or-dot";
  const stem = segment.split(".")[0]!.toLowerCase();
  if (RESERVED_STEMS.has(stem)) return "reserved-name";
  return null;
}

/**
 * Validates a path and returns it NFC-normalised. `expect` refuses a valid
 * path of another kind, so a canvas can't be saved as `Plan.md`.
 */
export function checkPath(input: string, expect?: PathKind): PathCheck {
  const path = input.normalize("NFC");
  if (!path) return { ok: false, problem: "empty" };
  if (byteLength(path) > MAX_PATH_BYTES) return { ok: false, problem: "too-long" };
  for (const segment of path.split("/")) {
    const problem = segmentProblem(segment);
    if (problem) return { ok: false, problem };
  }
  const kind = pathKind(path);
  if (!kind || (expect && kind !== expect)) return { ok: false, problem: "wrong-kind" };
  return { ok: true, path, kind };
}

export const PATH_PROBLEM_MESSAGES: Record<PathProblem, string> = {
  empty: "Give it a name.",
  "too-long": "That path is too long.",
  "segment-too-long": "One of those names is too long.",
  "empty-segment": "Folder names can't be empty.",
  "forbidden-character": "Names can't contain \\ : * ? \" < > |",
  "edge-space-or-dot": "Names can't start or end with a space or a dot.",
  "reserved-name": "That name is reserved on Windows.",
  "wrong-kind": "That file type doesn't belong here.",
};

function truncateBytes(s: string, max: number): string {
  let out = s;
  while (byteLength(out) > max) out = out.slice(0, -1);
  return out;
}

function repairSegment(segment: string): string {
  let out = segment.normalize("NFC").replace(FORBIDDEN_CHARS_GLOBAL, "-");
  out = out.replace(/^[ .]+|[ .]+$/g, "");
  if (!out) out = "Untitled";
  const stem = out.split(".")[0]!.toLowerCase();
  if (RESERVED_STEMS.has(stem)) out = `${out.slice(0, stem.length)}_${out.slice(stem.length)}`;
  return truncateBytes(out, MAX_SEGMENT_BYTES);
}

/**
 * Turns any name into a valid path of `kind`: characters replaced, edges
 * trimmed, the extension forced (an image keeps its own if it has one), and ` 2`, ` 3`… appended until `isTaken`
 * says no. Used on import and wherever a name is generated rather than typed.
 */
export function repairPath(
  input: string,
  kind: PathKind,
  isTaken: (key: string) => boolean = () => false,
): string {
  const inputExt = extensionOf(input);
  const ext =
    kind === "canvas"
      ? "canvas"
      : kind === "note"
        ? "md"
        : IMAGE_EXTENSIONS.has(inputExt)
          ? inputExt
          : "png";
  const segments = input
    .split("/")
    .filter((s) => s.trim())
    .map(repairSegment);
  if (segments.length === 0) segments.push("Untitled");

  let name = segments.pop()!;
  if (extensionOf(name) === ext) name = name.slice(0, -(ext.length + 1)) || "Untitled";
  const folder = segments.join("/");
  const stem = truncateBytes(name, MAX_SEGMENT_BYTES - ext.length - 8);

  for (let n = 1; ; n++) {
    const candidate = joinPath(folder, `${n === 1 ? stem : `${stem} ${n}`}.${ext}`);
    if (!isTaken(pathKey(candidate))) return candidate;
  }
}

export interface FolderNode<T> {
  name: string;
  /** `""` for the root. */
  path: string;
  folders: FolderNode<T>[];
  files: T[];
}

/** Builds the folder tree a scope's paths imply, folders and files sorted by name. */
export function folderTree<T extends { path: string }>(items: readonly T[]): FolderNode<T> {
  const root: FolderNode<T> = { name: "", path: "", folders: [], files: [] };
  const byPath = new Map<string, FolderNode<T>>([["", root]]);

  const folderFor = (path: string): FolderNode<T> => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const parent = folderFor(dirname(path));
    const node: FolderNode<T> = { name: basename(path), path, folders: [], files: [] };
    parent.folders.push(node);
    byPath.set(path, node);
    return node;
  };

  for (const item of items) folderFor(dirname(item.path)).files.push(item);

  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
  for (const node of byPath.values()) {
    node.folders.sort((a, b) => byName(a.name, b.name));
    node.files.sort((a, b) => byName(basename(a.path), basename(b.path)));
  }
  return root;
}
