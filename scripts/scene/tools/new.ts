import { mkdir } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";

import { ENGINE_REGISTRY_ID, type SceneTemplate } from "@jams/engine/game";
import {
  createScene,
  formatScene,
  parseScene,
  sceneHash,
  validateScene,
  type Registry,
} from "@jams/engine/scene";
import { resolveScenePath, ScenePathError } from "@jams/engine/vite";

import {
  failure,
  gameFlag,
  issueLine,
  isFileArg,
  isToolResult,
  listSceneFiles,
  openScene,
  usage,
  writeSceneText,
  type Tool,
} from "../context";

export type NewInput = { name?: string; from?: string; game?: string };

const USAGE = "scene new <name> [--game id] [--from scene]";

/**
 * Writes a new scene into its game's scenes directory (`engine`'s for a
 * scene without a game): a copy of `--from` under the new name, else the
 * game's template, else an empty world. `$schema` points at the home's
 * schema file. Nothing is written when the name is taken or the result has
 * error-severity issues.
 */
export const newScene: Tool<NewInput> = async (input, ctx) => {
  const { name } = input;
  if (!name) return usage(USAGE);
  if (isFileArg(name) || name === "-") return usage(`${USAGE}: <name> is a scene name, not a path`);

  let registry: Registry;
  let template: SceneTemplate | undefined;
  if (input.from !== undefined) {
    const from = await openScene(ctx, input.from, "new --from");
    if (!from.ok) return from.result;
    if (input.game !== undefined && input.game !== (from.def.game ?? ENGINE_REGISTRY_ID)) {
      return usage(
        `--game ${input.game}: ${input.from} is for ${from.def.game ? `game "${from.def.game}"` : "no game"}; drop --game to copy it as it is`,
      );
    }
    registry = from.registry;
    const { $schema: _s, v: _v, game: _g, name: _n, ...rest } = from.def;
    template = rest as SceneTemplate;
  } else {
    const flagged = gameFlag(ctx, input.game);
    if (isToolResult(flagged)) return flagged;
    registry = flagged;
  }

  const home = registry.id;
  const dir = ctx.scenesDirs[home];
  if (!dir) return failure(`No scenes directory for ${home}.`);
  let file: string;
  try {
    file = resolveScenePath(dir, name);
  } catch (e) {
    if (e instanceof ScenePathError) return usage(e.message);
    throw e;
  }
  const taken = (await listSceneFiles(ctx)).filter((f) => f.name === name);
  if (taken.length > 0) {
    return failure(
      `A scene named ${JSON.stringify(name)} already exists in ${taken.map((t) => t.home).join(", ")}.`,
      { homes: taken.map((t) => t.home) },
    );
  }

  const schemaFile = ctx.schemaFiles?.[home];
  const $schema = schemaFile && relative(dirname(file), schemaFile).split(sep).join("/");
  const def = createScene(name, registry, { template, $schema });
  const { text } = formatScene(def);
  const parsed = parseScene(text, registry);
  if (!parsed.ok) return failure(`${name}: the new scene doesn't parse`, { issues: parsed.issues });
  const issues = validateScene(parsed.def, registry, { lines: formatScene(parsed.def).lines });
  const errors = issues.filter((i) => i.severity === "error");
  const write = errors.length === 0;
  if (write) {
    await mkdir(dir, { recursive: true });
    await writeSceneText({ name, home, file }, text);
  }
  const game = parsed.def.game ?? null;
  return {
    exitCode: write ? 0 : 1,
    data: {
      ok: write,
      scene: name,
      home,
      game,
      file,
      written: write,
      sceneHash: sceneHash(parsed.def),
      issues,
    },
    text: [
      write ? `${name}: created in ${home} (${file})` : `${name}: not written (errors)`,
      ...issues.map(issueLine),
    ].join("\n"),
  };
};
