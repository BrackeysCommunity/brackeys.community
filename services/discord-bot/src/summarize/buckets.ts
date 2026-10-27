/**
 * Time math for `/summarize`. A channel's history is cut into fixed UTC
 * buckets; a closed bucket never gains messages, so its summary can be made
 * once and reused by every later request whose window covers it.
 */

const DISCORD_EPOCH = 1_420_070_400_000n;

export const BUCKET_MS = 2 * 3_600_000;
/** A busy bucket is summarized in parts of this many messages. */
export const PART_SIZE = 300;
/** Closed buckets under this go to the final call raw instead of cached. */
export const QUIET_BELOW = 15;
/** Windows this small skip the bucket cache and go to one call raw. */
export const DIRECT_LIMIT = 300;
/** The most messages one request reads from Discord. */
export const MAX_FETCH = 3_000;

export const WINDOWS = {
  "1h": 3_600_000,
  "6h": 6 * 3_600_000,
  "24h": 24 * 3_600_000,
  "3d": 3 * 86_400_000,
  "7d": 7 * 86_400_000,
} as const;

/** Since the caller's own last message in the channel, at most as far back as the longest window. */
export const SINCE_MINE = "mine";
export const SINCE_MINE_MAX_MS = WINDOWS["7d"];

export type SummaryWindow = keyof typeof WINDOWS | typeof SINCE_MINE;

export function isSummaryWindow(value: unknown): value is SummaryWindow {
  return typeof value === "string" && (value === SINCE_MINE || Object.hasOwn(WINDOWS, value));
}

export function snowflakeTime(id: string): number {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

/** The smallest snowflake at `ms`, for `before` / `after` paging. */
export function snowflakeAt(ms: number): string {
  return ((BigInt(Math.max(0, Math.floor(ms))) - DISCORD_EPOCH) << 22n).toString();
}

export function bucketStart(ms: number): number {
  return Math.floor(ms / BUCKET_MS) * BUCKET_MS;
}

/** A span of the window, newest last. `bucket` is set only for a whole closed bucket. */
export interface Span {
  from: number;
  to: number;
  bucket: number | null;
}

/**
 * The window `[now - size, now)` as spans: a partial head when the window
 * starts mid-bucket, every whole closed bucket, then the open bucket. Only
 * whole closed buckets are cacheable.
 */
export function planWindow(now: number, size: number): Span[] {
  const start = now - size;
  const open = bucketStart(now);
  const spans: Span[] = [];
  let cursor = start;
  const firstWhole = Math.ceil(start / BUCKET_MS) * BUCKET_MS;
  if (firstWhole > start) {
    const to = Math.min(firstWhole, now);
    spans.push({ from: start, to, bucket: null });
    cursor = to;
  }
  for (let b = cursor; b < open; b += BUCKET_MS) {
    spans.push({ from: b, to: b + BUCKET_MS, bucket: b });
  }
  if (open >= cursor && now > open) spans.push({ from: open, to: now, bucket: null });
  return spans;
}

export function splitParts<T>(items: T[], size = PART_SIZE): T[][] {
  const parts: T[][] = [];
  for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size));
  return parts;
}
