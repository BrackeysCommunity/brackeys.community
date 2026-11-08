import type { z } from "zod";

import {
  CHECKS_FORMAT_VERSION,
  CHECKS_SUFFIX,
  checksSchemaFor,
  type ChecksFile,
} from "../../scene/checks";
import { CHECKS_LAYOUT, formatChecks } from "../../scene/format";
import type { RefSite } from "../refs";
import { defineAssetKind, folderOf, isPlainObject } from "./define";

/** Checks for the scene beside the file, co-edited per check and field. */
export const checksKind = defineAssetKind({
  kind: "checks",
  title: "Checks",
  description: "Checks for the scene beside this file: validity, scripted runs and fuzz touches.",
  match: { suffixes: [CHECKS_SUFFIX] },
  defaultFolder: (_env, near) => folderOf(near),
  storage: "doc",
  version: CHECKS_FORMAT_VERSION,
  schemaId: `urn:jams-engine:checks:v${CHECKS_FORMAT_VERSION}`,
  schema: (env) => checksSchemaFor(env.registry) as unknown as z.ZodType<ChecksFile>,
  layout: CHECKS_LAYOUT,
  format: (file: ChecksFile) => formatChecks(file),
  empty: (): ChecksFile => ({ v: CHECKS_FORMAT_VERSION, checks: [] }),
  /** Inline scripts' `scene`; a script given by path and the scene the file sits beside are paths, not ids. */
  refs: (file: ChecksFile): RefSite[] =>
    file.checks.flatMap((check) => {
      const script = (check as Record<string, unknown>).script;
      if (!isPlainObject(script) || typeof script.scene !== "string") return [];
      return [{ pointer: `/checks/@${check.id}/script/scene`, id: script.scene, kinds: ["scene"] }];
    }),
});
