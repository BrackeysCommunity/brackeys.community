import type { ProjectPeer } from "../../../collab/index";
import type { AssetDrop } from "../../../editor/index";
import {
  docNameOf,
  type AssetEntry,
  type CodeModuleInfo,
  type ProjectId,
  type ProjectTreeNode,
} from "../../../project/index";

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
      /** A folder under the Code row: it holds code modules only and takes no drops. */
      code?: true;
    }
  | { type: "code-group"; key: string; depth: 1; count: number }
  | {
      type: "asset";
      key: string;
      depth: number;
      entry: AssetEntry;
      name: string;
      folder: string;
      /** An atlas's frame names, listed under it while it's expanded. */
      frames?: readonly string[];
    }
  | { type: "frame"; key: string; depth: number; entry: AssetEntry; frame: string; folder: string }
  | { type: "code"; key: string; depth: number; path: string; name: string; info: CodeModuleInfo };

export const ROOT_KEY = "root";
export const CODE_GROUP_KEY = "code-group";

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

const folderKey = (path: string, prefix = "") => `${prefix}folder:${trimSlash(path)}`;

export const fileCount = (nodes: readonly ProjectTreeNode[]): number =>
  nodes.reduce((n, node) => n + (node.type === "folder" ? fileCount(node.children) : 1), 0);

/** The row key of an asset's entry. */
export const assetRowKey = (entry: AssetEntry) => `asset:${entry.key}`;

export type FlattenOptions = {
  /** An atlas's frame names; an asset with some gets frame rows. */
  framesOf?: (entry: AssetEntry) => readonly string[] | undefined;
  /** Asset row keys whose frames are listed; atlases start closed. */
  expanded?: ReadonlySet<string>;
};

/**
 * The rows under the root, depth first, skipping what's inside a collapsed
 * folder, with an expanded atlas's frames under it.
 */
export function flattenTree(
  nodes: readonly ProjectTreeNode[],
  collapsed: ReadonlySet<string>,
  options: FlattenOptions = {},
): TreeRow[] {
  return [
    { type: "root", key: ROOT_KEY, depth: 0, folder: "" },
    ...walkRows(nodes, collapsed, options),
  ];
}

/**
 * `nodes` split in two: the assets, in their folders, and the code modules,
 * in theirs. A folder holding only code is left out of the assets.
 */
export function splitCode(nodes: readonly ProjectTreeNode[]): {
  assets: ProjectTreeNode[];
  code: ProjectTreeNode[];
} {
  const assets: ProjectTreeNode[] = [];
  const code: ProjectTreeNode[] = [];
  for (const node of nodes) {
    if (node.type === "code") code.push(node);
    else if (node.type === "asset") assets.push(node);
    else {
      const inner = splitCode(node.children);
      if (inner.assets.length > 0) assets.push({ ...node, children: inner.assets });
      if (inner.code.length > 0) code.push({ ...node, children: inner.code });
    }
  }
  return { assets, code };
}

/**
 * The tree's rows: the root, the assets, then one Code row with the code
 * modules beneath it while `codeOpen`.
 */
export function projectRows(
  nodes: readonly ProjectTreeNode[],
  collapsed: ReadonlySet<string>,
  { codeOpen = false, ...options }: FlattenOptions & { codeOpen?: boolean } = {},
): TreeRow[] {
  const { assets, code } = splitCode(nodes);
  const rows = flattenTree(assets, collapsed, options);
  if (code.length === 0) return rows;
  rows.push({ type: "code-group", key: CODE_GROUP_KEY, depth: 1, count: fileCount(code) });
  if (codeOpen) rows.push(...walkRows(code, collapsed, {}, 2, "code:"));
  return rows;
}

function walkRows(
  nodes: readonly ProjectTreeNode[],
  collapsed: ReadonlySet<string>,
  { framesOf, expanded }: FlattenOptions,
  start = 1,
  prefix = "",
): TreeRow[] {
  const out: TreeRow[] = [];
  const walk = (list: readonly ProjectTreeNode[], depth: number) => {
    for (const node of list) {
      if (node.type === "folder") {
        const key = folderKey(node.path, prefix);
        const path = trimSlash(node.path);
        out.push({
          type: "folder",
          key,
          depth,
          path,
          name: baseName(path),
          folder: `${path}/`,
          count: fileCount(node.children),
          ...(prefix ? { code: true as const } : {}),
        });
        if (!collapsed.has(key)) walk(node.children, depth + 1);
      } else if (node.type === "asset") {
        const { entry } = node;
        const key = assetRowKey(entry);
        const folder = parentFolder(entry.path);
        const frames = framesOf?.(entry);
        out.push({
          type: "asset",
          key,
          depth,
          entry,
          name: baseName(entry.path),
          folder,
          ...(frames?.length ? { frames } : {}),
        });
        if (frames?.length && expanded?.has(key))
          for (const frame of frames)
            out.push({
              type: "frame",
              key: `${key}#${frame}`,
              depth: depth + 1,
              entry,
              frame,
              folder,
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
  walk(nodes, start);
  return out;
}

/** The drag type an asset row carries onto the canvas: an `AssetDrop` as JSON. */
export const ASSET_DRAG_TYPE = "application/x-jams-asset+json";

/** Whether a drag carries an asset row, readable while the drag is still over a target. */
export const carriesAsset = (data: DataTransfer | null) =>
  Array.from(data?.types ?? []).includes(ASSET_DRAG_TYPE);

export function writeAssetDrag(data: DataTransfer, drop: AssetDrop): void {
  data.setData(ASSET_DRAG_TYPE, JSON.stringify(drop));
  data.effectAllowed = "copyMove";
}

/** The asset a drop carries, or null when it carries none or isn't one. */
export function readAssetDrag(data: DataTransfer | null): AssetDrop | null {
  const raw = data?.getData(ASSET_DRAG_TYPE);
  if (!raw) return null;
  try {
    const drop = JSON.parse(raw) as Partial<AssetDrop> | null;
    const entry = drop?.entry;
    if (!entry || typeof entry.id !== "string" || typeof entry.kind !== "string") return null;
    if (!drop.info || typeof drop.info.id !== "string") return null;
    if (drop.frame !== undefined && typeof drop.frame !== "string") return null;
    return drop as AssetDrop;
  } catch {
    return null;
  }
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
  byDoc: ReadonlyMap<string | null, readonly ProjectPeer[]> | undefined,
): Map<string, ProjectPeer[]> {
  const out = new Map<string, ProjectPeer[]>();
  if (!byDoc || byDoc.size === 0) return out;
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
        for (const key of [assetRowKey(node.entry), ...above]) add(key, peers);
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
