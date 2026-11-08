/**
 * Hosted scene documents: what `canvas-sync` enforces per scene. Shared by
 * the web app and the service, so no `@/` imports.
 */
export const SCENE_LIMITS = {
  /** Entries in the doc's `entities` map, named and bulk alike; a store over it is refused. */
  maxEntities: 10_000,
  /** Encoded Yjs state per scene. */
  maxStateBytes: 2 * 1024 * 1024,
  /** One incoming websocket message after the first sync. */
  maxMessageBytes: 512 * 1024,
  /** A seed the web app stores for a new hosted scene. */
  maxSeedBytes: 1024 * 1024,
} as const;

/**
 * Hosted asset docs (`asset:<project>.<key>`): what a doc kind gets when its
 * `DocKindDef.limits` names nothing. The service clamps what a kind names to
 * its own caps.
 */
export const ASSET_DOC_LIMITS = {
  maxStateBytes: 1024 * 1024,
  maxMessageBytes: 256 * 1024,
} as const;

/** A hosted project's registry doc (`project:<id>`). */
export const PROJECT_DOC_LIMITS = {
  maxStateBytes: 2 * 1024 * 1024,
  maxMessageBytes: 256 * 1024,
} as const;

/** Prefab docs, whose kind names no limits: an asset doc's state, and a scene's cap on entities for its children. */
export const PREFAB_DOC_LIMITS = {
  maxStateBytes: ASSET_DOC_LIMITS.maxStateBytes,
  maxItems: SCENE_LIMITS.maxEntities,
} as const;
