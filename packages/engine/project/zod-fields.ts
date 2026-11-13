import { z } from "zod";

import { AssetIdSchema } from "../game/fields";
import { SHA256_PATTERN } from "./hash";

// The schema fields the snapshot, release and scene version files share.

/** A SHA-256 as 64 lowercase hex characters, described when `description` is given. */
export const sha256Field = (description?: string) => {
  const field = z.string().regex(SHA256_PATTERN);
  return description === undefined ? field : field.describe(description);
};

export const idField = (description: string) => AssetIdSchema.describe(description);

/** A format version: a positive integer. */
export const formatField = (description: string) =>
  z.number().int().positive().describe(description);

export const kindNameField = z
  .string()
  .min(1)
  .describe("An asset kind: an engine kind's name, or `<game>/<kind>` for a game's.");
