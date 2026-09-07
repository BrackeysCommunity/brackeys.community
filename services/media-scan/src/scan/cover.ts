import sharp from "sharp";

import { config } from "../config.ts";
import { HttpStatusError, pacedFetch } from "../http.ts";
import {
  DHASH_H_HEIGHT,
  DHASH_H_WIDTH,
  DHASH_V_HEIGHT,
  DHASH_V_WIDTH,
  dhashFromGray,
  informativeEdges,
  MIN_INFORMATIVE_EDGES,
} from "./dhash.ts";

/**
 * Fetches a cover image through the shared pacer. The covers live on itch's
 * image CDN rather than itch.io itself, but they still ride the global gate —
 * the scan tier's slot is staggered like the others, and a CDN 429 arms the
 * same pool cooldown either way. Returns null when the cover is gone: 404 —
 * common on older entries whose games were deleted — and 403, the CDN's
 * answer for a derivative whose source image no longer exists (deleted
 * games, and covers replaced after the jam's entry list froze). The 403 is
 * per-URL and permanent — the same URLs fail run after run while the pool
 * flows on — not rate limiting.
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
  if (res.status === 403 || res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new HttpStatusError(res.status, url);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Decode + reduce + hash. Returns null when the bytes aren't a decodable
 * image (HTML error page served with 200, truncated upload) — recorded as
 * "scanned, no hash" rather than retried forever.
 *
 * Alpha is flattened onto white first: itch renders covers on light pages,
 * and grayscaling an RGBA image otherwise treats transparent pixels as
 * black, turning "ink on transparency" into "solid black". Covers with too
 * little gradient signal (informativeEdges gate) also return null — a hash
 * carrying a handful of meaningful bits matches everything equally flat,
 * so it's recorded as "no usable fingerprint" instead.
 */
export async function hashCover(bytes: Uint8Array): Promise<string | null> {
  try {
    const base = sharp(bytes, { animated: false }).flatten({ background: "#ffffff" });
    const [horizontal, vertical] = await Promise.all([
      base
        .clone()
        .resize(DHASH_H_WIDTH, DHASH_H_HEIGHT, { fit: "fill" })
        .grayscale()
        .raw()
        .toBuffer(),
      base
        .clone()
        .resize(DHASH_V_WIDTH, DHASH_V_HEIGHT, { fit: "fill" })
        .grayscale()
        .raw()
        .toBuffer(),
    ]);
    const h = new Uint8Array(horizontal);
    const v = new Uint8Array(vertical);
    if (informativeEdges(h, v) < MIN_INFORMATIVE_EDGES) return null;
    return dhashFromGray(h, v);
  } catch {
    return null;
  }
}
