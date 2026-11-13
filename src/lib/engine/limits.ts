// Every number a hosted game is held to, and the one source every message
// formats them from. Import-free, so the services that copy it need nothing
// else. Sizes are bytes; "KB" and "MB" in copy mean KiB and MiB.

/** A signed-in player's save, and a signed-out one's in this browser: 32 KiB, 4 slots per game. */
export const SITE_SAVE_LIMITS = { maxBytes: 32_768, maxSlots: 4 } as const;
/** Every save a player keeps on the site, across all games. */
export const SITE_SAVE_ACCOUNT_BYTES = 1_048_576;
/** A save not loaded, written or listed for this long is deleted. */
export const SITE_SAVE_EXPIRY_DAYS = 180;
export const SAVE_WRITES_PER_HOUR = 120;
export const SAVE_READS_PER_HOUR = 600;
/** Save requests a game frame may send the play page a second. */
export const HOST_SAVE_REQUESTS_PER_SECOND = 20;
/** Preference writes a game frame may send the play page a second. */
export const HOST_PREFS_WRITES_PER_SECOND = 10;
/** A game frame may offer the play page one download this often. */
export const HOST_DOWNLOAD_INTERVAL_SECONDS = 10;
/** Live reports a game frame may send the play page a second. */
export const HOST_LIVE_STATES_PER_SECOND = 10;
/** One preferences store (remaps, or the other preferences), kept in this browser only. */
export const PREFS_MAX_BYTES = 16_384;

/** A hosted project's quotas. */
export const PROJECT_QUOTA = {
  assetBytes: 268_435_456, // 256 MiB
  docs: 1_000,
  docBytes: 67_108_864, // 64 MiB
  releaseBytes: 104_857_600, // 100 MiB per release
  releaseFiles: 2_000,
  releaseFileBytes: 33_554_432, // 32 MiB
  releaseStorageBytes: 536_870_912, // 512 MiB
  releasesKept: 10,
  jamPins: 8,
  releasesPerDay: 20,
} as const;

/** At this share of any quota the editor shows it nearly full; at 1 it is refused. */
export const QUOTA_WARN_RATIO = 0.8;
/** An unpinned release outside the newest `releasesKept` is removed this long after it was created. */
export const RELEASE_GRACE_DAYS = 14;
/** A blob nothing references is deleted after this long. */
export const BLOB_GRACE_DAYS = 30;
/** A stored release file no release lists is deleted after this long. */
export const ORPHAN_FILE_GRACE_HOURS = 24;
/** How long an upload may take from `begin` to `commit`. */
export const UPLOAD_SESSION_HOURS = 24;
/** A deleted project's docs, blobs, releases and saves are purged this long after the delete. */
export const PROJECT_PURGE_DAYS = 30;
/** How long a private release's frame link works. */
export const FRAME_TOKEN_HOURS = 12;
/** The oldest engine whose builds the site hosts: the first that speaks the host channel. */
export const MIN_HOSTED_ENGINE = "0.14.1";
/** The most "Connects to" origins a game may declare. */
export const CONNECT_ORIGINS_MAX = 4;
/** Release file uploads one person may make an hour. */
export const RELEASE_FILE_PUTS_PER_HOUR = 4_000;
/** Release uploads a project may begin an hour. */
export const RELEASE_BEGINS_PER_HOUR = 60;
/** Reports one person may file a day. */
export const GAME_REPORTS_PER_DAY = 10;
/** The largest `release.json` an upload may begin with. */
export const RELEASE_MANIFEST_MAX_BYTES = 1_048_576;

/** Live scene versions: a version's data, a project's versions a day, the versions each scene keeps, a note, begins an hour. */
export const LIVE_LIMITS = {
  versionDataBytes: 2_097_152, // 2 MiB
  versionsPerDay: 100,
  keptPerScene: 5,
  noteChars: 200,
  beginsPerHour: 120,
} as const;
/** A play page asks for the live state this often while visible, behind its stream. */
export const LIVE_POLL_SECONDS = 60;
/** The live stream closes after this long; the browser reconnects it. */
export const LIVE_STREAM_MINUTES = 60;
/** The breaker: this many distinct players failing, at this share of the reports, within this long of the move. */
export const LIVE_BLOCK = { players: 5, ratio: 0.25, windowMinutes: 30 } as const;
/** A frame that errors this soon after an applied swap counts as crashed by it. */
export const LIVE_CRASH_WINDOW_SECONDS = 10;
/** Live outcome reports one player may send an hour. */
export const LIVE_REPORTS_PER_HOUR = 30;
/** Signed-in live reports are deleted this long after they were made. */
export const LIVE_REPORT_RETENTION_DAYS = 30;
