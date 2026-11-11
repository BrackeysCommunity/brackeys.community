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
  type SceneIssue,
} from "../../engine/scene/index.ts";
import { parseSceneId, sceneGame } from "./ids";

export interface SceneFormat {
  /** The format version this side reads and migrates up to. */
  version: number;
  migrations: Readonly<Record<number, Migration>>;
}

export const ENGINE_FORMAT: SceneFormat = { version: SCENE_FORMAT_VERSION, migrations: MIGRATIONS };

const MIGRATION_ORIGIN: SceneOrigin = { kind: "migration" };

/** How far a document lifts here: `version` is where it lands, below `format.version` when a step refused. */
export type Lifted = { raw: unknown; version: number; unresolved?: SceneIssue };

/**
 * Lifts `raw` as far as `format` can without the game: a step that needs
 * the game's registry (`migration-unresolved`, which every step needing it
 * returns on this side) stops the lift at the version before it, with the
 * refusal as `unresolved`. Throws for any other refusal.
 */
export function liftReachable(raw: unknown, format: SceneFormat = ENGINE_FORMAT): Lifted {
  const full = migrate(structuredClone(raw), format.migrations, format.version);
  if (full.ok) return { raw: full.raw, version: format.version };
  if (full.issue.code !== "migration-unresolved") throw new Error(full.issue.message);
  const from = (raw as { v: number }).v;
  for (let target = format.version - 1; target > from; target--) {
    const partial = migrate(structuredClone(raw), format.migrations, target);
    if (partial.ok) return { raw: partial.raw, version: target, unresolved: full.issue };
  }
  return { raw, version: from, unresolved: full.issue };
}

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

/**
 * The scene a new hosted doc starts from: its stored seed, migrated to
 * `format`, else an empty one. Throws for a seed that doesn't reach
 * `format`, one that needs its game's code included, so a bundle can't
 * seed an older format.
 */
export function seedDefinition(
  sceneId: string,
  seed: string | null,
  format: SceneFormat = ENGINE_FORMAT,
): SceneDefinition {
  const lifted = seedLift(sceneId, seed, format);
  if (lifted.unresolved)
    throw new Error(`scene ${sceneId}: bad seed: ${lifted.unresolved.message}`);
  return lifted.raw as SceneDefinition;
}

function seedLift(sceneId: string, seed: string | null, format: SceneFormat): Lifted {
  if (seed === null) return { raw: emptyScene(sceneId, format.version), version: format.version };
  try {
    return liftReachable(JSON.parse(seed), format);
  } catch (error) {
    throw new Error(`scene ${sceneId}: bad seed: ${(error as Error).message}`);
  }
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
  /** The version migrated from, when the doc was older than `format` and lifted. */
  migratedFrom: number | null;
  /**
   * Why the doc stays below `format.version`: a step needs the game's code
   * (`migration-unresolved`). Such a doc is served read-only to clients on
   * `format` until a tool with its game migrates it.
   */
  unresolved?: SceneIssue;
}

/**
 * What a doc should hold once loaded: the stored state, seeded when it holds
 * nothing yet, migrated in place when it is older than `format`, as far as
 * this side can without the game (`unresolved` says why it stopped). A doc
 * newer than `format` is left alone; this side can't read it.
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
    const lifted = seedLift(sceneId, seed, format);
    Y.applyUpdate(doc, seedState(sceneId, lifted.raw as SceneDefinition));
    return {
      state: Y.encodeStateAsUpdate(doc),
      schemaVersion: docMeta(doc)!.schemaVersion,
      seeded: true,
      migratedFrom: null,
      ...(lifted.unresolved ? { unresolved: lifted.unresolved } : {}),
    };
  }
  if (meta.schemaVersion >= format.version) {
    return { state: state!, schemaVersion: meta.schemaVersion, seeded: false, migratedFrom: null };
  }
  const lifted = liftReachable(readDoc(doc).def, format);
  const unresolved = lifted.unresolved ? { unresolved: lifted.unresolved } : {};
  if (lifted.version === meta.schemaVersion) {
    return {
      state: state!,
      schemaVersion: meta.schemaVersion,
      seeded: false,
      migratedFrom: null,
      ...unresolved,
    };
  }
  migrateDoc(doc, { migrations: format.migrations, target: lifted.version });
  return {
    state: Y.encodeStateAsUpdate(doc),
    schemaVersion: lifted.version,
    seeded: false,
    migratedFrom: meta.schemaVersion,
    ...unresolved,
  };
}

export interface SceneSnapshot {
  schemaVersion: number;
  /**
   * `formatScene` text and its `sceneHash`; absent unless the doc is at
   * `format.version`: newer than this side reads, or older and not migrated.
   */
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
  if (meta.schemaVersion !== format.version) return { schemaVersion: meta.schemaVersion };
  const text = formatScene(readDoc(doc).def).text;
  return { schemaVersion: meta.schemaVersion, text, hash: hashText(text) };
}
