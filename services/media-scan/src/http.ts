import { createItchHttp, type ItchHost } from "../../../src/lib/itch-http.ts";
import { createHostPacers } from "../../../src/lib/itch-pacer.ts";
import { config } from "./config.ts";
import { pacerRedis } from "./redis.ts";

export {
  describeError,
  HttpStatusError,
  isNotFound,
  isTransient,
  sleep,
} from "../../../src/lib/itch-http.ts";

/**
 * Every itch request this worker makes — data.json on itch.io, covers and
 * banners on img.itch.zone — rides the pool-wide per-host pacer it shares
 * with the crawler. No stagger, no slot: the budget is one number per host
 * in Redis, and any number of processes draw on it.
 */
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

export const pacedFetch = http.pacedFetch;
export const fetchHtml = http.fetchHtml;
