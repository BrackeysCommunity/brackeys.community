/**
 * Scene docs as bytes in, bytes out, for `canvas-sync`. The service holds its
 * own copy of Yjs, so it never hands one of its docs to the engine: it passes
 * encoded state here, where the engine works on a doc of this module's Yjs,
 * and gets encoded state back. Shared with services, so no `@/` imports.
 */
import * as Y from "yjs";

// Entry indexes by relative path: the service image has no tsconfig paths.
import {
  docMeta,
  migrateDoc,
  readDoc,
  sceneToDoc,
  sequentialKeys,
} from "../../engine/collab/index.ts";
import type { SceneOrigin } from "../../engine/collab/index.ts";
import {
  EMPTY_SCENE_TEMPLATE,
  formatScene,
  hashText,
  migrate,
  MIGRATIONS,
  SCENE_FORMAT_VERSION,
  type Migration,
  type SceneDefinition,
} from "../../engine/scene/index.ts";
import { parseSceneId, sceneGame } from "./ids";

export interface SceneFormat {
  /** The format version this side reads and migrates up to. */
  version: number;
  migrations: Readonly<Record<number, Migration>>;
}

export const ENGINE_FORMAT: SceneFormat = { version: SCENE_FORMAT_VERSION, migrations: MIGRATIONS };

const MIGRATION_ORIGIN: SceneOrigin = { kind: "migration" };

function docOf(state: Uint8Array | null): Y.Doc {
  const doc = new Y.Doc();
  if (state && state.byteLength > 0) Y.applyUpdate(doc, state);
  return doc;
}

/** A new scene of this id's name: the engine's empty template. */
export function emptyScene(sceneId: string, version = SCENE_FORMAT_VERSION): SceneDefinition {
  const id = parseSceneId(sceneId);
  if (!id) throw new Error(`not a scene id: ${sceneId}`);
  const game = sceneGame(id);
  return {
    v: version,
    ...(game ? { game } : {}),
    name: id.key,
    ...structuredClone(EMPTY_SCENE_TEMPLATE),
  };
}

/** The scene a new hosted doc starts from: its stored seed, migrated, else an empty one. */
export function seedDefinition(
  sceneId: string,
  seed: string | null,
  format: SceneFormat = ENGINE_FORMAT,
): SceneDefinition {
  if (seed === null) return emptyScene(sceneId, format.version);
  const migrated = migrate(JSON.parse(seed), format.migrations, format.version);
  if (!migrated.ok) throw new Error(`scene ${sceneId}: bad seed: ${migrated.issue.message}`);
  return migrated.raw as SceneDefinition;
}

/**
 * The seed as a Yjs update, at this engine's collab layout (`meta.layout`).
 * Deterministic: the writing client id and every key derive from the scene
 * and its content, so two instances seeding one new scene at once write
 * the same items, which Yjs merges into one copy.
 */
export function seedState(sceneId: string, def: SceneDefinition): Uint8Array {
  const doc = new Y.Doc();
  doc.clientID = Number.parseInt(hashText(`${sceneId}\n${formatScene(def).text}`).slice(0, 8), 16);
  sceneToDoc(def, { doc, key: sequentialKeys("s"), origin: MIGRATION_ORIGIN });
  return Y.encodeStateAsUpdate(doc);
}

/** `meta.schemaVersion` of an encoded doc; null before it is seeded. */
export function stateSchemaVersion(state: Uint8Array | null): number | null {
  return docMeta(docOf(state))?.schemaVersion ?? null;
}

/** The collab layout of an encoded doc (`meta.layout`, 1 when absent); null before it is seeded. */
export function stateLayout(state: Uint8Array | null): number | null {
  const meta = docMeta(docOf(state));
  return meta ? (meta.layout ?? 1) : null;
}

export interface PreparedState {
  state: Uint8Array;
  schemaVersion: number;
  /** The doc was empty and now holds the seed. */
  seeded: boolean;
  /** The version migrated from, when the doc was older than `format`. */
  migratedFrom: number | null;
}

/**
 * What a doc should hold once loaded: the stored state, seeded when it holds
 * nothing yet, migrated in place when it is older than `format`. A doc newer
 * than `format` is left alone; this side can't read it.
 */
export function prepareLoadedState(
  sceneId: string,
  state: Uint8Array | null,
  seed: string | null,
  format: SceneFormat = ENGINE_FORMAT,
): PreparedState {
  const doc = docOf(state);
  const meta = docMeta(doc);
  if (!meta) {
    Y.applyUpdate(doc, seedState(sceneId, seedDefinition(sceneId, seed, format)));
    return {
      state: Y.encodeStateAsUpdate(doc),
      schemaVersion: docMeta(doc)!.schemaVersion,
      seeded: true,
      migratedFrom: null,
    };
  }
  if (meta.schemaVersion >= format.version) {
    return { state: state!, schemaVersion: meta.schemaVersion, seeded: false, migratedFrom: null };
  }
  migrateInPlace(doc, format);
  return {
    state: Y.encodeStateAsUpdate(doc),
    schemaVersion: format.version,
    seeded: false,
    migratedFrom: meta.schemaVersion,
  };
}

function migrateInPlace(doc: Y.Doc, format: SceneFormat): void {
  migrateDoc(doc, { migrations: format.migrations, target: format.version });
}

export interface SceneSnapshot {
  schemaVersion: number;
  /** `formatScene` text and its `sceneHash`; absent when the doc is newer than this side reads. */
  text?: string;
  hash?: string;
}

/** The canonical JSON and hash of an encoded doc; null before it is seeded. */
export function sceneSnapshot(
  state: Uint8Array,
  format: SceneFormat = ENGINE_FORMAT,
): SceneSnapshot | null {
  const doc = docOf(state);
  const meta = docMeta(doc);
  if (!meta) return null;
  if (meta.schemaVersion > format.version) return { schemaVersion: meta.schemaVersion };
  const text = formatScene(readDoc(doc).def).text;
  return { schemaVersion: meta.schemaVersion, text, hash: hashText(text) };
}
