import type { ProjectPeer } from "@jams/engine/collab";
import {
  docNameOf,
  type AssetEntry,
  type CodeModuleInfo,
  type ProjectId,
  type ProjectTreeNode,
} from "@jams/engine/project";

/** One line of the flattened tree; `folder` is where its own children go, as `moveAsset`'s `to`. */
export type TreeRow =
  | { type: "root"; key: string; depth: 0; folder: "" }
  | {
      type: "folder";
      key: string;
      depth: number;
      path: string;
      name: string;
      folder: string;
      /** Assets and code modules beneath it. */
      count: number;
    }
  | { type: "asset"; key: string; depth: number; entry: AssetEntry; name: string; folder: string }
  | { type: "code"; key: string; depth: number; path: string; name: string; info: CodeModuleInfo };

export const ROOT_KEY = "root";

const trimSlash = (path: string) => path.replace(/\/+$/, "");

/** The last segment of a path. */
export const baseName = (path: string) => {
  const p = trimSlash(path);
  return p.slice(p.lastIndexOf("/") + 1);
};

/** The folder holding `path`, as `moveAsset`'s `to`: "dir/" or "" at the root. */
export const parentFolder = (path: string) => {
  const p = trimSlash(path);
  const slash = p.lastIndexOf("/");
  return slash < 0 ? "" : p.slice(0, slash + 1);
};

const folderKey = (path: string) => `folder:${trimSlash(path)}`;

export const fileCount = (nodes: readonly ProjectTreeNode[]): number =>
  nodes.reduce((n, node) => n + (node.type === "folder" ? fileCount(node.children) : 1), 0);

/** The rows under the root, depth first, skipping what's inside a collapsed folder. */
export function flattenTree(
  nodes: readonly ProjectTreeNode[],
  collapsed: ReadonlySet<string>,
): TreeRow[] {
  const out: TreeRow[] = [{ type: "root", key: ROOT_KEY, depth: 0, folder: "" }];
  const walk = (list: readonly ProjectTreeNode[], depth: number) => {
    for (const node of list) {
      if (node.type === "folder") {
        const key = folderKey(node.path);
        const path = trimSlash(node.path);
        out.push({
          type: "folder",
          key,
          depth,
          path,
          name: baseName(path),
          folder: `${path}/`,
          count: fileCount(node.children),
        });
        if (!collapsed.has(key)) walk(node.children, depth + 1);
      } else if (node.type === "asset") {
        const { entry } = node;
        out.push({
          type: "asset",
          key: `asset:${entry.key}`,
          depth,
          entry,
          name: baseName(entry.path),
          folder: parentFolder(entry.path),
        });
      } else {
        out.push({
          type: "code",
          key: `code:${node.path}`,
          depth,
          path: node.path,
          name: baseName(node.path),
          info: node.info,
        });
      }
    }
  };
  walk(nodes, 1);
  return out;
}

/** The sync doc an entry's peers are in: scenes have `scene:` docs, every other kind `asset:`. */
export function docOfEntry(project: ProjectId, entry: AssetEntry): string | null {
  try {
    return docNameOf({ kind: entry.kind === "scene" ? "scene" : "asset", project, key: entry.key });
  } catch {
    return null;
  }
}

/** Peers per row key: an asset row its doc's peers, a folder row everyone in a doc beneath it. */
export function peersByRow(
  project: ProjectId,
  nodes: readonly ProjectTreeNode[],
  byDoc: ReadonlyMap<string | null, readonly ProjectPeer[]>,
): Map<string, ProjectPeer[]> {
  const out = new Map<string, ProjectPeer[]>();
  if (byDoc.size === 0) return out;
  const add = (key: string, peers: readonly ProjectPeer[]) => {
    const at = out.get(key);
    if (at) at.push(...peers);
    else out.set(key, [...peers]);
  };
  const walk = (list: readonly ProjectTreeNode[], above: readonly string[]) => {
    for (const node of list) {
      if (node.type === "folder") walk(node.children, [...above, folderKey(node.path)]);
      else if (node.type === "asset") {
        const doc = docOfEntry(project, node.entry);
        const peers = doc ? byDoc.get(doc) : undefined;
        if (!peers?.length) continue;
        for (const key of [`asset:${node.entry.key}`, ...above]) add(key, peers);
      }
    }
  };
  walk(nodes, []);
  const overview = [...(byDoc.get(null) ?? []), ...(byDoc.get(docNameOfProject(project)) ?? [])];
  if (overview.length > 0) out.set(ROOT_KEY, overview);
  return out;
}

function docNameOfProject(project: ProjectId): string | null {
  try {
    return docNameOf({ kind: "project", project });
  } catch {
    return null;
  }
}

const SEGMENT = /^[A-Za-z0-9._ -]{1,96}$/;
const MAX_PATH = 255;

/** Why `file` can't replace `entry`'s file name among `siblings`, or null when it can. */
export function renameProblem(
  entry: AssetEntry,
  file: string,
  siblings: readonly string[],
): string | null {
  if (file === "." || file === ".." || !SEGMENT.test(file))
    return "Use letters, digits, spaces, dots, dashes and underscores (up to 96).";
  if (parentFolder(entry.path).length + file.length > MAX_PATH) return "That path is too long.";
  const lower = file.toLowerCase();
  const own = baseName(entry.path);
  if (siblings.some((s) => s !== own && s.toLowerCase() === lower))
    return "This folder already has a file with that name.";
  return null;
}

/** The names already in `folder`, for rename checks. */
export function namesIn(nodes: readonly ProjectTreeNode[], folder: string): string[] {
  const parts = folder ? trimSlash(folder).split("/") : [];
  let list: readonly ProjectTreeNode[] = nodes;
  for (const part of parts) {
    const next = list.find((n) => n.type === "folder" && baseName(n.path) === part);
    if (!next || next.type !== "folder") return [];
    list = next.children;
  }
  return list.map((n) => baseName(n.type === "asset" ? n.entry.path : n.path));
}

/** What a code module registers, as one line. */
export function registersSummary(info: CodeModuleInfo): string {
  const r = info.registers;
  const parts = (
    [
      ["type", r.types],
      ["kind", r.kinds],
      ["table", r.tables],
      ["material", r.materials],
    ] as const
  ).flatMap(([label, list]) =>
    list?.length ? [`${list.length} ${label}${list.length === 1 ? "" : "s"}`] : [],
  );
  return parts.join(", ");
}
