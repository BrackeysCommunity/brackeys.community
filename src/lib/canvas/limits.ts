/**
 * Canvas limits, shared by the editor, the web server and `canvas-sync`.
 * Starting values: canvases are pre-launch, so these can move.
 *
 * Copied into service images, so no `@/` imports.
 */
export const CANVAS_LIMITS = {
  /** Cards per canvas: the editor stops adding, a store over it is refused. */
  maxNodes: 2_000,
  /** Characters per text card; longer text is truncated in the snapshot. */
  maxCardText: 20_000,
  /** Edge and group labels. */
  maxLabel: 500,
  maxUrl: 2_048,
  /** Encoded Yjs state per document. */
  maxStateBytes: 5 * 1024 * 1024,
  /** One incoming websocket message. */
  maxMessageBytes: 1024 * 1024,
  /** Personal canvases per member. */
  maxPersonalCanvases: 100,
  /** Cards per transaction when applying a large paste or import. */
  applyChunkSize: 200,
  /** Card coordinates are clamped to ±this. */
  maxCoordinate: 1_000_000,
  /** Card width and height are clamped to [minSize, maxSize]. */
  minSize: 1,
  maxSize: 100_000,
  /** Unknown keys kept on a node, edge or canvas, serialised. */
  maxExtraBytes: 4_096,
  /** People a personal canvas can be shared with. */
  maxCanvasMembers: 50,
} as const;

/** Canvas images a member may upload a day, its own budget apart from avatars. */
export const CANVAS_IMAGE_UPLOADS_PER_DAY = 200;

/** A version is taken on store when the newest one is older than this. */
export const VERSION_INTERVAL_MS = 60 * 60 * 1000;
/** Versions older than this are swept, except each document's newest. */
export const VERSION_RETENTION_DAYS = 30;
/** Soft-deleted documents stay restorable this long. */
export const SOFT_DELETE_DAYS = 30;

/** Live sync: what `canvas-sync` enforces per connection, canvas and user. */
export const SYNC_LIMITS = {
  /** Messages per connection, sustained; a token bucket refilling at this rate. */
  messagesPerSecond: 60,
  /** The bucket's size: a burst a connection may send at once. */
  messageBurst: 200,
  connectionsPerCanvas: 50,
  /** Across every canvas and every instance. */
  connectionsPerUser: 10,
  /** A live doc is stored this long after its last change… */
  storeDebounceMs: 2_000,
  /** …and at least this often while changes keep coming. */
  storeMaxDebounceMs: 10_000,
  /** The JSON Canvas snapshot is rebuilt at most this often per live canvas. */
  snapshotIntervalMs: 30_000,
  /** How long a minted sync token can be used to open a websocket. */
  tokenTtlMs: 60_000,
} as const;

/**
 * What one Obsidian import may bring in. An import over any of these is
 * refused before anything is uploaded or created, with the numbers.
 */
export const CANVAS_IMPORT_LIMITS = {
  /** A picked or dropped `.zip`, compressed. */
  maxZipBytes: 200 * 1024 * 1024,
  /** Everything in the import once unzipped: the zip-bomb guard. */
  maxUnzippedBytes: 500 * 1024 * 1024,
  /** Files in the import, counted before reading any of them. */
  maxFiles: 5_000,
  /** Images uploaded by one import, against the 200/day `canvas-image` budget. */
  maxImagesPerImport: 200,
  /** One note's bytes; a bigger note keeps the "not included" state. */
  maxMarkdownBytes: 1024 * 1024,
} as const;
