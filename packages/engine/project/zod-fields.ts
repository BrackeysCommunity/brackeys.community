import { z } from "zod";

import { ID_PATTERN } from "../game/fields";
import { SHA256_PATTERN } from "./hash";

// The schema fields the snapshot, release and scene version files share.

export const sha256Field = (description: string) =>
  z.string().regex(SHA256_PATTERN).describe(description);

export const idField = (description: string) => z.string().regex(ID_PATTERN).describe(description);

/** A format version: a positive integer. */
export const formatField = (description: string) =>
  z.number().int().positive().describe(description);

export const kindNameField = z
  .string()
  .min(1)
  .describe("An asset kind: an engine kind's name, or `<game>/<kind>` for a game's.");
