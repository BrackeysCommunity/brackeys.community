import { ID_PATTERN } from "../game/fields";
import { makeIssue } from "../scene/issues";
import type { SceneIssue } from "../scene/types";
import type { KindRegistry } from "./kinds";
import { byCodeUnit, onePerProjectIssues } from "./kinds/define";
import type {
  AssetEntry,
  AssetId,
  AssetKey,
  AssetPath,
  CodeModuleInfo,
  ProjectState,
  ProjectTreeNode,
  ProjectView,
} from "./types";

// ─── Paths ───────────────────────────────────────────────

const SEGMENT = /^[A-Za-z0-9._ -]{1,96}$/;
const MAX_PATH = 255;
const MAX_SEGMENT = 96;
const MAX_ID = 48;

/** Why `path` isn't an asset path (see `AssetPath`), or null when it is one. */
export function assetPathProblem(path: string): string | null {
  if (path === "") return "the path is empty";
  if (path.length > MAX_PATH) return `the path is longer than ${MAX_PATH} characters`;
  if (path.startsWith("/"))
    return 'the path starts with "/"; paths are relative to the project root';
  if (path.includes("\\")) return 'the path contains "\\"; use "/"';
  for (const segment of path.split("/")) {
    if (segment === "." || segment === "..") return `the path has a "${segment}" segment`;
    if (!SEGMENT.test(segment))
      return segment === ""
        ? "the path has an empty segment"
        : `"${segment}" isn't a valid file or folder name: 1–96 letters, digits, ".", "_", "-" or spaces`;
  }
  return null;
}

/** The folder part of a path as a prefix: "" at the root, else ending in "/". */
export function folderPrefixOf(path: AssetPath): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
}

/**
 * The first folder of `path` that differs only in case from `other`'s at
 * the same depth, as [path's, other's] (`Art`, `art`); null when every
 * folder they share is spelled alike.
 */
export function folderCaseClash(path: AssetPath, other: AssetPath): [string, string] | null {
  const a = path.split("/");
  const b = other.split("/");
  const shared = Math.min(a.length, b.length) - 1;
  for (let i = 0; i < shared; i++) {
    if (a[i] === b[i]) continue;
    if (a[i]!.toLowerCase() !== b[i]!.toLowerCase()) return null;
    return [a.slice(0, i + 1).join("/"), b.slice(0, i + 1).join("/")];
  }
  return null;
}

/**
 * The live entry of `entries` that `path` clashes with, ignoring case: one
 * at the same path, a file where `path` needs a folder, a folder `path`
 * would replace, or a folder spelled in another case. Entries keyed
 * `except` and trashed ones don't count. Null when the path is free.
 */
export function pathClash<E extends Pick<AssetEntry, "key" | "id" | "path" | "deleted">>(
  entries: Iterable<E>,
  path: AssetPath,
  except?: AssetKey,
): { entry: E; message: string } | null {
  const folded = path.toLowerCase();
  for (const e of entries) {
    if (e.key === except || e.deleted) continue;
    const other = e.path.toLowerCase();
    let message: string | undefined;
    if (other === folded)
      message =
        e.path === path
          ? `"${path}" is taken by "${e.id}"`
          : `"${path}" differs only in case from "${e.path}" (${e.id})`;
    else if (folded.startsWith(`${other}/`))
      message = `"${path}" would put a folder where the file "${e.path}" (${e.id}) is`;
    else if (other.startsWith(`${folded}/`))
      message = `"${path}" is a folder that holds "${e.path}" (${e.id})`;
    else {
      const folders = folderCaseClash(path, e.path);
      if (folders)
        message = `the folder "${folders[0]}" differs only in case from "${folders[1]}", which holds "${e.path}" (${e.id})`;
    }
    if (message) return { entry: e, message };
  }
  return null;
}

export function fileNameOf(path: AssetPath): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** A file name split at its first dot after any leading ones: `yard.checks.json` → ["yard", ".checks.json"]. */
export function splitExtension(name: string): [stem: string, extension: string] {
  let start = 0;
  while (name[start] === ".") start++;
  const dot = name.indexOf(".", start);
  return dot < 0 ? [name, ""] : [name.slice(0, dot), name.slice(dot)];
}

/** `path` with `-<n>` before its extension, so the kind's suffix survives: `a/yard.checks.json` → `a/yard-2.checks.json`. */
export function suffixedPath(path: AssetPath, n: number): AssetPath {
  const folder = folderPrefixOf(path);
  const [stem, ext] = splitExtension(fileNameOf(path));
  const suffix = `-${n}`;
  const room = Math.min(MAX_SEGMENT, MAX_PATH - folder.length) - ext.length - suffix.length;
  return `${folder}${stem.slice(0, Math.max(1, room))}${suffix}${ext}`;
}

/** `id` with `-<n>`, cut so the result is still at most 48 characters. */
export function suffixedId(id: AssetId, n: number): AssetId {
  const suffix = `-${n}`;
  return `${id.slice(0, MAX_ID - suffix.length).replace(/-+$/, "")}${suffix}`;
}

/**
 * The id a path gives an asset that names none: the file name without its
 * last extension, lowercased, with every run of other characters turned
 * into one "-" (`Hero Idle.png` → `hero-idle`, `yard.checks.json` →
 * `yard-checks`). Null when nothing is left.
 */
export function assetIdOfPath(path: AssetPath): AssetId | null {
  const name = fileNameOf(path);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const id = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, MAX_ID)
    .replace(/-+$/, "");
  return ID_PATTERN.test(id) ? id : null;
}

// ─── The view ────────────────────────────────────────────

/** The registry's total order: `created.at`, then key. Duplicates keep the first and repair the rest. */
export function compareEntries(a: AssetEntry, b: AssetEntry): number {
  return a.created.at - b.created.at || byCodeUnit(a.key, b.key);
}

function freeName(taken: Set<string>, make: (n: number) => string, fold: (s: string) => string) {
  for (let n = 2; ; n++) {
    const candidate = make(n);
    if (!taken.has(fold(candidate))) {
      taken.add(fold(candidate));
      return candidate;
    }
  }
}

const same = (s: string) => s;
const lower = (s: string) => s.toLowerCase();

/**
 * The resolved view of a project's state. Two live entries with one id, or
 * with paths that are equal ignoring case, are ordered by (created.at, key):
 * the first keeps it, and each later one gets an issue and a repair with a
 * `-2`, `-3` suffix that no other entry, live or trashed, uses. With
 * `kinds`, a live entry whose kind isn't registered reports `asset-kind`.
 */
export function projectView(state: ProjectState, kinds?: KindRegistry): ProjectView {
  const all = Object.entries(state.assets)
    .map(([key, entry]) => (entry.key === key ? entry : { ...entry, key }))
    .sort(compareEntries);
  const live = all.filter((e) => !e.deleted);
  const deleted = all.filter((e) => e.deleted);

  const byKey = new Map<AssetKey, AssetEntry>(all.map((e) => [e.key, e]));
  const byId = new Map<AssetId, AssetEntry>();
  const byPath = new Map<AssetPath, AssetEntry>();
  const issues: SceneIssue[] = [];
  const repairs = new Map<AssetKey, { id?: AssetId; path?: AssetPath }>();
  const repair = (key: AssetKey, fix: { id?: AssetId; path?: AssetPath }) =>
    repairs.set(key, { ...repairs.get(key), ...fix });

  const takenIds = new Set(all.map((e) => e.id));
  for (const entry of live) {
    const first = byId.get(entry.id);
    if (!first) {
      byId.set(entry.id, entry);
      continue;
    }
    const id = freeName(takenIds, (n) => suffixedId(entry.id, n), same);
    repair(entry.key, { id });
    issues.push(
      makeIssue("asset-id-taken", {
        message: `"${entry.path}" and "${first.path}" both have the id "${entry.id}"; the later one becomes "${id}" when the project's server repairs it`,
        entityIds: [first.key, entry.key],
        got: entry.id,
        expected: id,
      }),
    );
  }

  const takenPaths = new Set(all.map((e) => lower(e.path)));
  const firstByFolded = new Map<string, AssetEntry>();
  const folders = new Map<string, { spelled: string; by: AssetEntry }>();
  for (const entry of live) {
    if (!byPath.has(entry.path)) byPath.set(entry.path, entry);
    const spelled = spellFolders(entry, folders);
    const folded = lower(entry.path);
    const first = firstByFolded.get(folded);
    if (!first && spelled === entry.path) {
      firstByFolded.set(folded, entry);
      continue;
    }
    let path: AssetPath;
    let clash: string;
    let holder: AssetEntry;
    if (first) {
      path = freeName(takenPaths, (n) => suffixedPath(spelled, n), lower);
      holder = first;
      clash =
        first.path === entry.path
          ? `"${entry.id}" and "${first.id}" are both at "${entry.path}"`
          : `"${entry.path}" (${entry.id}) differs only in case from "${first.path}" (${first.id})`;
    } else {
      path = spelled;
      firstByFolded.set(folded, entry);
      const [own, earlier] = folderCaseClash(entry.path, spelled)!;
      holder = folders.get(lower(earlier))!.by;
      clash = `"${entry.path}" (${entry.id}) is in the folder "${own}", which differs only in case from "${earlier}", where "${holder.path}" (${holder.id}) is`;
    }
    repair(entry.key, { path });
    issues.push(
      makeIssue("path-taken", {
        message: `${clash}; the later one moves to "${path}" when the project's server repairs it`,
        entityIds: [holder.key, entry.key],
        got: entry.path,
        expected: path,
      }),
    );
  }

  const view: ProjectView = {
    state,
    byId,
    byPath,
    byKey,
    deleted,
    issues,
    repairs,
    tree: () => buildTree(live, state.code),
  };
  if (kinds) {
    for (const entry of live) {
      if (kinds.get(entry.kind)) continue;
      issues.push(
        makeIssue("asset-kind", {
          message: `"${entry.id}" (${entry.path}) has the kind "${entry.kind}", which this project doesn't register`,
          entityIds: [entry.key],
          got: entry.kind,
        }),
      );
    }
    issues.push(...onePerProjectIssues(view, kinds));
  }
  return view;
}

/**
 * `entry`'s path with each folder spelled as the first live entry under a
 * folder of that name (ignoring case) spelled it; the folders it brings
 * that no earlier entry had are recorded under its spelling.
 */
function spellFolders(
  entry: AssetEntry,
  folders: Map<string, { spelled: string; by: AssetEntry }>,
): AssetPath {
  const segments = entry.path.split("/");
  const name = segments.pop()!;
  let at = "";
  for (const segment of segments) {
    const next = at === "" ? segment : `${at}/${segment}`;
    const known = folders.get(lower(next));
    if (known) at = known.spelled;
    else {
      folders.set(lower(next), { spelled: next, by: entry });
      at = next;
    }
  }
  return at === "" ? name : `${at}/${name}`;
}

// ─── The tree ────────────────────────────────────────────

type FolderBuild = {
  node: Extract<ProjectTreeNode, { type: "folder" }>;
  folders: Map<string, FolderBuild>;
};

const nodeName = (node: ProjectTreeNode): string =>
  node.type === "asset" ? fileNameOf(node.entry.path) : fileNameOf(node.path);

function compareNodes(a: ProjectTreeNode, b: ProjectTreeNode): number {
  const af = a.type === "folder" ? 0 : 1;
  const bf = b.type === "folder" ? 0 : 1;
  if (af !== bf) return af - bf;
  const an = nodeName(a);
  const bn = nodeName(b);
  const byName = byCodeUnit(an.toLowerCase(), bn.toLowerCase()) || byCodeUnit(an, bn);
  if (byName) return byName;
  if (a.type === "asset" && b.type === "asset") return compareEntries(a.entry, b.entry);
  return a.type === b.type ? 0 : a.type === "asset" ? -1 : 1;
}

function sortTree(nodes: ProjectTreeNode[]): ProjectTreeNode[] {
  nodes.sort(compareNodes);
  for (const node of nodes) if (node.type === "folder") sortTree(node.children);
  return nodes;
}

/** Folders from live entries' paths and code modules' paths; folders first, then files, by name ignoring case. */
function buildTree(
  live: readonly AssetEntry[],
  code: Readonly<Record<string, CodeModuleInfo>>,
): ProjectTreeNode[] {
  const root: FolderBuild = {
    node: { type: "folder", path: "", children: [] },
    folders: new Map(),
  };
  const folderFor = (path: string): FolderBuild => {
    let at = root;
    const segments = path.split("/");
    segments.pop();
    for (const segment of segments) {
      let next = at.folders.get(segment);
      if (!next) {
        const childPath = at.node.path === "" ? segment : `${at.node.path}/${segment}`;
        next = { node: { type: "folder", path: childPath, children: [] }, folders: new Map() };
        at.folders.set(segment, next);
        at.node.children.push(next.node);
      }
      at = next;
    }
    return at;
  };
  for (const entry of live) folderFor(entry.path).node.children.push({ type: "asset", entry });
  for (const [path, info] of Object.entries(code))
    folderFor(path).node.children.push({ type: "code", path, info });
  return sortTree(root.node.children);
}
