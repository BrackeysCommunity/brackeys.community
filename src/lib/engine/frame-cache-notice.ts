import {
  ENGINE_RELEASE_NOTICE_CHANNEL,
  formatEngineReleaseNotice,
  parseEngineReleaseNotice,
  type EngineReleaseNotice,
} from "@/lib/image-quarantine";
import {
  createBroadcast,
  type BroadcastRedis,
  type BroadcastSubscriber,
} from "@/lib/live-broadcast";

/**
 * Hosted releases whose hidden state changed, across processes: the
 * media-scan worker and every web instance publish on one Redis channel,
 * and each web instance keeps a single subscriber that hands every notice
 * to its frame cache. Best effort both ways; a process that misses one
 * reads the release again when its cache entry's TTL runs out.
 */

/** The part of an ioredis client the subscriber uses. */
export type NoticeSubscriber = BroadcastSubscriber;

/** Redis clients in place of the shared ones, which exist only when `REDIS_URL` is set. */
export type FrameCacheNoticeDeps = BroadcastRedis;

type Listener = (notice: EngineReleaseNotice) => void;

// The media-scan worker and canvas-sync publish the same wire format through their own clients.
const notices = createBroadcast<EngineReleaseNotice>({
  name: "engine-release-notice",
  channel: ENGINE_RELEASE_NOTICE_CHANNEL,
  encode: formatEngineReleaseNotice,
  decode: parseEngineReleaseNotice,
  // A frame cache only drops entries, so hearing a notice twice is harmless.
  deliverHere: true,
  context: (notice) => ({ releases: notice.releaseIds.length, projects: notice.projectIds.length }),
});

const isEmpty = (notice: EngineReleaseNotice) =>
  notice.releaseIds.length === 0 && notice.projectIds.length === 0;

/** Hands a notice to this process's listeners at once, then to every other process's. Never throws. */
export async function announceReleaseChange(
  notice: EngineReleaseNotice,
  deps: FrameCacheNoticeDeps = {},
): Promise<void> {
  if (!isEmpty(notice)) await notices.announce(notice, deps);
}

/** Announces a change to every process's frame cache, this one's through Redis too. Never throws. */
export async function publishReleaseNotice(
  notice: EngineReleaseNotice,
  deps: FrameCacheNoticeDeps = {},
): Promise<void> {
  if (!isEmpty(notice)) await notices.publish(notice, deps);
}

/** Hears every notice published on this channel, from any process; returns the unsubscribe. */
export function onReleaseNotice(
  listener: Listener,
  deps: FrameCacheNoticeDeps = {},
): Promise<() => void> {
  return notices.listen(listener, deps);
}
