import {
  ENGINE_RELEASE_NOTICE_CHANNEL,
  formatEngineReleaseNotice,
  type EngineReleaseNotice,
} from "../../../src/lib/image-quarantine.ts";

type Publisher = { publish(channel: string, message: string): Promise<unknown> };

/**
 * Tells the web app's frame caches that a quarantine hid these releases, so
 * origin answers 410 at once rather than when its cache entry expires. On
 * the fail-fast connection: with Redis down the publish rejects, the
 * takedown logs it, and the cache's TTL bounds how long origin is stale.
 */
export function releaseNoticePublisher(
  client?: Publisher,
): (notice: EngineReleaseNotice) => Promise<void> {
  return async (notice) => {
    const publisher = client ?? (await import("./redis.ts")).pacerRedis;
    await publisher.publish(ENGINE_RELEASE_NOTICE_CHANNEL, formatEngineReleaseNotice(notice));
  };
}
