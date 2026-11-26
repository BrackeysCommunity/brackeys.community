import { checkRateLimit } from "@/lib/rate-limit";

import { CodeBusy } from "../../../packages/mmo-api/src/index.ts";
import { noStoreHeaders } from "./cache";

export type MapBucket = "mmo-map-read" | "mmo-map-overlay";

/** Requests a minute per caller: a signed-in user, or one IP when anonymous. */
export const MAP_LIMITS: Record<MapBucket, { user: number; ip: number }> = {
  "mmo-map-read": { user: 600, ip: 600 },
  "mmo-map-overlay": { user: 120, ip: 30 },
};

export const MAP_WINDOW_SECONDS = 60;

/** Who a map request counts against. Public routes pass no user. */
export function clientKey(request: Request, userId?: string): string {
  if (userId) return `user:${userId}`;
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return `ip:${cf}`;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `ip:${forwarded || "unknown"}`;
}

/**
 * Counts one request, and answers the refusal when the caller is past their
 * limit. The window is the wall-clock minute, so Retry-After is exact.
 */
export async function mapLimit(
  bucket: MapBucket,
  key: string,
  now: number = Date.now(),
): Promise<Response | null> {
  const limits = MAP_LIMITS[bucket];
  const limit = key.startsWith("user:") ? limits.user : limits.ip;
  const windowMs = MAP_WINDOW_SECONDS * 1000;
  const window = Math.floor(now / windowMs);
  if (await checkRateLimit(bucket, `${key}:${window}`, limit, MAP_WINDOW_SECONDS)) return null;
  const retryAfter = Math.max(1, Math.ceil(((window + 1) * windowMs - now) / 1000));
  return Response.json(
    { code: CodeBusy, message: "Too many map requests. Try again shortly." },
    { status: 429, headers: { ...noStoreHeaders(), "retry-after": String(retryAfter) } },
  );
}
