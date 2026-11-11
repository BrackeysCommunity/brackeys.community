import type { z } from "zod";

import type { InputScript } from "../../headless/playtest-types";
import { formatInputScript, INPUT_SCRIPT_LAYOUT } from "../../scene/format";
import { INPUT_SCRIPT_VERSION, inputScriptSchemaFor } from "../../scene/input-script";
import type { RefSite } from "../refs";
import { defineAssetKind, folderOf } from "./define";

export const INPUT_SCRIPT_SUFFIX = ".script.json";

/** A headless playtest: held actions step by step, merging per step. */
export const inputScriptKind = defineAssetKind({
  kind: "input-script",
  title: "Input script",
  description:
    "A headless playtest: steps of held actions, played tick by tick on the game's clock.",
  match: { suffixes: [INPUT_SCRIPT_SUFFIX] },
  defaultFolder: (_env, near) => folderOf(near),
  storage: "doc",
  version: INPUT_SCRIPT_VERSION,
  schemaId: `urn:jams-engine:input-script:v${INPUT_SCRIPT_VERSION}`,
  schema: (env) => inputScriptSchemaFor(env.registry) as unknown as z.ZodType<InputScript>,
  layout: INPUT_SCRIPT_LAYOUT,
  format: (script: InputScript) => formatInputScript(script),
  empty: (): InputScript => ({ v: INPUT_SCRIPT_VERSION, steps: [{ wait: 60 }] }),
  refs: (script: InputScript): RefSite[] =>
    script.scene === undefined ? [] : [{ pointer: "/scene", id: script.scene, kinds: ["scene"] }],
});
