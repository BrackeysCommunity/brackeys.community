import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_BUILD_TARGET, exportTargetNames } from "@jams/engine/export";
import { DEFAULT_SWAP_TIMING, SWAP_TIMINGS, swapTimingSchema } from "@jams/engine/game";
import { RELEASE_FILE } from "@jams/engine/project";
import { checksPathOf, SCENE_FORMAT_VERSION } from "@jams/engine/scene";
import { z } from "zod";

import { LIVE_LIMITS } from "../../src/lib/engine/limits";
import {
  failure,
  hostedOptions,
  isFileArg,
  isToolResult,
  locateScene,
  scopeError,
  usage,
  type ToolContext,
  type ToolResult,
} from "./context";
import { GAME_PRESETS } from "./game-templates";
import {
  AGENT_SITE_ENV,
  agentSiteFrom,
  agentTokenFrom,
  AGENT_TOKEN_ENV,
  isHostedUrl,
  isLocalHost,
} from "./hosted";
import { DEFAULT_PROJECT_URL, ProjectClientError, readLiveScene } from "./project-client";
import { rasterizeSvg } from "./raster";
import { apply } from "./tools/apply";
import { applyLive } from "./tools/apply-live";
import { assetsApply, type WriterFlags } from "./tools/assets-apply";
import { assetsImport } from "./tools/assets-import";
import { check } from "./tools/check";
import { codes } from "./tools/codes";
import { diff } from "./tools/diff";
import { flow } from "./tools/flow";
import { fuzz } from "./tools/fuzz";
import { gameBuild } from "./tools/game-build";
import {
  gameLiveBuild,
  gameLiveCheck,
  gameLiveClear,
  gameLiveList,
  gameLivePromote,
  gameLivePublish,
  gameLiveRollback,
} from "./tools/game-live";
import { gameManifest } from "./tools/game-manifest";
import { gameNew } from "./tools/game-new";
import {
  gameReleaseCreate,
  gameReleaseList,
  gameReleasePromote,
  gameReleaseRollback,
} from "./tools/game-release";
import { list } from "./tools/list";
import { playtest } from "./tools/playtest";
import { projectRefs } from "./tools/project-refs";
import { projectTree } from "./tools/project-tree";
import { render } from "./tools/render";
import { replay } from "./tools/replay";
import { schema, SCHEMA_NAMES } from "./tools/schema";
import { show } from "./tools/show";
import { validate } from "./tools/validate";

/** The agent id a live batch is logged under when `agentId` is left out. */
export const DEFAULT_MCP_AGENT_ID = "mcp";

export type McpAnnotations = {
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
};

/** What a tool hands back: the CLI tool's result, and for `scene_render` a PNG. */
export type McpToolOutput = ToolResult & { image?: { data: string; mimeType: "image/png" } };

export type McpTool<S extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  title: string;
  description: string;
  annotations: McpAnnotations;
  input: S;
  run: (input: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<McpToolOutput>;
};

/** An MCP `CallToolResult`, built without the SDK. */
export type McpCallResult = {
  content: (
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: "image/png" }
  )[];
  structuredContent: Record<string, unknown>;
  isError: boolean;
};

const READ: McpAnnotations = { readOnlyHint: true, openWorldHint: false };
/** Writes a build over its output directory; the same inputs give the same bytes. */
const BUILD: McpAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};
const WRITE: McpAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const projectArg = z
  .string()
  .optional()
  .describe("Names resolve in this project only; an id two projects hold needs it.");

/** A tool with `project` added to its input, which `runMcpTool` scopes the call to. */
const defineTool = <S extends z.ZodRawShape>(tool: McpTool<S>): McpTool =>
  ({ ...tool, input: { ...tool.input, project: projectArg } }) as never;

/** Uploads a release to the site; the same build uploaded twice is the same release. */
const RELEASE_CREATE: McpAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
/** Points the preview channel at another release; the release itself never changes. */
const RELEASE_MOVE: McpAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
const RELEASE_READ: McpAnnotations = { readOnlyHint: true, openWorldHint: true };
/** Writes a scene version over its output directory; with `hosted`, reads the hosted project first. */
const LIVE_BUILD: McpAnnotations = { ...BUILD, openWorldHint: true };
/** Stops a scene's live version on preview; stopping it again changes nothing. */
const LIVE_CLEAR: McpAnnotations = { ...RELEASE_MOVE, idempotentHint: true };

// ─── Inputs ──────────────────────────────────────────────

const sceneArg = z.string().describe("Scene name, or a scene file path (read-only).");
const sceneName = z.string().describe("Scene name.");
const game = z.string().optional().describe("Game to run a scene without a `game` key under.");
const liveFields = {
  live: z
    .boolean()
    .optional()
    .describe("Use the doc open on the dev collab server (`vp dev`), unsaved edits included."),
  url: z
    .string()
    .optional()
    .describe(
      `Collab server URL, localhost only, default ${DEFAULT_PROJECT_URL}; or, with ${AGENT_TOKEN_ENV} and ${AGENT_SITE_ENV} set in the server's environment, that site, which hosts the token's project.`,
    ),
};
const writerFields = {
  dryRun: z.boolean().default(true).describe("Report what would change without writing."),
  agentId: z
    .string()
    .optional()
    .describe(`Live: the agent id the history entry names. Default \`${DEFAULT_MCP_AGENT_ID}\`.`),
  onBehalfOf: z.string().optional().describe("The user the agent acts for."),
  ...liveFields,
};
const opBatch = z
  .looseObject({
    ops: z.array(z.looseObject({ op: z.string() })),
    label: z.string().optional(),
    base: z.string().optional(),
  })
  .describe(
    `An OpBatch at format v${SCENE_FORMAT_VERSION}, lengths in metres; \`scene_schema\` with which \`ops\` gives its full schema.`,
  );
const jsonOrPath = (what: string) =>
  z.union([z.string(), z.record(z.string(), z.unknown())]).describe(`${what}, or a path to one.`);

// ─── Live docs and inline payloads ───────────────────────

/**
 * The collab URL for a live call: the local dev server's, or a hosted
 * project's site when the server was started with an agent token and that
 * site's origin in its environment. Neither travels as a tool argument, so
 * a caller can't send the token anywhere else.
 */
function liveUrl(url: string | undefined, ctx: ToolContext): string | ToolResult {
  if (url === undefined) return DEFAULT_PROJECT_URL;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return usage(`url: not a URL: ${url}`);
  }
  if (/^https?:$/.test(parsed.protocol)) {
    const env = ctx.env ?? process.env;
    if (!agentTokenFrom(undefined, env))
      return usage(
        `url: a hosted project needs ${AGENT_TOKEN_ENV} set in the MCP server's environment`,
      );
    const site = agentSiteFrom(env);
    if (!site)
      return usage(
        `url: a hosted project needs ${AGENT_SITE_ENV} (the site's https:// origin) set in the MCP server's environment`,
      );
    if (!isHostedUrl(url) || parsed.origin !== site)
      return usage(`url: the agent token is only sent to ${site} (${AGENT_SITE_ENV})`);
    return url;
  }
  if (!/^wss?:$/.test(parsed.protocol)) return usage("url: expected ws://, wss:// or https://");
  if (!isLocalHost(parsed.hostname))
    return usage("url: only the local dev server's docs are reachable (localhost)");
  return url;
}

/** A per-call scratch directory for payloads the CLI tools read from files; removed after the call. */
function scratch() {
  let dir: Promise<string> | undefined;
  return {
    async write(name: string, text: string): Promise<string> {
      dir ??= mkdtemp(join(tmpdir(), "jams-scene-mcp-"));
      const file = join(await dir, name);
      await writeFile(file, text, "utf8");
      return file;
    },
    /** A path as given, or an inline JSON value written to a file. */
    async payload(name: string, value: unknown): Promise<string> {
      return typeof value === "string" ? value : this.write(name, JSON.stringify(value));
    },
    async close() {
      if (dir) await rm(await dir, { recursive: true, force: true });
    },
  };
}
type Scratch = ReturnType<typeof scratch>;

/** Renames `scene` fields that name the stand-in argument (`-` or a scratch file) back to the scene. */
function relabel(value: unknown, from: string, to: string, depth = 0): void {
  if (typeof value !== "object" || value === null || depth > 2) return;
  const rec = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(rec)) {
    if (k !== "scene") relabel(v, from, to, depth + 1);
    else if (typeof v === "string" && v.startsWith(from) && /^([+@]|$)/.test(v.slice(from.length)))
      rec[k] = to + v.slice(from.length);
  }
}

type SourceInput = { scene: string; live?: boolean; url?: string };

type LiveInput = { live?: boolean; url?: string };

/** A project reader's live flags, the URL checked by `liveUrl`. */
function liveRead(i: LiveInput, ctx: ToolContext): LiveInput | ToolResult {
  if (!i.live) return i.url === undefined ? {} : usage("url needs live");
  const url = liveUrl(i.url, ctx);
  return isToolResult(url) ? url : { live: true, url };
}

type WriterInput = LiveInput & { dryRun?: boolean; agentId?: string; onBehalfOf?: string };

/** A project writer's CLI flags: a dry run unless `dryRun` is false; a live agent defaults to `mcp`. */
function writerFlags(i: WriterInput, ctx: ToolContext): WriterFlags | ToolResult {
  const live = liveRead(i, ctx);
  if (isToolResult(live)) return live;
  return {
    ...live,
    dryRun: i.dryRun ?? true,
    ...(i.agentId !== undefined || live.live ? { agent: i.agentId ?? DEFAULT_MCP_AGENT_ID } : {}),
    ...(i.onBehalfOf === undefined ? {} : { onBehalfOf: i.onBehalfOf }),
  };
}

/**
 * Runs a read tool on a scene by name or path, or with `live` on the dev
 * server's doc: read once as canonical JSON, then handed to the tool as `-`
 * through `readStdin` (or, `asFile`, as a scratch file for tools that need
 * a path).
 */
async function withSource(
  input: SourceInput,
  ctx: ToolContext,
  run: (scene: string, ctx: ToolContext, tmp: Scratch) => Promise<ToolResult>,
  opts: { asFile?: boolean } = {},
): Promise<ToolResult> {
  const tmp = scratch();
  try {
    if (!input.live) {
      if (input.url !== undefined) return usage("url needs live");
      return await run(input.scene, ctx, tmp);
    }
    if (isFileArg(input.scene) || input.scene === "-")
      return usage("live takes a scene name; file paths are read-only");
    const url = liveUrl(input.url, ctx);
    if (isToolResult(url)) return url;
    let text: string;
    try {
      ({ text } = await readLiveScene({
        projects: ctx.projects,
        project: ctx.project,
        url,
        scene: input.scene,
        ...hostedOptions(ctx, undefined),
      }));
    } catch (e) {
      if (e instanceof ProjectClientError)
        return e.exitCode === 2
          ? usage(e.message)
          : failure(e.message, { scene: input.scene, url });
      throw e;
    }
    const arg = opts.asFile ? await tmp.write(`${input.scene}.json`, text) : "-";
    const result = await run(arg, opts.asFile ? ctx : { ...ctx, readStdin: async () => text }, tmp);
    relabel(result.data, arg, input.scene);
    if (typeof result.data === "object" && result.data !== null)
      Object.assign(result.data, { live: true, url });
    return result;
  } finally {
    await tmp.close();
  }
}

/** `render`'s data without `--out`. */
type Rendered = {
  scene: string;
  svg: string;
  region: readonly number[];
  scale: number;
  width: number;
  height: number;
  tick: number;
};

const opt = <T>(v: T | undefined, f: (v: T) => string) => (v === undefined ? undefined : f(v));

/**
 * A build's report without the contents of any file: byte arrays are
 * dropped, and a planned file's `source` keeps its kind and hash but not
 * its text. Paths, hashes and byte counts stay.
 */
export function withoutFileBytes(value: unknown): unknown {
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return undefined;
  if (Array.isArray(value)) return value.map(withoutFileBytes);
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "source" && typeof v === "object" && v !== null && "kind" in v) {
      const { text: _text, bytes: _bytes, ...rest } = v as Record<string, unknown>;
      out[k] = withoutFileBytes(rest);
      continue;
    }
    const kept = withoutFileBytes(v);
    if (kept !== undefined) out[k] = kept;
  }
  return out;
}

/** A build tool's result for an agent: its report without file contents, and the printed summary when the report has none. */
function buildReport(result: ToolResult): ToolResult {
  const data = withoutFileBytes(result.data);
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ...result, data };
  return {
    ...result,
    data: "summary" in data || "error" in data ? data : { ...data, summary: result.text },
  };
}

/**
 * The release tools reach the site with the agent token and site origin of
 * the server's environment, never with tool arguments, so a caller can't
 * send the token anywhere else.
 */
function releaseEnv(ctx: ToolContext): ToolResult | null {
  return siteEnv(ctx, "releases", "an agent token with write access");
}

function siteEnv(ctx: ToolContext, what: string, token: string): ToolResult | null {
  const env = ctx.env ?? process.env;
  if (!agentTokenFrom(undefined, env))
    return usage(`${what} need ${token}: set ${AGENT_TOKEN_ENV} in the MCP server's environment`);
  if (!agentSiteFrom(env))
    return usage(
      `${what} need ${AGENT_SITE_ENV} (the site's https:// origin) set in the MCP server's environment`,
    );
  return null;
}

const releaseProject = z.string().describe("The project's id, as `scene_list` shows it.");
const releaseChannel = z
  .string()
  .describe(
    "`preview`. Production moves only by a person on the game's page; an agent asking for it is refused (`release-forbidden`) with that page's URL.",
  );

const liveTiming = swapTimingSchema
  .optional()
  .describe(
    `When players get it: ${SWAP_TIMINGS.map((t) => `\`${t}\`${t === DEFAULT_SWAP_TIMING ? " (default)" : ""}`).join(", ")}. A timing the game doesn't list in \`GameDefinition.live.timings\` is clamped to the strongest it accepts, with a warning.`,
  );

// ─── Tools ───────────────────────────────────────────────

export const MCP_TOOLS: readonly McpTool[] = [
  defineTool({
    name: "scene_list",
    title: "List scenes",
    description:
      "Every scene with its game, hash, issue counts, entity counts and bounds (metres).",
    annotations: READ,
    input: {},
    run: (_i, ctx) => list({}, ctx),
  }),
  defineTool({
    name: "scene_show",
    title: "Show a scene",
    description:
      "A scene's entities and bulk entries with refs, derived AABB and top span, and the scene hash, with `time` (its clock as Play resolves it: kind, rate, catch-up) and `physics` (`rapier`, or `none`: no wasm loads): instance children (nested ones as `a/b/c`) in world coordinates, with `z`, the world turn and flip, behavior blocks, an instance's params and the params its prefab exposes, each grid field's filled cells and bounds, and each sprite's `asset[:frame]` and world box (sized from the project's assets). Every length is metres (speeds m/s); `pxPerMetre` is the game's px per metre. Filter by ref, type or a circle.",
    annotations: READ,
    input: {
      scene: sceneArg,
      ref: z.string().optional().describe("Only this entity id or `~` bulk ref."),
      type: z.string().optional().describe("Only entities of this type."),
      near: z
        .tuple([z.number(), z.number(), z.number()])
        .optional()
        .describe("[x, y, r] in metres: only entities within r of (x, y)."),
      ...liveFields,
    },
    run: (i, ctx) =>
      withSource(i, ctx, (scene, c) =>
        show({ scene, ref: i.ref, type: i.type, near: opt(i.near, (n) => n.join(",")) }, c),
      ),
  }),
  defineTool({
    name: "scene_schema",
    title: "JSON Schema",
    description:
      "The JSON Schema of a scene, an op batch, an input script, a checks file, a run recording, a scene fragment (clipboard JSON), a prefab file, the project file, a sidecar, a project op batch, a project snapshot or any doc kind (`input-map` among them): a game's with `game` (or `project`), the engine's without.",
    annotations: READ,
    input: {
      which: z
        .string()
        .optional()
        .describe(
          `One of ${SCHEMA_NAMES.join(", ")}, or another doc kind's name. Default \`scene\`.`,
        ),
      game: z.string().optional().describe("A game id, as `scene_list` shows."),
    },
    run: (i, ctx) => schema({ which: i.which, game: i.game }, ctx),
  }),
  defineTool({
    name: "scene_codes",
    title: "Issue codes",
    description: "Every issue code, the engine's then each game's, with severity and summary.",
    annotations: READ,
    input: {},
    run: (_i, ctx) => codes({}, ctx),
  }),
  defineTool({
    name: "scene_flow",
    title: "Scene flow",
    description:
      "Each project's scene list as data (`project` narrows it to one): the list's id and path, its `start`, each listed scene with its title, sublevel tag, whether it starts, `physics` (`rapier` or `none`) and `bundle` (the blobs and bytes it loads before it draws; both null for a scene that doesn't open), `unlisted` (the project's scenes the list leaves out), and `issues`: the list's own (`start-scene-missing`, an entry naming no scene as `asset-missing`) and every check naming a scene flow can't go to (`scene-unlisted`). Edit the list with `asset_apply_ops` on its `scene-list` doc. exitCode 1 on an error-severity issue.",
    annotations: READ,
    input: {},
    run: (_i, ctx) => flow({}, ctx),
  }),
  defineTool({
    name: "scene_validate",
    title: "Validate a scene",
    description:
      "Parse and structural issues; with `physical`, the physics world's too. exitCode 1 means error-severity issues.",
    annotations: READ,
    input: {
      scene: sceneArg,
      physical: z
        .boolean()
        .optional()
        .describe("Also build the physics world and report its issues."),
      ...liveFields,
    },
    run: (i, ctx) =>
      withSource(i, ctx, (target, c) => validate({ target, physical: i.physical === true }, c)),
  }),
  defineTool({
    name: "scene_diff",
    title: "Diff scenes",
    description:
      "Changes between a scene and exactly one of: another scene, the same file at a git revision, or an op batch applied in memory.",
    annotations: READ,
    input: {
      scene: sceneArg,
      other: z.string().optional().describe("The scene or file to compare with."),
      git: z.string().optional().describe("A git revision of the same file (the old side)."),
      ops: opBatch.optional(),
      ...liveFields,
    },
    run: (i, ctx) =>
      withSource(i, ctx, async (a, c, tmp) =>
        diff(
          {
            a,
            b: i.other,
            git: i.git,
            ops: i.ops === undefined ? undefined : await tmp.payload("ops.json", i.ops),
          },
          c,
        ),
      ),
  }),
  defineTool({
    name: "scene_apply_ops",
    title: "Apply an op batch",
    description:
      "Apply an OpBatch. A dry run unless dryRun is false. With live, edits the dev server's open doc (or a hosted project's, at a site url) as one undoable entry under an agent actor; otherwise rewrites the scene file. Never applies a batch that leaves error-severity issues.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    input: {
      scene: sceneName,
      ops: opBatch,
      dryRun: z.boolean().default(true).describe("Report what would change without writing."),
      base: z.string().optional().describe("Scene hash the batch was planned against."),
      agentId: z
        .string()
        .optional()
        .describe(
          `Live: the agent id the history entry names. Default \`${DEFAULT_MCP_AGENT_ID}\`.`,
        ),
      onBehalfOf: z.string().optional().describe("Live: the user the agent acts for."),
      ...liveFields,
    },
    run: async (i, ctx) => {
      const tmp = scratch();
      try {
        const common = {
          scene: i.scene,
          ops: await tmp.payload("ops.json", i.ops),
          base: i.base,
          dryRun: i.dryRun ?? true,
        };
        if (!i.live) {
          const liveOnly = (["url", "agentId", "onBehalfOf"] as const).find(
            (k) => i[k] !== undefined,
          );
          if (liveOnly) return usage(`${liveOnly} needs live`);
          return await apply(common, ctx);
        }
        const url = liveUrl(i.url, ctx);
        if (isToolResult(url)) return url;
        return await applyLive(
          {
            ...common,
            url,
            agent: i.agentId ?? DEFAULT_MCP_AGENT_ID,
            onBehalfOf: i.onBehalfOf,
          },
          ctx,
        );
      } finally {
        await tmp.close();
      }
    },
  }),
  defineTool({
    name: "scene_playtest",
    title: "Playtest a scene",
    description:
      "Play an input script headless (format v2; a v1 script migrates on read): the outcome, steps, events, focus trail (positions in metres), the commands stepped and the run's `recording` (v2). `steps` drive seat 0; `tracks` (`[{ player, steps }]`, up to the script's `players`) drive one seat each, side by side from tick 0. Steps hold or press actions, `set` axis values and vectors for the step (`{ set: { move: [1, 0] } }`), drive the pointer (`{ pointer: { at, press?, release?, drag? } }`, `at` and `drag` in metres; a drag moves from `at` to `drag` over the step; its buttons show in `ctx.input.pointer` and hold the actions bound to them, the project input map's over the game's, as live play does, except UI-only actions, which a script never raises, holds, presses or sets), `join` a device (`keyboard`, `pointer`, `touch` or `pad:<n>`) to the track's seat or `leave` one, wait, send a game command (`{ command, args? }`) or report time away (`{ elapse }`, as `@elapsed`); an `until` can wait on `{ exists: id }`, `{ count: { type|tag, min|max|eq } }` or `{ near: { id, to: [x, y] | entityId, within } }` (metres; with or without a game). Events include `entity:spawned`, `entity:destroyed`, `entity:enabled`, `entity:disabled`, `contact:start`, `contact:end` and the standard behaviors' `character:jumped`, `character:left-ground`, `character:landed`, `nav:arrived`, `nav:blocked`, `spawner:spawned` and `sensor:enter`, and `lifecycle` counts spawns and destroys per type. A game that lists its commands (`GamePlayDef.commands`) also gets `legal`: the commands it may send after the last tick, at most 64, with `legalTruncated: true` beyond. A scene change the game requests (`ctx.flow.request`) ends the run with result `flow` and the recording's `next`; with `flow` the run follows it through the project's scene list on the same script (an `until` can wait on `{ scene: id }`) and reports each scene it visited in `segments`. With `fromSave` the run starts where a save fixture left off instead of the scene's fresh load, and the recording's `fromSave` names the fixture's slot and hash. exitCode 1 when the scene or script is blocked, a runtime refusal included (stage `run`).",
    annotations: READ,
    input: {
      scene: sceneArg,
      script: jsonOrPath(
        "An input script, v2 or v1 (`scene_schema` with which `script`): `steps` or `tracks`, analog, pointer, join, command and elapse steps included",
      ),
      at: z
        .tuple([z.number(), z.number()])
        .optional()
        .describe("[x, y] in metres: start the player here."),
      events: z
        .array(z.string())
        .optional()
        .describe("Report only events of these types; `lifecycle` still counts every spawn."),
      flow: z
        .boolean()
        .optional()
        .describe("Follow scene requests through the project's scene list on the same script."),
      fromSave: jsonOrPath(
        "A save:v1 fixture to start from (`*.save.json`, as `scene save` writes one)",
      ).optional(),
      game,
      ...liveFields,
    },
    run: (i, ctx) =>
      withSource(i, ctx, async (scene, c, tmp) =>
        playtest(
          {
            scene,
            script: await tmp.payload("script.json", i.script),
            at: opt(i.at, (p) => p.join(",")),
            events: opt(i.events, (t) => t.join(",")),
            game: i.game,
            flow: i.flow === true,
            fromSave:
              i.fromSave === undefined
                ? undefined
                : await tmp.payload("from.save.json", i.fromSave),
          },
          c,
        ),
      ),
  }),
  defineTool({
    name: "scene_replay",
    title: "Replay a run",
    description:
      "Replay a run recording headless: v2 (a `scene_playtest` result's `recording`, or the editor's), or v1, which migrates on read and reports `migratedFrom: 1`. The report carries `matches`, `divergence`, `stale` (what the run runs changed since it was recorded), `warnings` and `issues`, where `recording-other-platform` warns that a Rapier run recorded on another architecture may step differently. exitCode 1 when it ends differently; a stale run or another platform is a warning.",
    annotations: READ,
    input: {
      scene: sceneArg,
      run: jsonOrPath(
        "A run recording, v2 or v1 (`scene_schema` with which `recording`), or a `scene_playtest` result holding one",
      ),
      versions: z
        .string()
        .optional()
        .describe(
          "A directory of scene versions and their texts (as `game_live_build` writes them) for a run that swapped versions while it played; each swap replays at its recorded tick.",
        ),
      game,
      ...liveFields,
    },
    run: (i, ctx) =>
      withSource(i, ctx, async (scene, c, tmp) =>
        replay(
          {
            scene,
            run: await tmp.payload("run.json", i.run),
            game: i.game,
            versions: i.versions,
          },
          c,
        ),
      ),
  }),
  defineTool({
    name: "scene_fuzz",
    title: "Fuzz a scene",
    description:
      "Seeded random rollouts: which entities were reached, in how many runs, how early, and how runs ended.",
    annotations: READ,
    input: {
      scene: sceneArg,
      seed: z.union([z.number().int(), z.string()]).optional().describe("Default 1."),
      rollouts: z.number().int().optional().describe("1 to 10000, default 100."),
      ticks: z.number().int().optional().describe("Ticks per rollout, default 600."),
      game,
      ...liveFields,
    },
    run: (i, ctx) =>
      withSource(i, ctx, (scene, c) =>
        fuzz(
          {
            scene,
            seed: opt(i.seed, String),
            rollouts: opt(i.rollouts, String),
            ticks: opt(i.ticks, String),
            game: i.game,
          },
          c,
        ),
      ),
  }),
  defineTool({
    name: "scene_check",
    title: "Run scene checks",
    description:
      "Run a scene's `<scene>.checks.json` (validation, playtests, fuzz, and `connected`: a path on the scene's grid joins two places). A `reaches` check's `expect` is an `until` clause (`exists`, `count`, `near` and the game's predicates included) that must hold on the run's last tick. exitCode 1 when a check fails.",
    annotations: READ,
    input: {
      scene: sceneArg,
      checks: z
        .string()
        .optional()
        .describe("A checks file path; default the one beside the scene."),
      only: z.string().optional().describe("Run only the check with this id."),
      game,
      ...liveFields,
    },
    run: async (i, ctx) => {
      let checks = i.checks;
      if (i.live && checks === undefined && !isFileArg(i.scene)) {
        const located = await locateScene(ctx, i.scene);
        if (!located.ok) return located.result;
        checks = checksPathOf(located.scene.file);
      }
      return withSource(
        i,
        ctx,
        (scene, c) => check({ scene, checks, only: i.only, game: i.game }, c),
        {
          asFile: true,
        },
      );
    },
  }),
  defineTool({
    name: "scene_render",
    title: "Render a scene",
    description:
      "A schematic PNG of the scene (longest side 1600px), drawn in world px (metres times the game's px per metre) with axis ticks labelled in world px, entity labels and each sprite's box labelled `asset[:frame]`, or with `ascii` a character map whose cells and ruler are world px; `sprites` lists the boxes in metres. Overlay a playtest or validate result.",
    annotations: READ,
    input: {
      scene: sceneArg,
      region: z
        .tuple([z.number(), z.number(), z.number(), z.number()])
        .optional()
        .describe("[x0, y0, x1, y1] in metres."),
      around: z.string().optional().describe("Frame this entity ref."),
      margin: z.number().optional().describe("With around: metres of margin; default 1.28."),
      labels: z.enum(["entities", "all", "none"]).optional().describe("Default `entities`."),
      scale: z.number().optional().describe("Image px per world px."),
      ascii: z.boolean().optional().describe("A character map instead of an image."),
      overlay: jsonOrPath("A `scene_playtest` or `scene_validate` result").optional(),
      ...liveFields,
    },
    run: async (i, ctx) => {
      const result = await withSource(i, ctx, async (scene, c, tmp) =>
        render(
          {
            scene,
            region: opt(i.region, (r) => r.join(",")),
            around: i.around,
            margin: opt(i.margin, String),
            labels: i.labels,
            scale: opt(i.scale, String),
            ascii: i.ascii === true,
            overlay:
              i.overlay === undefined ? undefined : await tmp.payload("overlay.json", i.overlay),
          },
          c,
        ),
      );
      if (result.exitCode !== 0 || i.ascii) return result;
      const { svg, ...data } = result.data as Rendered;
      const { png } = await rasterizeSvg(svg);
      const { scene, width, height, scale, region, tick } = data;
      return {
        exitCode: 0,
        data,
        text: `${scene}: ${width}x${height}px, scale ${Math.round(scale * 1000) / 1000}, region ${region.join(",")} m, ticks every ${tick}px`,
        image: { data: Buffer.from(png).toString("base64"), mimeType: "image/png" },
      };
    },
  }),
  defineTool({
    name: "project_tree",
    title: "Project tree",
    description:
      "A project's folders, assets (kind, id, name) and read-only code modules, as the editor's tree shows them.",
    annotations: READ,
    input: { ...liveFields },
    run: async (i, ctx) => {
      const live = liveRead(i, ctx);
      if (isToolResult(live)) return live;
      return projectTree({ ...live, project: ctx.project }, ctx);
    },
  }),
  defineTool({
    name: "asset_refs",
    title: "Asset references",
    description:
      "What an asset names and what names it, with the dangling references from or to it; without an id, every dangling reference in the project. exitCode 1 when one dangles.",
    annotations: READ,
    input: {
      id: z.string().optional().describe("The asset id; leave out for every dangling reference."),
      ...liveFields,
    },
    run: async (i, ctx) => {
      const live = liveRead(i, ctx);
      if (isToolResult(live)) return live;
      return projectRefs({ ...live, id: i.id, project: ctx.project }, ctx);
    },
  }),
  defineTool({
    name: "asset_import",
    title: "Import an asset",
    description:
      "Add a local file to a project. A binary's bytes go to the content store (with live, the server's) and importAsset names their hash; a JSON doc kind's file becomes createAsset. A dry run unless dryRun is false.",
    annotations: WRITE,
    input: {
      file: z.string().describe("The local file to import."),
      path: z
        .string()
        .optional()
        .describe("Its asset path, or a folder ending in `/`; default the kind's folder."),
      id: z.string().optional().describe("The asset id; default the file stem."),
      kind: z.string().optional().describe("The asset kind; default told from the name or JSON."),
      settings: z
        .union([z.string(), z.record(z.string(), z.unknown())])
        .optional()
        .describe("A binary kind's import settings: an object, or `key=value` pairs."),
      ...writerFields,
    },
    run: async (i, ctx) => {
      const flags = writerFlags(i, ctx);
      if (isToolResult(flags)) return flags;
      return assetsImport(
        {
          ...flags,
          file: i.file,
          path: i.path,
          id: i.id,
          kind: i.kind,
          settings: typeof i.settings === "object" ? JSON.stringify(i.settings) : i.settings,
        },
        ctx,
      );
    },
  }),
  defineTool({
    name: "asset_apply_ops",
    title: "Apply a project op batch",
    description:
      'Apply a project op batch (`scene_schema` with which `project-ops`), which may span docs. A dry run unless dryRun is false. With live, edits the dev server\'s docs (or a hosted project\'s) as one undoable entry under an agent actor; otherwise writes the files. A batch the engine refuses writes nothing. The input map is a doc like any other: `{ op: "editAsset", id, edits: [{ insert: "/actions/@fire/bindings", value: { device: "key", code: "KeyF" } }] }` appends a binding to `fire` (the insert names the list; `before` an index places it), and a binding the game can\'t read (an unknown code, button, axis or control, or a shape that doesn\'t fit the action\'s kind) is refused as `binding-unknown`, a seat past the map\'s as `player-unknown`. The scene list is one too: `{ op: "editAsset", id: "scene-list", edits: [{ insert: "/scenes", value: { scene: "level-2", title: "Level 2" } }, { set: "/start", value: "level-2" }] }` lists a scene and starts there (`remove: "/scenes/@level-2"` unlists it); a start that isn\'t listed, or is a sublevel, is refused as `start-scene-missing`, a scene listed twice as `id-taken`, and an entry naming no scene is a dangling reference `asset_refs` reports (`asset-missing`).',
    annotations: { ...WRITE, destructiveHint: true },
    input: {
      ops: z
        .union([z.string(), z.looseObject({ ops: z.array(z.looseObject({ op: z.string() })) })])
        .describe("A project op batch, or a path to one."),
      base: z
        .string()
        .optional()
        .describe("Files only: the `project snapshot` hash the batch was planned against."),
      ...writerFields,
    },
    run: async (i, ctx) => {
      const flags = writerFlags(i, ctx);
      if (isToolResult(flags)) return flags;
      const tmp = scratch();
      try {
        const ops = await tmp.payload("project-ops.json", i.ops);
        return await assetsApply({ ...flags, base: i.base, ops }, ctx);
      } finally {
        await tmp.close();
      }
    },
  }),
  defineTool({
    name: "game_new",
    title: "Scaffold a game",
    description:
      "Write a new game project under `dir` (default src/games) from a preset: `top-down` (a hero of standard behaviors, `collider`, `character-top-down`, `player-input` and `camera-target`, walked by `move`; physics none, gravity [0, 0]), `side-view` (the same with `character-side-view`, run by `move` and jumping on `jump`; Rapier, gravity [0, 20]), `grid` (a grid stepper, event-stepped) or `turns` (one `step { dir }` command, its legal list from `GamePlayDef.commands`); every world and time field written (the behavior presets on a fixed 60 Hz clock), scenes in metres. The behavior presets' input scripts wait on `until.near` and their reaches check expects the hero near the goal. It writes the project file, the game and UI modules (a framework-free HUD), `scenes/main.json` with its checks and an input script that wins, game-settings and input-map docs, the generated schemas and a test. Refused, writing nothing, for an id outside the id pattern (`schema`), an id a project holds or a directory that exists (`project-id-taken`), or a scene with error issues. A dry run unless dryRun is false; either way the result lists every file, the issues, the URLs that open it on the dev site and the playtest command.",
    annotations: WRITE,
    input: {
      id: z.string().describe("The project's id, also its game's id and its directory's name."),
      name: z.string().optional().describe("The project's display name; default from the id."),
      preset: z
        .enum(GAME_PRESETS)
        .optional()
        .describe("What the game starts as; default `top-down`."),
      physics: z
        .enum(["none", "rapier"])
        .optional()
        .describe("Over the preset's: `rapier` for `side-view`, else `none`."),
      gravity: z
        .tuple([z.number(), z.number()])
        .optional()
        .describe(
          "[x, y] in m/s², y down; over the preset's: [0, 20] for `side-view`, else [0, 0].",
        ),
      time: z
        .enum(["fixed", "turns", "event"])
        .optional()
        .describe("The clock, over the preset's; `turns` only with the `turns` preset."),
      rate: z.number().optional().describe("Ticks per second, 1 to 240; over the preset's 60."),
      grid: z
        .enum(["square", "hex", "none"])
        .optional()
        .describe(
          "The world grid; `grid` and `turns` step on a square one, `top-down` and `side-view` have none.",
        ),
      cell: z.number().optional().describe("The grid cell's size in metres; default 1."),
      pxPerMetre: z
        .number()
        .optional()
        .describe(
          "px per metre (`world.lengthUnit`); over the preset's 100 (top-down, side-view) or 32.",
        ),
      dir: z.string().optional().describe("The directory the project goes in; default src/games."),
      dryRun: z.boolean().default(true).describe("List the files without writing them."),
    },
    run: (i, ctx) =>
      gameNew(
        {
          id: i.id,
          name: i.name,
          preset: i.preset,
          physics: i.physics,
          gravity: opt(i.gravity, (g) => g.join(",")),
          time: i.time,
          rate: opt(i.rate, String),
          grid: i.grid,
          cell: opt(i.cell, String),
          pxPerMetre: opt(i.pxPerMetre, String),
          dir: i.dir,
          dryRun: i.dryRun,
        },
        ctx,
      ),
  }),
  defineTool({
    name: "game_build",
    title: "Build a game",
    description:
      "Build a project into a static bundle (`game build`): the listed scenes and their assets, the code, `release.json`, credits and, for the web target, the PWA files, written under `out` (default dist/games/<id>/<target>), replacing what was there. Returns the plan's summary (the scenes and their physics, bytes per role, the wasm line, the size budgets, credits gaps), the issues and the output directory, never a file's contents. Two builds of one project are byte-identical. A target with no row is `export-target-unsupported`; `export-over-budget` writes the build with exitCode 1 unless `allowOverBudget`. exitCode 1 on an error-severity issue. Check the result with `game_manifest` on `out`.",
    annotations: BUILD,
    input: {
      id: z.string().describe("The project's id, as `scene_list` shows it."),
      target: z
        .string()
        .optional()
        .describe(
          `A release target: one of ${exportTargetNames().join(", ")}. Default \`${DEFAULT_BUILD_TARGET}\`.`,
        ),
      out: z
        .string()
        .optional()
        .describe("The output directory; default dist/games/<id>/<target>."),
      rapier: z
        .enum(["standard", "compat"])
        .optional()
        .describe(
          "The Rapier build a Rapier scene ships: its own wasm file, or -compat's inlined one.",
        ),
      allowOverBudget: z
        .boolean()
        .optional()
        .describe("Exit 0 on `export-over-budget`; the build is written either way."),
    },
    run: async (i, ctx) =>
      buildReport(
        await gameBuild(
          {
            id: i.id,
            target: i.target,
            out: i.out,
            rapier: i.rapier,
            allowOverBudget: i.allowOverBudget === true,
          },
          ctx,
        ),
      ),
  }),
  defineTool({
    name: "game_manifest",
    title: "Check a release manifest",
    description: `Parse and check a release manifest (\`game manifest\`, schema \`release:v1\`): given a build directory, against its files and their hashes; given a \`${RELEASE_FILE}\` or an inline manifest, on its own. Returns the validated manifest, its summary (the release id, engine, target, scenes, the wasm line, files and budget) and the issues. exitCode 1 on an error-severity issue.`,
    annotations: READ,
    input: {
      path: z
        .union([z.string(), z.record(z.string(), z.unknown())])
        .describe(`A build directory or a \`${RELEASE_FILE}\`, or an inline manifest.`),
    },
    run: async (i, ctx) => {
      const tmp = scratch();
      try {
        const path = await tmp.payload(RELEASE_FILE, i.path);
        const result = await gameManifest({ path }, ctx);
        if (typeof i.path === "string") return buildReport(result);
        const unscratched = (text: string) => text.replaceAll(path, "-");
        if (typeof result.data === "object" && result.data !== null)
          for (const [k, v] of Object.entries(result.data))
            if (typeof v === "string") (result.data as Record<string, unknown>)[k] = unscratched(v);
        return buildReport({ ...result, text: unscratched(result.text) });
      } finally {
        await tmp.close();
      }
    },
  }),
  defineTool({
    name: "game_release_create",
    title: "Release a game",
    description: `Build a project (\`game release create\`; or take \`from\`'s build) and upload it to its hosted project on the site (${AGENT_SITE_ENV}, with ${AGENT_TOKEN_ENV}) as a new release: begin, the files the site doesn't hold yet, commit. It lands on preview unless \`channel\` is \`none\`; production moves only by a person on the game's page. Returns the release's summary (version, id, size, files, new bytes, the play URL, the quota lines with a warning for any at or over 80%, the next removal, the game page), never a file's contents. Uploading the same build again is the same release. Refusals carry the site's code, message and hint.`,
    annotations: RELEASE_CREATE,
    input: {
      id: releaseProject,
      hosted: z
        .boolean()
        .optional()
        .describe(
          "Build what the hosted project holds (pulled into a temporary copy) instead of the working tree.",
        ),
      target: z
        .string()
        .optional()
        .describe(
          `A release target: one of ${exportTargetNames().join(", ")}. Default \`${DEFAULT_BUILD_TARGET}\`.`,
        ),
      channel: z
        .string()
        .optional()
        .describe(
          "`preview` (default) or `none`. Production moves only by a person on the game's page.",
        ),
      from: z
        .string()
        .optional()
        .describe("A build directory `game_build` wrote, uploaded instead of building."),
      allowOverBudget: z
        .boolean()
        .optional()
        .describe("Release a build over its size budgets (`export-over-budget`)."),
    },
    run: async (i, ctx) =>
      releaseEnv(ctx) ??
      buildReport(
        await gameReleaseCreate(
          {
            project: i.id,
            hosted: i.hosted === true,
            target: i.target,
            channel: i.channel,
            from: i.from,
            allowOverBudget: i.allowOverBudget === true,
          },
          ctx,
        ),
      ),
  }),
  defineTool({
    name: "game_release_list",
    title: "List releases",
    description:
      "A hosted project's releases (`game release list`), newest first: version, id, size, files, engine, target, the channels and jams that pin it, its audience, the play URL and when the cleanup removes it.",
    annotations: RELEASE_READ,
    input: { id: releaseProject },
    run: async (i, ctx) =>
      releaseEnv(ctx) ?? buildReport(await gameReleaseList({ project: i.id }, ctx)),
  }),
  defineTool({
    name: "game_release_promote",
    title: "Promote a release",
    description:
      "Point a hosted project's preview channel at a kept version (`game release promote`). Production is refused (`release-forbidden`) with the game page's URL, where a person moves it.",
    annotations: RELEASE_MOVE,
    input: {
      id: releaseProject,
      version: z.number().int().positive().describe("The version to point the channel at."),
      channel: releaseChannel,
    },
    run: async (i, ctx) =>
      releaseEnv(ctx) ??
      buildReport(
        await gameReleasePromote(
          { project: i.id, version: String(i.version), channel: i.channel },
          ctx,
        ),
      ),
  }),
  defineTool({
    name: "game_release_rollback",
    title: "Roll back a release",
    description:
      "Point a hosted project's preview channel back at the release it named before (`game release rollback`). Production is refused (`release-forbidden`) with the game page's URL, where a person moves it.",
    annotations: RELEASE_MOVE,
    input: { id: releaseProject, channel: releaseChannel },
    run: async (i, ctx) =>
      releaseEnv(ctx) ??
      buildReport(await gameReleaseRollback({ project: i.id, channel: i.channel }, ctx)),
  }),
  defineTool({
    name: "game_live_build",
    title: "Build a scene version",
    description:
      "Build one scene's version (`game live build`) from the project's files, or with `hosted` from a temporary pull of the hosted project, into `out`: `scene-version.json` and a `<sha256>.json` for each text it carries. Returns the same fields as `--json`: the version's id, its data size and the files written. The same content always gives the same id, the editor's included. exitCode 1 on an error-severity issue.",
    annotations: LIVE_BUILD,
    input: {
      id: releaseProject,
      scene: sceneName,
      hosted: z
        .boolean()
        .optional()
        .describe(
          `Build what the hosted project holds, with ${AGENT_TOKEN_ENV} and ${AGENT_SITE_ENV} from the server's environment.`,
        ),
      out: z.string().optional().describe("The output directory."),
    },
    run: async (i, ctx) =>
      (i.hosted === true ? siteEnv(ctx, "hosted builds", "an agent token") : null) ??
      (await gameLiveBuild(
        { project: i.id, scene: i.scene, hosted: i.hosted === true, out: i.out },
        ctx,
      )),
  }),
  defineTool({
    name: "game_live_publish",
    title: "Publish a scene version",
    description: `Build one scene's version (\`game live publish\`; as \`game_live_build\` does, or with \`hosted\` from a temporary pull of the hosted project) and publish it to its hosted project on the site (${AGENT_SITE_ENV}, with ${AGENT_TOKEN_ENV}): the swap check first for \`boundary\` and \`now\` unless \`swapCheck\` is false, then begin, the texts the site doesn't hold yet, commit. It lands on preview unless \`channel\` is \`none\`; production moves only by a person on the game's page. Returns the version's summary (scene@number, id, data size, new files, the release it fits, the timing, the changes and whether players' worlds update in place or are rebuilt, today's versions and release storage with a warning for any quota at or over 80% and for a clamped timing, the game page), never a text's contents. Publishing the same content again is the same version. Refusals carry the site's code, message and hint.`,
    annotations: RELEASE_CREATE,
    input: {
      id: releaseProject,
      scene: sceneName,
      hosted: z
        .boolean()
        .optional()
        .describe(
          "Build what the hosted project holds (pulled into a temporary copy) instead of the working tree.",
        ),
      channel: z
        .string()
        .optional()
        .describe(
          "`preview` (default) or `none`. Production moves only by a person on the game's page.",
        ),
      timing: liveTiming,
      note: z
        .string()
        .optional()
        .describe(`What changed, for your team (up to ${LIVE_LIMITS.noteChars} characters).`),
      swapCheck: z
        .boolean()
        .optional()
        .describe(
          "false skips the swap check that runs before `boundary` and `now` (`--no-swap-check`).",
        ),
    },
    run: async (i, ctx) =>
      releaseEnv(ctx) ??
      buildReport(
        await gameLivePublish(
          {
            project: i.id,
            scene: i.scene,
            hosted: i.hosted === true,
            channel: i.channel,
            timing: i.timing,
            note: i.note,
            noSwapCheck: i.swapCheck === false,
          },
          ctx,
        ),
      ),
  }),
  defineTool({
    name: "game_live_list",
    title: "List scene versions",
    description:
      "A hosted project's live scene versions (`game live list`), or one scene's, newest first: scene@number, id, data size, when and by whom, its note, the channels that point at it and their timing, whether it is blocked or hidden, and when the cleanup removes it.",
    annotations: RELEASE_READ,
    input: {
      id: releaseProject,
      scene: z.string().optional().describe("Only this scene's versions."),
    },
    run: async (i, ctx) =>
      releaseEnv(ctx) ?? buildReport(await gameLiveList({ project: i.id, scene: i.scene }, ctx)),
  }),
  defineTool({
    name: "game_live_promote",
    title: "Promote a scene version",
    description:
      "Point a hosted project's preview channel at one of a scene's kept versions (`game live promote`), with its timing. The version must fit the channel's release and not be blocked or hidden. Production is refused with the game page's URL, where a person moves it.",
    annotations: RELEASE_MOVE,
    input: {
      id: releaseProject,
      scene: sceneName,
      version: z
        .number()
        .int()
        .positive()
        .describe("The scene's version number, the 4 of `level-1@4`."),
      channel: releaseChannel,
      timing: liveTiming,
    },
    run: async (i, ctx) =>
      releaseEnv(ctx) ??
      buildReport(
        await gameLivePromote(
          {
            project: i.id,
            scene: i.scene,
            number: String(i.version),
            channel: i.channel,
            timing: i.timing,
          },
          ctx,
        ),
      ),
  }),
  defineTool({
    name: "game_live_rollback",
    title: "Roll back a scene version",
    description:
      "Point a hosted project's preview channel back at the scene version it named before, or at the release's own scene (`game live rollback`). Production is refused with the game page's URL, where a person moves it.",
    annotations: RELEASE_MOVE,
    input: { id: releaseProject, scene: sceneName, channel: releaseChannel },
    run: async (i, ctx) =>
      releaseEnv(ctx) ??
      buildReport(
        await gameLiveRollback({ project: i.id, scene: i.scene, channel: i.channel }, ctx),
      ),
  }),
  defineTool({
    name: "game_live_clear",
    title: "Stop a scene version",
    description:
      "Stop a scene's live version on a hosted project's preview channel (`game live clear`): players get the release's own scene at their next load. The version is kept. Production is refused with the game page's URL, where a person moves it.",
    annotations: LIVE_CLEAR,
    input: { id: releaseProject, scene: sceneName, channel: releaseChannel },
    run: async (i, ctx) =>
      releaseEnv(ctx) ??
      buildReport(await gameLiveClear({ project: i.id, scene: i.scene, channel: i.channel }, ctx)),
  }),
  defineTool({
    name: "game_live_check",
    title: "Check a scene version",
    description:
      "Check one scene's version (`game live check`) before players get it: with `against` (a release's build directory or `release.json`), whether that release can load it (a changed shared asset is refused), swapping it into the release's own scene; with `from` (a built version's directory), swapping it into that version. The swap check plays the scene's input scripts, swaps at fixed points of each run and reports per run its tick, strategy and issues (`live-swap-failed` when `onSwap` throws, and the game's live checks). With neither, it only validates and warns which flag to pass. Returns the same fields as `--json`. exitCode 1 on an error-severity issue.",
    annotations: READ,
    input: {
      id: releaseProject,
      scene: sceneName,
      against: z
        .string()
        .optional()
        .describe("A release to check against: its build directory or its `release.json`."),
      from: z
        .string()
        .optional()
        .describe("The version players have now: a directory `game_live_build` wrote."),
    },
    run: (i, ctx) =>
      gameLiveCheck({ project: i.id, scene: i.scene, against: i.against, from: i.from }, ctx),
  }),
];

/** The MCP tool names, sorted. A contract: renaming or removing one is breaking. */
export const MCP_TOOL_NAMES: readonly string[] = MCP_TOOLS.map((t) => t.name).sort();

/**
 * A tool's output as an MCP result: compact JSON of `data` in a text block
 * (a PNG and a short line for an image) plus `structuredContent` with the
 * exit code. `isError` marks calls that did nothing useful (usage, a stale
 * base, a missing scene or server); a scene with error issues is a normal
 * result with exitCode 1.
 */
export function toMcpResult(out: McpToolOutput): McpCallResult {
  const data =
    typeof out.data === "object" && out.data !== null && !Array.isArray(out.data)
      ? (out.data as Record<string, unknown>)
      : { value: out.data };
  const failed = out.exitCode >= 2 || typeof data.error === "string";
  return {
    content: out.image
      ? [
          { type: "image", ...out.image },
          { type: "text", text: out.text },
        ]
      : [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: { ...data, exitCode: out.exitCode },
    isError: failed,
  };
}

/**
 * Runs one tool with already-validated input, catching what it throws. A
 * `project` in the input scopes the call as `--project` does.
 */
export async function runMcpTool(
  tool: McpTool,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<McpCallResult> {
  const scoped = typeof input.project === "string" ? { ...ctx, project: input.project } : ctx;
  let out: McpToolOutput;
  try {
    out = scopeError(scoped) ?? (await tool.run(input as never, scoped));
  } catch (e) {
    out = failure(e instanceof Error ? e.message : String(e));
  }
  return toMcpResult(out);
}
