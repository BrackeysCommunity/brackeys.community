import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import { ENGINE_REGISTRY_ID, type SceneTemplate } from "@jams/engine/game";
import { projectGlobs } from "@jams/engine/project";
import {
  createScene,
  formatScene,
  parseScene,
  sceneHash,
  validateScene,
  type Registry,
} from "@jams/engine/scene";
import { applyProjectBatchToFiles, resolveScenePath, ScenePathError } from "@jams/engine/vite";

import {
  failure,
  gameFlag,
  inScope,
  issueLine,
  isFileArg,
  isToolResult,
  openScene,
  projectScenes,
  scopeError,
  usage,
  type SceneFile,
  type Tool,
  type ToolContext,
} from "../context";
import { withLiveMaterials, type ProjectHandle } from "../projects";

export type NewInput = { name?: string; from?: string; game?: string };

const USAGE = "scene new <name> [--game id] [--from scene] [--project id]";

const GLOB_CHARS = /[*?[{]/;

/** The project a new scene of `registry`'s game goes into when `--project` doesn't say: the one with that game, else the engine's. */
function homeOf(ctx: ToolContext, registry: Registry): ProjectHandle | undefined {
  if (registry.game) return ctx.projects.find((p) => p.game?.id === registry.id);
  return (
    ctx.projects.find((p) => p.file.id === ENGINE_REGISTRY_ID && !p.game) ??
    ctx.projects.find((p) => !p.game)
  );
}

/** Where a project keeps its scenes: the folder of its first scene, else the fixed start of its first asset glob. */
function sceneFolder(project: ProjectHandle, scenes: readonly SceneFile[]): string {
  const [first] = scenes;
  if (first) return dirname(first.file);
  const glob = projectGlobs(project.file).assets.find((g) => !g.startsWith("!")) ?? "";
  const fixed: string[] = [];
  for (const segment of glob.split("/")) {
    if (GLOB_CHARS.test(segment)) break;
    fixed.push(segment);
  }
  if (fixed.length === glob.split("/").length) fixed.pop();
  return join(project.dir, ...fixed);
}

/** The schema file the project's scenes point at: `ctx.schemaFiles`, else the `$schema` of one of its scenes. */
async function schemaFileOf(
  ctx: ToolContext,
  project: ProjectHandle,
  scenes: readonly SceneFile[],
): Promise<string | undefined> {
  const given = ctx.schemaFiles?.[project.file.id];
  if (given) return given;
  for (const scene of scenes) {
    try {
      const $schema = (JSON.parse(await readFile(scene.file, "utf8")) as { $schema?: unknown })
        .$schema;
      if (typeof $schema === "string") return resolve(dirname(scene.file), $schema);
    } catch {
      // A scene that doesn't parse names no schema.
    }
  }
  return undefined;
}

/**
 * Writes a new scene into a project: `--project`'s, else the one whose game
 * the scene is for (the engine's for a scene without a game), beside the
 * project's other scenes. It is a copy of `--from` under the new name, else
 * the game's template, else an empty world. `$schema` points where the
 * project's scenes point. The file is written by a `createAsset` op through
 * `applyProjectBatchToFiles`, so the project's id and path rules hold: an id
 * another asset holds is asset-id-taken, a path another asset or an unlisted
 * file holds is path-taken. Nothing is written when the name is taken by a
 * scene in any project, the project refuses the op, or the result has
 * error-severity issues.
 */
export const newScene: Tool<NewInput> = async (input, ctx) => {
  const { name } = input;
  if (!name) return usage(USAGE);
  if (isFileArg(name) || name === "-") return usage(`${USAGE}: <name> is a scene name, not a path`);
  const scoped = scopeError(ctx);
  if (scoped) return scoped;
  const named = ctx.project === undefined ? undefined : inScope(ctx)[0];

  let registry: Registry;
  let template: SceneTemplate | undefined;
  let project: ProjectHandle | undefined;
  if (input.from !== undefined) {
    const from = await openScene({ ...ctx, project: undefined }, input.from, "new --from");
    if (!from.ok) return from.result;
    if (input.game !== undefined && input.game !== (from.def.game ?? ENGINE_REGISTRY_ID)) {
      return usage(
        `--game ${input.game}: ${input.from} is for ${from.def.game ? `game "${from.def.game}"` : "no game"}; drop --game to copy it as it is`,
      );
    }
    registry = from.registry;
    project = named ?? from.project ?? homeOf(ctx, registry);
    const { $schema: _s, v: _v, game: _g, name: _n, ...rest } = from.def;
    template = rest as SceneTemplate;
  } else if (named) {
    if (input.game !== undefined && input.game !== named.game?.id)
      return usage(
        `--game ${input.game}: project "${named.file.id}" ${named.game ? `is for game "${named.game.id}"` : "has no game"}`,
      );
    registry = named.registry;
    project = named;
  } else {
    const flagged = gameFlag(ctx, input.game);
    if (isToolResult(flagged)) return flagged;
    registry = flagged;
    project = homeOf(ctx, registry);
    if (project) registry = registry.game ? project.registry : project.registry.primitives;
  }
  if (!project)
    return failure(
      registry.game
        ? `No project holds game "${registry.id}".`
        : "No project holds scenes without a game.",
    );
  if (registry.game && project.game?.id !== registry.id)
    return usage(
      `project "${project.file.id}" ${project.game ? `is for game "${project.game.id}"` : "has no game"}; its scenes can't be for game "${registry.id}"`,
    );

  const all = (await Promise.all(ctx.projects.map(projectScenes))).flat();
  const taken = all.filter((f) => f.name === name);
  if (taken.length > 0) {
    return failure(
      `A scene named ${JSON.stringify(name)} already exists in ${taken.map((t) => t.home).join(", ")}.`,
      { homes: taken.map((t) => t.home) },
    );
  }
  const own = all.filter((f) => f.project === project);
  const dir = sceneFolder(project, own);
  let file: string;
  try {
    file = resolveScenePath(dir, name);
  } catch (e) {
    if (e instanceof ScenePathError) return usage(e.message);
    throw e;
  }

  const home = project.file.id;
  const schemaFile = await schemaFileOf(ctx, project, own);
  const $schema = schemaFile && relative(dirname(file), schemaFile).split(sep).join("/");
  const def = createScene(name, registry, { template, $schema });
  const { text } = formatScene(def);
  const parsed = parseScene(text, registry);
  if (!parsed.ok) return failure(`${name}: the new scene doesn't parse`, { issues: parsed.issues });
  const issues = validateScene(parsed.def, registry, { lines: formatScene(parsed.def).lines });
  const errors = issues.filter((i) => i.severity === "error");
  const write = errors.length === 0;
  const game = parsed.def.game ?? null;
  const path = relative(project.dir, file).split(sep).join("/");
  const applied = await applyProjectBatchToFiles(
    await withLiveMaterials(project),
    {
      v: 1,
      label: `New scene ${name}`,
      ops: [{ op: "createAsset", kind: "scene", id: name, path, content: parsed.def }],
    },
    { dryRun: !write },
  );
  if (!applied.ok) {
    return {
      exitCode: 1,
      data: { ok: false, scene: name, home, game, file, written: false, issue: applied.issue },
      text: [`${name}: not created in ${home}`, issueLine(applied.issue)].join("\n"),
    };
  }
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
