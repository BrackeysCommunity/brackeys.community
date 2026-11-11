import type { z } from "zod";

import type { InputScriptV2 } from "../../headless/playtest-types";
import { formatInputScript, INPUT_SCRIPT_LAYOUT } from "../../scene/format";
import {
  INPUT_SCRIPT_MIGRATIONS,
  INPUT_SCRIPT_VERSION,
  inputScriptSchemaFor,
} from "../../scene/input-script";
import type { RefSite } from "../refs";
import { defineAssetKind, folderOf } from "./define";

export const INPUT_SCRIPT_SUFFIX = ".script.json";

/** A headless playtest: steps per seat, merging per step and per track. */
export const inputScriptKind = defineAssetKind({
  kind: "input-script",
  title: "Input script",
  description:
    "A headless playtest: steps of held actions, analog values, pointer moves and seat changes, one track per seat, played tick by tick on the game's clock.",
  match: { suffixes: [INPUT_SCRIPT_SUFFIX] },
  defaultFolder: (_env, near) => folderOf(near),
  storage: "doc",
  version: INPUT_SCRIPT_VERSION,
  migrations: INPUT_SCRIPT_MIGRATIONS,
  schemaId: `urn:jams-engine:input-script:v${INPUT_SCRIPT_VERSION}`,
  schema: (env) => inputScriptSchemaFor(env.registry) as unknown as z.ZodType<InputScriptV2>,
  layout: INPUT_SCRIPT_LAYOUT,
  format: (script: InputScriptV2) => formatInputScript(script),
  empty: (): InputScriptV2 => ({ v: INPUT_SCRIPT_VERSION, steps: [{ wait: 60 }] }),
  refs: (script: InputScriptV2): RefSite[] =>
    script.scene === undefined ? [] : [{ pointer: "/scene", id: script.scene, kinds: ["scene"] }],
});
