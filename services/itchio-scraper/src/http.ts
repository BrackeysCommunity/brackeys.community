import { createItchHttp, type ItchHost } from "../../../src/lib/itch-http.ts";
import { createHostPacers } from "../../../src/lib/itch-pacer.ts";
import { config } from "./config.ts";
import { pacerRedis } from "./redis.ts";

export {
  describeError,
  HttpStatusError,
  isNotFound,
  isTransient,
  parseRetryAfter,
  sleep,
} from "../../../src/lib/itch-http.ts";

// ── Global politeness gate ───────────────────────────────────────────────────
// All itch requests (HTML pages, entries.json, data.json, covers, the API)
// flow through one pacer per host: at most one request per interval, plus a
// pool-wide cooldown once that host starts rate limiting. The pacer lives in
// Redis when REDIS_URL is set, so this process, the media-scan worker, and a
// laptop draining a backfill draw on one budget — the reason the tiers no
// longer need a cron-minute stagger. Without Redis it paces this process
// alone, which is what every tier did when each was its own service.

export const pacerFor = createHostPacers<ItchHost>({
  redis: pacerRedis,
  intervalsMs: {
    "itch.io": config.MIN_REQUEST_INTERVAL_MS,
    "img.itch.zone": config.IMAGE_MIN_REQUEST_INTERVAL_MS,
    "api.itch.io": config.API_MIN_REQUEST_INTERVAL_MS,
  },
  cooldownMs: config.RATE_LIMIT_COOLDOWN_MS,
});

const http = createItchHttp({ userAgent: config.USER_AGENT, pacerFor });

/** Issues a paced request; see itch-http.ts for the timeout contract. */
export const pacedFetch = http.pacedFetch;

/** Fetches a URL and returns its HTML, retrying transient failures. */
export const fetchHtml = http.fetchHtml;

/** Test hook — the jar is module state shared by every pacedFetch call. */
export const resetCookieJar = http.resetCookieJar;
