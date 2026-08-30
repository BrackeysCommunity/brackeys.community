import sharp from "sharp";

import { config } from "../config.ts";
import { HttpStatusError, pacedFetch } from "../http.ts";
import { DHASH_HEIGHT, DHASH_WIDTH, dhashFromGray } from "./dhash.ts";

/**
 * Fetches a cover image through the shared pacer. The covers live on itch's
 * image CDN rather than itch.io itself, but they still ride the global gate —
 * the scan tier's slot is staggered like the others, and a CDN 429 arms the
 * same pool cooldown either way. Returns null when the cover is gone (404 —
 * common on older entries whose games were deleted).
 */
export async function fetchCover(url: string): Promise<Uint8Array | null> {
  const res = await pacedFetch(
    url,
    {
      headers: {
        "user-agent": config.USER_AGENT,
        accept: "image/*",
      },
      redirect: "follow",
    },
    45_000,
  );
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new HttpStatusError(res.status, url);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Decode + reduce + hash. Returns null when the bytes aren't a decodable
 * image (HTML error page served with 200, truncated upload) — recorded as
 * "scanned, no hash" rather than retried forever.
 */
export async function hashCover(bytes: Uint8Array): Promise<string | null> {
  try {
    const pixels = await sharp(bytes, { animated: false })
      .resize(DHASH_WIDTH, DHASH_HEIGHT, { fit: "fill" })
      .grayscale()
      .raw()
      .toBuffer();
    return dhashFromGray(new Uint8Array(pixels));
  } catch {
    return null;
  }
}
