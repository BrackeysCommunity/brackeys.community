import {
  engineReleaseNoticePublisher,
  type EngineReleaseNotice,
} from "../../../src/lib/image-quarantine.ts";

/**
 * Tells the web app's frame caches that a quarantine hid these releases, so
 * origin answers 410 at once rather than when its cache entry expires. On
 * the fail-fast connection: with Redis down the publish rejects, the
 * takedown logs it, and the cache's TTL bounds how long origin is stale.
 */
export function releaseNoticePublisher(
  client?: Parameters<typeof engineReleaseNoticePublisher>[0],
): (notice: EngineReleaseNotice) => Promise<void> {
  return async (notice) =>
    engineReleaseNoticePublisher(client ?? (await import("./redis.ts")).pacerRedis)(notice);
}
