import { makeIssue } from "../scene/issues";
import type { SceneIssue } from "../scene/types";
import { inspectEntry } from "./inspect/entry";
import { isSkippedAssetPath, type KindRegistry } from "./kinds";
import type { AssetKindDef } from "./kinds/define";
import { projectGlobs } from "./project-file";
import { parseSidecar, SIDECAR_SUFFIX, sidecarPathOf, type AssetSidecar } from "./sidecar";
import type { AssetEntry, AssetId, AssetKey, AssetPath, ProjectFile, Sha256 } from "./types";
import { assetIdOfPath, suffixedId } from "./view";

/** A POSIX glob test, such as `node:path`'s `matchesGlob`. */
export type GlobMatch = (path: string, glob: string) => boolean;

/** Which project-relative paths a project file makes assets and code modules. */
export type ProjectPathMatcher = {
  /** Under the asset globs, outside their `!` excludes, `ignore` and `isSkippedAssetPath`. */
  isAsset: (path: AssetPath) => boolean;
  /** Under the code globs, outside their `!` excludes and `ignore`. */
  isCode: (path: string) => boolean;
};

export function projectPathMatcher(file: ProjectFile, match: GlobMatch): ProjectPathMatcher {
  const globs = projectGlobs(file);
  const ignore = globs.ignore.map((g) => (g.startsWith("!") ? g.slice(1) : g));
  const tester = (list: readonly string[]) => {
    const include = list.filter((g) => !g.startsWith("!"));
    const exclude = [...list.filter((g) => g.startsWith("!")).map((g) => g.slice(1)), ...ignore];
    return (path: string) =>
      include.some((g) => match(path, g)) && !exclude.some((g) => match(path, g));
  };
  const isAsset = tester(globs.assets);
  return {
    isAsset: (path) => !isSkippedAssetPath(path) && isAsset(path),
    isCode: tester(globs.code),
  };
}

const isJsonPath = (path: AssetPath) => path.toLowerCase().endsWith(".json");

/**
 * Whether a file under the asset globs can be an asset before its content
 * is read: a kind claims its suffix, it is JSON a kind may claim by its
 * content, or a sidecar beside it names its kind. Anything else (a script
 * beside the art) is never read, listed, watched, pushed or pulled.
 */
export function mayBeAssetFile(
  kinds: KindRegistry,
  path: AssetPath,
  hasSidecar: () => boolean,
): boolean {
  if (isSkippedAssetPath(path)) return false;
  return kinds.detect(path) !== null || isJsonPath(path) || hasSidecar();
}

/**
 * The kind of a file under the asset globs, as every host judges it: its
 * sidecar's kind, else its suffix's, else, for a `.json` file, what its
 * content names. `json` is asked only for a `.json` file no suffix claims.
 */
export function assetFileKind(
  kinds: KindRegistry,
  path: AssetPath,
  json: () => unknown,
  sidecarKind?: string,
): AssetKindDef | null {
  const byPath = kinds.detect(path, undefined, sidecarKind);
  if (byPath !== null || sidecarKind !== undefined || !isJsonPath(path)) return byPath;
  return kinds.detect(path, json());
}

/**
 * The files of `files` (project-relative paths to bytes) a project holds:
 * each one `assetFileKind` gives a kind, with its sidecar, and each sidecar
 * whose file isn't among them.
 */
export function assetFilesIn<B extends Uint8Array>(
  files: ReadonlyMap<AssetPath, B>,
  kinds: KindRegistry,
): Map<AssetPath, B> {
  const decoder = new TextDecoder();
  const out = new Map<AssetPath, B>();
  for (const [path, bytes] of files) {
    if (path.endsWith(SIDECAR_SUFFIX)) {
      if (!files.has(path.slice(0, -SIDECAR_SUFFIX.length))) out.set(path, bytes);
      continue;
    }
    const sidecar = files.get(sidecarPathOf(path));
    const parsed = sidecar === undefined ? null : parseSidecar(decoder.decode(sidecar));
    const json = () => {
      try {
        return JSON.parse(decoder.decode(bytes)) as unknown;
      } catch {
        return undefined;
      }
    };
    if (
      assetFileKind(kinds, path, json, parsed?.ok ? parsed.sidecar.assetKind : undefined) === null
    )
      continue;
    out.set(path, bytes);
    if (sidecar !== undefined) out.set(sidecarPathOf(path), sidecar);
  }
  return out;
}

/** The id a file gives itself with no sidecar: its doc kind's id field, else its name. */
export function ownAssetId(def: AssetKindDef, path: AssetPath, json: unknown): AssetId | null {
  if (def.storage === "doc" && def.idField && json && typeof json === "object") {
    const id = (json as Record<string, unknown>)[def.idField];
    if (typeof id === "string") return id;
  }
  return assetIdOfPath(path);
}

/** The problem a sidecar with no asset file at `assetPath` is. */
export function orphanSidecarIssue(sidecarPath: AssetPath, assetPath: AssetPath): SceneIssue {
  return makeIssue("ref-not-found", {
    message: `${sidecarPath} is a sidecar with no asset file beside it`,
    path: "",
    got: assetPath,
  });
}

/** One asset file as a host read it: its kind, the id it takes, its sidecar, and a binary's bytes. */
export type AssetFile = {
  path: AssetPath;
  def: AssetKindDef;
  id: AssetId;
  sidecar: AssetSidecar | null;
  /** A binary's hash and bytes; null for a doc kind's file. */
  blob: { sha256: Sha256; data: Uint8Array } | null;
};

/** The live asset id at each path, as an inspection asks for it (an atlas names its image by path). */
export function idsAtPaths(
  entries: Iterable<Pick<AssetEntry, "id" | "path" | "deleted">>,
): (path: AssetPath) => AssetId | undefined {
  const ids = new Map<AssetPath, AssetId>();
  for (const e of entries) if (!e.deleted && !ids.has(e.path)) ids.set(e.path, e.id);
  return (path) => ids.get(path);
}

/**
 * The entry a file gives under `key`: its sidecar's name and licence, and
 * for a binary its hash, size, the sidecar's settings and the meta an
 * inspection with `idAt` gives. An inspection that fails leaves the entry
 * without meta and is returned as `issue`.
 */
export function assetFileEntry(
  file: AssetFile,
  key: AssetKey,
  created: AssetEntry["created"],
  idAt: (path: AssetPath) => AssetId | undefined,
): { entry: AssetEntry; issue: SceneIssue | null } {
  const entry: AssetEntry = {
    key,
    id: file.id,
    kind: file.def.kind,
    path: file.path,
    created: { ...created },
  };
  if (file.sidecar?.name !== undefined) entry.name = file.sidecar.name;
  let issue: SceneIssue | null = null;
  if (file.def.storage === "blob" && file.blob) {
    const settings = file.sidecar?.import;
    if (settings && Object.keys(settings).length > 0) entry.import = { ...settings };
    entry.sha256 = file.blob.sha256;
    entry.bytes = file.blob.data.byteLength;
    const result = inspectEntry(file.def, entry, file.blob.data, idAt);
    if (result.ok) {
      entry.meta = result.meta as Record<string, unknown>;
      if (result.import) entry.import = result.import;
    } else issue = result.issue;
  }
  if (file.sidecar?.licence !== undefined) entry.licence = { ...file.sidecar.licence };
  return { entry, issue };
}

/**
 * The registry entries a project's files give, the way every host seeds
 * them: in the files' order, each keyed by its sidecar's key or its id,
 * suffixed when an earlier file holds it; binaries inspected against the
 * ids the files take.
 */
export function assetFileEntries<F extends AssetFile>(
  files: readonly F[],
  created: AssetEntry["created"],
): { file: F; key: AssetKey; entry: AssetEntry; issue: SceneIssue | null }[] {
  const taken = new Set<AssetKey>();
  const keys = files.map((file) => {
    const base = file.sidecar?.key ?? file.id;
    let key = base;
    for (let n = 2; taken.has(key); n++) key = suffixedId(base, n);
    taken.add(key);
    return key;
  });
  const idAt = idsAtPaths(files);
  return files.map((file, i) => {
    const key = keys[i]!;
    return { file, key, ...assetFileEntry(file, key, created, idAt) };
  });
}
