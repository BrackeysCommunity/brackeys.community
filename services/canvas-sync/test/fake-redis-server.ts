import { FakeRedis } from "./fake-redis.ts";

/** `bun run test/fake-redis-server.ts [port]`: a FakeRedis for suites that read CANVAS_SYNC_TEST_REDIS_URL. */
const redis = await new FakeRedis().start(Number(process.argv[2] ?? 0));
console.log(redis.url);
