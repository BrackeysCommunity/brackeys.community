import { z } from "zod";

/** Root path of the stable serving route (src/routes/images.$.ts). */
export const STORED_IMAGE_ROUTE_PREFIX = "/images/";

/**
 * Upload responses carry the app-relative `/images/<key>` URL, which
 * `z.url()` rejects (it requires an absolute URL) — this accepts either.
 */
export const uploadedImageUrlSchema = z
  .string()
  .min(1)
  .refine(
    (value) => value.startsWith(STORED_IMAGE_ROUTE_PREFIX) || z.url().safeParse(value).success,
    { message: "Must be an absolute URL or a stored /images/ path." },
  );
