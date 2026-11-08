import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checksPathOf } from "@jams/engine/scene";
import { z } from "zod";

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
import { fuzz } from "./tools/fuzz";
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
  .describe("An OpBatch; `scene_schema` with which `ops` gives its full schema.");
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

// ─── Tools ───────────────────────────────────────────────

export const MCP_TOOLS: readonly McpTool[] = [
  defineTool({
    name: "scene_list",
    title: "List scenes",
    description: "Every scene with its game, hash, issue counts, entity counts and bounds.",
    annotations: READ,
    input: {},
    run: (_i, ctx) => list({}, ctx),
  }),
  defineTool({
    name: "scene_show",
    title: "Show a scene",
    description:
      "A scene's entities and bulk entries with refs, derived AABB and top span, and the scene hash. Filter by ref, type or a circle.",
    annotations: READ,
    input: {
      scene: sceneArg,
      ref: z.string().optional().describe("Only this entity id or `~` bulk ref."),
      type: z.string().optional().describe("Only entities of this type."),
      near: z
        .tuple([z.number(), z.number(), z.number()])
        .optional()
        .describe("[x, y, r]: only entities within r px of (x, y)."),
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
      "The JSON Schema of a scene, an op batch, an input script, a checks file, a run recording, a scene fragment (clipboard JSON), a prefab file, the project file, a sidecar, a project op batch, a project snapshot or any doc kind: a game's with `game` (or `project`), the engine's without.",
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
      "Play an input script headless: the outcome, steps, events and focus trail. exitCode 1 when the scene or script is blocked.",
    annotations: READ,
    input: {
      scene: sceneArg,
      script: jsonOrPath("An input script (`scene_schema` with which `script`)"),
      at: z.tuple([z.number(), z.number()]).optional().describe("[x, y]: start the player here."),
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
            game: i.game,
          },
          c,
        ),
      ),
  }),
  defineTool({
    name: "scene_replay",
    title: "Replay a run",
    description:
      "Replay a run recording (a `scene_playtest` result's `recording`, or the editor's) headless. exitCode 1 when it ends differently; a changed scene is a warning.",
    annotations: READ,
    input: {
      scene: sceneArg,
      run: jsonOrPath("A run recording (`scene_schema` with which `recording`)"),
      game,
      ...liveFields,
    },
    run: (i, ctx) =>
      withSource(i, ctx, async (scene, c, tmp) =>
        replay({ scene, run: await tmp.payload("run.json", i.run), game: i.game }, c),
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
      "Run a scene's `<scene>.checks.json` (playtests, fuzz, validation). exitCode 1 when a check fails.",
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
      "A schematic PNG of the scene (longest side 1600px) with axis ticks and entity labels, or with `ascii` a character map. Overlay a playtest or validate result.",
    annotations: READ,
    input: {
      scene: sceneArg,
      region: z
        .tuple([z.number(), z.number(), z.number(), z.number()])
        .optional()
        .describe("[x0, y0, x1, y1] in world px."),
      around: z.string().optional().describe("Frame this entity ref."),
      margin: z.number().optional().describe("With around: px of margin."),
      labels: z.enum(["entities", "all", "none"]).optional().describe("Default `entities`."),
      scale: z.number().optional().describe("Pixels per world px."),
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
        text: `${scene}: ${width}x${height}px, scale ${Math.round(scale * 1000) / 1000}, region ${region.join(",")}, ticks every ${tick}px`,
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
      "Apply a project op batch (`scene_schema` with which `project-ops`), which may span docs. A dry run unless dryRun is false. With live, edits the dev server's docs (or a hosted project's) as one undoable entry under an agent actor; otherwise writes the files. A batch the engine refuses writes nothing.",
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
