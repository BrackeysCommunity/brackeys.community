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
