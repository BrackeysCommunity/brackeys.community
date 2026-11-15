import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { importLdtk, importTiled, pxPerMetreOf } from "@jams/engine/game";
import {
  detectImport,
  type KindEnv,
  type ProjectOp,
  type ProjectOpBatch,
  type ProjectView,
  type Sha256,
  type TileImport,
} from "@jams/engine/project";
import type { SceneIssue } from "@jams/engine/scene";

import {
  failure,
  issueLine,
  isToolResult,
  usage,
  type Tool,
  type ToolContext,
  type ToolResult,
} from "../context";
import { blobContentType, putBlob } from "../hosted";
import { runProjectBatch, type BatchTarget, type WriterFlags } from "./assets-apply";
import { folderArg } from "./assets-move";
import { settingsArg } from "./assets-set-import";

export type AssetsImportInput = WriterFlags & {
  /** The file on disk to import. */
  file?: string;
  /** Its asset path in the project, or a folder ending in `/`; default the kind's folder. */
  path?: string;
  id?: string;
  kind?: string;
  /** Import settings: a JSON object or `key=value` pairs. */
  settings?: string;
  /** A Tiled map (`.tmj`) to convert instead of a file to add. */
  tiled?: string;
  /** With `tiled`: the scene the map becomes; default one named after the map. */
  into?: string;
  /** With `tiled`: where its external tilesets are; default the map's folder. */
  tilesets?: string;
  /** An LDtk world (`.ldtk`) to convert instead of a file to add. */
  ldtk?: string;
  /** With `ldtk`: the levels to convert; default all. */
  level?: readonly string[];
  /** Where a map's import reports each image it reads; stderr when it is a terminal. */
  progress?: (line: string) => void;
};

const USAGE =
  "scene assets import <file> [--path path|folder/] [--id id] [--kind k] [--settings json] [writer flags]";

export const TILE_IMPORT_USAGE =
  "scene assets import --tiled <map.tmj> [--into scene] [--tilesets dir] | --ldtk <world.ldtk> [--level name…] [--dry-run]";

/** A file the map names, read from disk: an external tileset's JSON or an image's bytes. */
type Read<T> = { ok: true; value: T } | { ok: false; result: ToolResult };

async function readBytes(file: string, what: string): Promise<Read<Uint8Array>> {
  try {
    return { ok: true, value: new Uint8Array(await readFile(file)) };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT" || code === "EISDIR")
      return { ok: false, result: failure(`Not found: ${file} (${what}).`) };
    throw e;
  }
}

async function readJson(file: string, what: string): Promise<Read<unknown>> {
  const bytes = await readBytes(file, what);
  if (!bytes.ok) return bytes;
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes.value)) };
  } catch {
    return { ok: false, result: failure(`${file} isn't valid JSON (${what}).`) };
  }
}

/** An image a map or tileset names, by the path as written and the file it resolves to. */
type ImageRef = { written: string; file: string };

/** The `image` paths a Tiled tileset names: its sheet, or each tile's in an image collection. */
function tiledImages(tileset: unknown, dir: string): ImageRef[] {
  if (!isRecord(tileset)) return [];
  const out: ImageRef[] = [];
  const add = (image: unknown) => {
    if (typeof image === "string" && image !== "")
      out.push({ written: image, file: resolve(dir, image) });
  };
  add(tileset.image);
  if (Array.isArray(tileset.tiles))
    for (const tile of tileset.tiles) if (isRecord(tile)) add(tile.image);
  return out;
}

/** Where an external tileset's `source` is: beside the map, or under `--tilesets` by its path or its name. */
async function tilesetFile(source: string, mapDir: string, dir: string | undefined) {
  if (dir === undefined) return resolve(mapDir, source);
  const direct = resolve(dir, source);
  const exists = await stat(direct).then(
    (s) => s.isFile(),
    () => false,
  );
  return exists ? direct : resolve(dir, basename(source));
}

/** What a map's files are, read ahead of the batch so a missing one fails before anything is built. */
type MapFiles = {
  name: string;
  convert: (opts: ConvertOptions) => WithBlobs;
  images: ImageRef[];
};

type ConvertOptions = {
  project: ProjectView;
  pxPerMetre: number;
  game: string | undefined;
  /** Each image the map names, by the path as written: its hash and size, now in the store. */
  hashes: ReadonlyMap<string, { sha256: Sha256; bytes: number }>;
  bytes: ReadonlyMap<string, Uint8Array>;
};

async function tiledFiles(input: AssetsImportInput & { tiled: string }): Promise<Read<MapFiles>> {
  const map = await readJson(input.tiled, "the Tiled map");
  if (!map.ok) return map;
  const mapDir = dirname(resolve(input.tiled));
  const tilesets = new Map<string, unknown>();
  const images: ImageRef[] = [];
  const listed = isRecord(map.value) && Array.isArray(map.value.tilesets) ? map.value.tilesets : [];
  for (const ref of listed) {
    if (!isRecord(ref)) continue;
    if (typeof ref.source !== "string") {
      images.push(...tiledImages(ref, mapDir));
      continue;
    }
    if (tilesets.has(ref.source)) continue;
    const file = await tilesetFile(ref.source, mapDir, input.tilesets);
    const tileset = await readJson(file, `tileset ${ref.source}`);
    if (!tileset.ok) return tileset;
    tilesets.set(ref.source, tileset.value);
    images.push(...tiledImages(tileset.value, dirname(file)));
  }
  const name = basename(input.tiled);
  const scene = input.into ?? sceneIdOf(name);
  return {
    ok: true,
    value: {
      name,
      images,
      convert: ({ project, pxPerMetre, hashes }) =>
        importTiled(map.value, tilesets, { scene, project, pxPerMetre, images: hashes }),
    },
  };
}

async function ldtkFiles(input: AssetsImportInput & { ldtk: string }): Promise<Read<MapFiles>> {
  const world = await readJson(input.ldtk, "the LDtk world");
  if (!world.ok) return world;
  const dir = dirname(resolve(input.ldtk));
  const images: ImageRef[] = [];
  let value = world.value;
  if (isRecord(value)) {
    const defs =
      isRecord(value.defs) && Array.isArray(value.defs.tilesets) ? value.defs.tilesets : [];
    for (const tileset of defs)
      if (isRecord(tileset) && typeof tileset.relPath === "string" && tileset.relPath !== "")
        images.push({ written: tileset.relPath, file: resolve(dir, tileset.relPath) });
    // A world saved with "separate level files" keeps each level's layers in its own .ldtkl.
    if (Array.isArray(value.levels)) {
      const levels: unknown[] = [];
      for (const level of value.levels) {
        if (
          isRecord(level) &&
          typeof level.externalRelPath === "string" &&
          !Array.isArray(level.layerInstances) &&
          (input.level === undefined || input.level.includes(String(level.identifier)))
        ) {
          const external = await readJson(
            resolve(dir, level.externalRelPath),
            `level ${String(level.identifier)}`,
          );
          if (!external.ok) return external;
          levels.push(isRecord(external.value) ? { ...level, ...external.value } : level);
        } else levels.push(level);
      }
      value = { ...value, levels };
    }
  }
  const levels = input.level;
  return {
    ok: true,
    value: {
      name: basename(input.ldtk),
      images,
      convert: ({ project, pxPerMetre, game, bytes }) =>
        importLdtk(value, {
          project,
          pxPerMetre,
          hash: sha256Sync,
          files: bytes,
          ...(game === undefined ? {} : { game }),
          ...(levels ? { levels } : {}),
        }),
    },
  };
}

/** A scene id from a map's file name: its stem, lowercased, other characters as hyphens. */
export function sceneIdOf(file: string): string {
  const stem = file.replace(/\.(tmj|json|ldtk)$/i, "");
  const id = stem
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return id === "" ? "map" : id;
}

/** Bytes an importer generated or copied (LDtk's), which its `importAsset` ops name by hash. */
type WithBlobs = TileImport & { blobs?: ReadonlyMap<Sha256, Uint8Array> };

const sha256Sync = (bytes: Uint8Array): Sha256 => createHash("sha256").update(bytes).digest("hex");

const progressToStderr = (line: string) => {
  if (process.stderr.isTTY) process.stderr.write(`${line}\n`);
};

/**
 * The batch a map becomes: the images it names go to the store first, then
 * the importer turns the map into ops whose `importAsset`s name those bytes
 * (and any it generated) by hash. Notes travel with it; an error note
 * (`import-failed`) builds no batch.
 */
export async function buildTileImport(
  files: MapFiles,
  target: Pick<BatchTarget, "project" | "view" | "store">,
  progress: (line: string) => void = progressToStderr,
): Promise<{ batch: ProjectOpBatch; notes: readonly SceneIssue[] } | ToolResult> {
  const hashes = new Map<string, { sha256: Sha256; bytes: number }>();
  const read = new Map<string, Uint8Array>();
  const texture = target.project.kinds.get("texture");
  const accepted = texture && "contentTypes" in texture ? (texture.contentTypes ?? []) : [];
  const total = files.images.length;
  for (const [i, image] of files.images.entries()) {
    if (hashes.has(image.written)) continue;
    if (total > 1) progress(`assets import: image ${i + 1}/${total} ${image.written}`);
    const bytes = await readBytes(image.file, `image ${image.written}`);
    if (!bytes.ok) return bytes.result;
    const sha256 = await putBlob(target.store, bytes.value, {
      kind: "texture",
      contentType: blobContentType(image.file, accepted),
    });
    hashes.set(image.written, { sha256, bytes: bytes.value.byteLength });
    read.set(image.written, bytes.value);
  }
  let result: WithBlobs;
  try {
    result = files.convert({
      project: target.view,
      pxPerMetre: pxPerMetreOf(target.project.registry),
      game: target.project.game?.id,
      hashes,
      bytes: read,
    });
  } catch (e) {
    return failure(`assets import: ${files.name}: ${(e as Error).message}`);
  }
  const notes = result.notes;
  if (notes.some((n) => n.severity === "error"))
    return {
      exitCode: 1,
      data: { ok: false, written: false, notes },
      text: [`assets import: ${files.name} can't be imported`, ...notes.map(issueLine)].join("\n"),
    };
  for (const [hash, blob] of result.blobs ?? [])
    await putBlob(target.store, blob, { kind: "texture", contentType: "image/png", expect: hash });
  const ops = [...result.ops];
  if (ops.length === 0) return failure(`assets import: ${files.name} holds nothing to import.`);
  return { batch: { v: 1, label: `Import ${files.name}`, ops }, notes };
}

/** Reads a Tiled map or an LDtk world and the files it names, ahead of the batch. */
export function readTileMap(input: AssetsImportInput): Promise<Read<MapFiles>> {
  if (input.tiled !== undefined) return tiledFiles({ ...input, tiled: input.tiled });
  return ldtkFiles({ ...input, ldtk: input.ldtk! });
}

/** Converts a Tiled map or an LDtk world into scenes, tilesets and their images, as one batch. */
async function importTileMap(input: AssetsImportInput, ctx: ToolContext): Promise<ToolResult> {
  if ((input.tiled !== undefined) === (input.ldtk !== undefined) || input.file !== undefined)
    return usage(TILE_IMPORT_USAGE);
  if (input.tiled === undefined && (input.into !== undefined || input.tilesets !== undefined))
    return usage(TILE_IMPORT_USAGE);
  if (input.ldtk === undefined && input.level !== undefined) return usage(TILE_IMPORT_USAGE);
  const read = await readTileMap(input);
  if (!read.ok) return read.result;
  let notes: readonly SceneIssue[] = [];
  const result = await runProjectBatch(ctx, input, {
    async build(target) {
      const built = await buildTileImport(read.value, target, input.progress);
      if (isToolResult(built)) return built;
      notes = built.notes;
      return built.batch;
    },
  });
  if (notes.length === 0) return result;
  return {
    ...result,
    data: isRecord(result.data) ? { ...result.data, notes } : result.data,
    text: [result.text, ...notes.map(issueLine)].join("\n"),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Adds a file from disk to a project. A binary's bytes go to the content
 * store first (the dev cache, or with `--live` the dev server's), then
 * `importAsset` names their hash; the file is written to its path with its
 * sidecar and registry entry. A JSON doc kind's file becomes `createAsset`
 * with its content. The kind is told from the name, the JSON's `kind`, or an
 * atlas export's `meta.app` (`detectImport`), unless `--kind` says.
 */
export const assetsImport: Tool<AssetsImportInput> = async (input, ctx) => {
  if (input.tiled !== undefined || input.ldtk !== undefined) return importTileMap(input, ctx);
  if (!input.file) return usage(USAGE);
  let data: Uint8Array;
  try {
    data = new Uint8Array(await readFile(input.file));
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT" || (e as { code?: string }).code === "EISDIR")
      return failure(`Not found: ${input.file}.`);
    throw e;
  }
  let settings: Record<string, unknown> | undefined;
  if (input.settings !== undefined) {
    const parsed = settingsArg(input.settings);
    if (!parsed.ok) return parsed.result;
    settings = parsed.set;
  }
  const name = basename(input.file);
  let json: unknown;
  if (name.toLowerCase().endsWith(".json")) {
    try {
      json = JSON.parse(new TextDecoder().decode(data));
    } catch {
      return failure(`${input.file} isn't valid JSON.`);
    }
  }
  let given = input.path?.replace(/^\.?\/+/, "");
  if (given !== undefined && (given === "" || given.endsWith("/")))
    given = `${folderArg(given)}${name}`;

  return runProjectBatch(ctx, input, {
    async build({ project, view, store }) {
      const def =
        input.kind !== undefined
          ? project.kinds.get(input.kind)
          : detectImport(project.kinds, given ?? name, json);
      if (!def)
        return usage(
          input.kind !== undefined
            ? `--kind: no asset kind ${JSON.stringify(input.kind)} in project "${project.file.id}"`
            : `${name}: no asset kind matches its name or content; pass --kind`,
        );
      if (def.storage === "code")
        return usage(`${name} is code (${def.kind}), which lives in git and isn't imported`);
      const env: KindEnv = { registry: project.registry, project: view };
      const path = given ?? `${folderArg(def.defaultFolder?.(env) ?? "")}${name}`;
      const id = input.id === undefined ? {} : { id: input.id };
      let op: ProjectOp;
      if (def.storage === "doc") {
        if (settings) return usage(`--settings is for binary kinds; ${def.kind} is a doc kind`);
        if (!isRecord(json)) return failure(`${input.file}: a ${def.kind} is a JSON object.`);
        op = { op: "createAsset", kind: def.kind, path, ...id, content: json };
      } else {
        const sha256 = await putBlob(store, data, {
          kind: def.kind,
          contentType: blobContentType(path, def.contentTypes),
        });
        op = {
          op: "importAsset",
          path,
          sha256,
          bytes: data.byteLength,
          kind: def.kind,
          ...id,
          ...(settings ? { settings } : {}),
        };
      }
      return { v: 1, label: `Import ${name}`, ops: [op] };
    },
  });
};
