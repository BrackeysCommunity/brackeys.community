import type { z } from "zod";

import type { Registry } from "../../game/types";
import type { InputScriptV2 } from "../../headless/playtest-types";
import { formatInputScript, INPUT_SCRIPT_LAYOUT } from "../../scene/format";
import {
  INPUT_SCRIPT_MIGRATIONS,
  INPUT_SCRIPT_VERSION,
  inputScriptSchemaFor,
} from "../../scene/input-script";
import type { RefSite } from "../refs";
import type { AssetId, ProjectView } from "../types";
import { defineAssetKind, folderOf } from "./define";
import { inputMapEntries, usableInputMap, type InputMapFile } from "./input-map";

export const INPUT_SCRIPT_SUFFIX = ".script.json";

/**
 * The `KindEnv.inputMap` of a project: its input map in effect (the first
 * by path) as a run reads it, from the doc values `valueOf` holds; null
 * without one or before its doc is read.
 */
export function kindInputMap(
  view: ProjectView,
  valueOf: (id: AssetId) => unknown,
  registry: Registry,
): InputMapFile | null {
  const [entry] = inputMapEntries(view);
  return entry ? usableInputMap(valueOf(entry.id), registry) : null;
}

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
  schema: (env) =>
    inputScriptSchemaFor(
      env.registry,
      env.inputMap?.players,
    ) as unknown as z.ZodType<InputScriptV2>,
  layout: INPUT_SCRIPT_LAYOUT,
  format: (script: InputScriptV2) => formatInputScript(script),
  empty: (): InputScriptV2 => ({ v: INPUT_SCRIPT_VERSION, steps: [{ wait: 60 }] }),
  refs: (script: InputScriptV2): RefSite[] =>
    script.scene === undefined ? [] : [{ pointer: "/scene", id: script.scene, kinds: ["scene"] }],
});
