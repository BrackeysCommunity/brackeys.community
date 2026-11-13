// @vitest-environment node
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { docToScene, readLog, readProject, readProjectLog } from "@jams/engine/collab";
import { createRegistry, defineGame, formatSaveFile } from "@jams/engine/game";
import { createHeadlessRuntime } from "@jams/engine/headless";
import { docNameOf } from "@jams/engine/project";
import { expandScene, SCENE_FORMAT_VERSION } from "@jams/engine/scene";
import { listenSceneCollab, readFileProject, type ListeningSceneCollab } from "@jams/engine/vite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";
import { z } from "zod";

import { platformerGame } from "../../../src/games/platformer";
import {
  plannedRelease,
  type PlannedRelease,
} from "../../../src/lib/engine/__tests__/release-fixture";
import type { ToolContext } from "../context";
import { REPO_ROOT } from "../default-context";
import { AGENT_SITE_ENV, AGENT_TOKEN_ENV } from "../hosted";
import { createSceneMcpServer, MCP_SERVER_NAME } from "../mcp";
import {
  DEFAULT_MCP_AGENT_ID,
  MCP_TOOL_NAMES,
  MCP_TOOLS,
  runMcpTool,
  toMcpResult,
  withoutFileBytes,
} from "../mcp-tools";
import { discoverProjects } from "../projects";
import { loadCompatRapier } from "../rapier-compat";
import { flow as flowTool } from "../tools/flow";
import { tempProject } from "./fixtures";

const repoFile = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const ENGINE_YARD = repoFile("packages/engine/scenes/engine-yard.json");
const ENGINE_YARD_CHECKS = repoFile("packages/engine/scenes/engine-yard.checks.json");
const TEST_YARD = repoFile("src/games/platformer/scenes/test-yard.json");
const HOP_LEFT = repoFile("scripts/scene/examples/hop-left.json");
const DOT = repoFile("scripts/scene/examples/dot.png");
const SPRITES = repoFile("packages/engine/scene/__tests__/fixtures/sprites.json");
const V1_RECORDINGS = "packages/engine/headless/__tests__/fixtures/recordings/v1";
const V1_ENGINE_YARD = repoFile(`${V1_RECORDINGS}/scenes/engine-yard.json`);
const V1_SETTLES = repoFile(`${V1_RECORDINGS}/engine-yard.settles.recording.json`);

type Called = {
  content: { type: string; text?: string; data?: string; mimeType?: string }[];
  structuredContent: Record<string, unknown> & { exitCode: number };
  isError?: boolean;
};

let root: string;
let dirs: { engine: string; platformer: string };
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}): Promise<Called> {
  return (await client.callTool({ name, arguments: args })) as Called;
}

const SLOW_LIFT = { ops: [{ op: "update", ref: "lift", set: { "path.speed": 0.3 } }] };

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-mcp-"));
  dirs = { engine: join(root, "engine"), platformer: join(root, "platformer") };
  await mkdir(dirs.engine);
  await mkdir(dirs.platformer);
  await copyFile(ENGINE_YARD, join(dirs.engine, "engine-yard.json"));
  await copyFile(ENGINE_YARD_CHECKS, join(dirs.engine, "engine-yard.checks.json"));
  await copyFile(TEST_YARD, join(dirs.platformer, "test-yard.json"));
  const ctx: ToolContext = {
    projects: [
      await tempProject(dirs.engine, { id: "engine" }),
      await tempProject(dirs.platformer, { game: platformerGame }),
    ],
    loadRapier: loadCompatRapier,
  };
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createSceneMcpServer(ctx).connect(serverSide);
  client = new Client({ name: "scene-mcp-test", version: "0" });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
  await rm(root, { recursive: true, force: true });
});

describe("scene MCP server", () => {
  it("lists every tool with its annotations", async () => {
    expect(client.getServerVersion()?.name).toBe(MCP_SERVER_NAME);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES]);
    expect(MCP_TOOL_NAMES).toEqual([
      "asset_apply_ops",
      "asset_import",
      "asset_refs",
      "game_build",
      "game_manifest",
      "game_new",
      "game_release_create",
      "game_release_list",
      "game_release_promote",
      "game_release_rollback",
      "project_tree",
      "scene_apply_ops",
      "scene_check",
      "scene_codes",
      "scene_diff",
      "scene_flow",
      "scene_fuzz",
      "scene_list",
      "scene_playtest",
      "scene_render",
      "scene_replay",
      "scene_schema",
      "scene_show",
      "scene_validate",
    ]);
    const writers: Record<string, boolean> = {
      scene_apply_ops: false,
      asset_import: false,
      asset_apply_ops: true,
      game_new: false,
    };
    const releases: Record<string, { readOnlyHint: boolean; idempotentHint?: boolean }> = {
      game_release_create: { readOnlyHint: false, idempotentHint: true },
      game_release_list: { readOnlyHint: true },
      game_release_promote: { readOnlyHint: false, idempotentHint: false },
      game_release_rollback: { readOnlyHint: false, idempotentHint: false },
    };
    for (const t of tools) {
      expect(t.inputSchema.properties, t.name).toHaveProperty("project");
      if (t.name in releases) {
        expect(t.annotations, t.name).toMatchObject({ ...releases[t.name], openWorldHint: true });
        for (const arg of ["token", "url", "site", "dryRun"])
          expect(t.inputSchema.properties, t.name).not.toHaveProperty(arg);
      } else if (t.name === "game_build") {
        expect(t.annotations).toMatchObject({
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        });
        expect(t.inputSchema.properties).not.toHaveProperty("dryRun");
      } else if (t.name in writers) {
        expect(t.annotations, t.name).toMatchObject({
          readOnlyHint: false,
          destructiveHint: writers[t.name],
          idempotentHint: false,
          openWorldHint: false,
        });
        expect(t.inputSchema.properties?.dryRun, t.name).toMatchObject({ default: true });
      } else {
        expect(t.annotations, t.name).toMatchObject({ readOnlyHint: true, openWorldHint: false });
      }
    }
  });

  it("describes every length an agent passes or reads in metres", async () => {
    const { tools } = await client.listTools();
    const tool = (name: string) => tools.find((t) => t.name === name)!;
    const field = (name: string, key: string) =>
      (tool(name).inputSchema.properties as Record<string, { description?: string }>)[key]
        ?.description;
    expect(field("scene_render", "region")).toBe("[x0, y0, x1, y1] in metres.");
    expect(field("scene_render", "margin")).toMatch(/^With around: metres of margin/);
    expect(field("scene_show", "near")).toMatch(/in metres/);
    expect(field("scene_playtest", "at")).toMatch(/in metres/);
    expect(field("scene_apply_ops", "ops")).toContain(
      `format v${SCENE_FORMAT_VERSION}, lengths in metres`,
    );
    expect(tool("scene_show").description).toContain("Every length is metres");
    expect(tool("scene_list").description).toContain("bounds (metres)");
    const all = JSON.stringify(tools);
    expect(all).not.toMatch(/in world px\.|px of margin|within r px|Pixels per world px/);
  });

  it("lists, shows, and prints schemas and codes", async () => {
    const listed = await call("scene_list");
    expect(listed.isError).toBe(false);
    const names = (listed.structuredContent.scenes as { name: string }[]).map((s) => s.name);
    expect(names).toEqual(["engine-yard", "test-yard"]);
    expect(JSON.parse(listed.content[0]!.text!)).toEqual(
      expect.objectContaining({ scenes: listed.structuredContent.scenes }),
    );

    const shown = await call("scene_show", { scene: "engine-yard", near: [12, 9.4, 0.3] });
    expect(shown.structuredContent).toMatchObject({ exitCode: 0, scene: "engine-yard" });
    expect((shown.structuredContent.entities as { ref: string }[]).map((e) => e.ref)).toContain(
      "crate",
    );

    const ops = await call("scene_schema", { which: "ops", game: "platformer" });
    expect(ops.structuredContent.$id).toMatch(/^urn:jams-engine:ops:platformer:/);
    const issueCodes = await call("scene_codes");
    expect(issueCodes.structuredContent.exitCode).toBe(0);
    expect(JSON.stringify(issueCodes.structuredContent)).toContain("unknown-game");
  });

  it("validates, flagging a scene with errors without marking the call failed", async () => {
    const ok = await call("scene_validate", { scene: "engine-yard", physical: true });
    expect(ok.structuredContent).toMatchObject({ exitCode: 0, physical: true });
    const bad = join(root, "bad.json");
    const def = JSON.parse(await readFile(ENGINE_YARD, "utf8"));
    await writeFile(bad, JSON.stringify({ ...def, game: "nope" }));
    const r = await call("scene_validate", { scene: bad });
    expect(r.isError).toBe(false);
    expect(r.structuredContent.exitCode).toBe(1);
    const missing = await call("scene_show", { scene: "nope" });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent.exitCode).toBe(1);
  });

  it("diffs an inline batch and dry-runs scene_apply_ops by default", async () => {
    const before = await readFile(join(dirs.engine, "engine-yard.json"), "utf8");
    const d = await call("scene_diff", { scene: "engine-yard", ops: SLOW_LIFT });
    expect(d.structuredContent).toMatchObject({ exitCode: 0, changed: true });

    const dry = await call("scene_apply_ops", { scene: "engine-yard", ops: SLOW_LIFT });
    expect(dry.structuredContent).toMatchObject({ exitCode: 0, dryRun: true, written: false });
    expect(await readFile(join(dirs.engine, "engine-yard.json"), "utf8")).toBe(before);

    const refused = await call("scene_apply_ops", {
      scene: "engine-yard",
      ops: SLOW_LIFT,
      agentId: "claude",
    });
    expect(refused).toMatchObject({ isError: true, structuredContent: { exitCode: 2 } });

    const wrote = await call("scene_apply_ops", {
      scene: "engine-yard",
      ops: SLOW_LIFT,
      dryRun: false,
    });
    expect(wrote.structuredContent).toMatchObject({ dryRun: false, written: true });
    const lift = JSON.parse(
      await readFile(join(dirs.engine, "engine-yard.json"), "utf8"),
    ).entities.find((e: { id: string }) => e.id === "lift");
    expect(lift.path.speed).toBe(0.3);
  });

  it("playtests, fuzzes and runs checks", { timeout: 20_000 }, async () => {
    const script = JSON.parse(await readFile(HOP_LEFT, "utf8"));
    const played = await call("scene_playtest", { scene: "test-yard", script });
    expect(played.structuredContent).toMatchObject({
      exitCode: 0,
      outcome: { result: "script-end" },
    });
    const byPath = await call("scene_playtest", { scene: "test-yard", script: HOP_LEFT });
    expect(byPath.structuredContent.sceneHash).toBe(played.structuredContent.sceneHash);

    const fuzzed = await call("scene_fuzz", { scene: "test-yard", rollouts: 2, ticks: 60 });
    expect(fuzzed.structuredContent).toMatchObject({ exitCode: 0, rollouts: 2, seed: 1 });

    const checked = await call("scene_check", { scene: "engine-yard" });
    expect(checked.structuredContent).toMatchObject({ exitCode: 0, ok: true });
    expect((checked.structuredContent.results as unknown[]).length).toBe(3);
  });

  it("renders a PNG image block, or an ASCII map", async () => {
    const r = await call("scene_render", { scene: "engine-yard", around: "crate", margin: 200 });
    expect(r.isError).toBe(false);
    const [image, text] = r.content;
    expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(Buffer.from(image!.data!, "base64").subarray(1, 4).toString()).toBe("PNG");
    expect(text!.text).toMatch(/^engine-yard: \d+x\d+px/);
    expect(r.structuredContent).not.toHaveProperty("svg");

    const ascii = await call("scene_render", { scene: "engine-yard", ascii: true });
    expect(ascii.content[0]!.type).toBe("text");
    expect(Array.isArray(ascii.structuredContent.lines)).toBe(true);
  });

  it("carries sprite boxes in scene_render and scene_show", async () => {
    const file = join(dirs.engine, "sprites.json");
    await copyFile(SPRITES, file);
    try {
      await spriteBoxes();
    } finally {
      await rm(file);
    }
  });

  async function spriteBoxes() {
    const r = await call("scene_render", { scene: "sprites" });
    expect(r.isError).toBe(false);
    expect(r.structuredContent.sprites).toContainEqual({
      ref: "hero",
      type: "prop",
      label: "hero-sheet:idle-0",
      box: { minX: 0.8, minY: 2.4, maxX: 1.12, maxY: 2.72 },
    });
    const shown = await call("scene_show", { scene: "sprites", ref: "lamp" });
    expect(shown.structuredContent.entities).toMatchObject([
      {
        ref: "lamp",
        sprite: { label: "lamp", aabb: { minX: 3.08, minY: 2.24, maxX: 3.32, maxY: 2.88 } },
      },
    ]);
  }

  it("scopes any tool to a project, refusing one that doesn't exist", async () => {
    const listed = await call("scene_list", { project: "platformer" });
    expect((listed.structuredContent.scenes as { name: string }[]).map((s) => s.name)).toEqual([
      "test-yard",
    ]);
    const elsewhere = await call("scene_show", { scene: "engine-yard", project: "platformer" });
    expect(elsewhere.isError).toBe(true);
    const nope = await call("scene_codes", { project: "nope" });
    expect(nope).toMatchObject({ isError: true, structuredContent: { exitCode: 2 } });
    const ops = await call("scene_schema", { which: "project-ops" });
    expect(ops.structuredContent.$id).toMatch(/^urn:jams-engine:project-ops:/);
  });

  it(
    "game_new lists a dry run, writes the game when asked, and refuses a taken id",
    { timeout: 60_000 },
    async () => {
      const dir = join(root, "games");
      const planned = await call("game_new", { id: "hopper", preset: "grid", dir });
      expect(planned.isError).toBe(false);
      const files = planned.structuredContent.files as string[];
      expect(files).toContain(join(dir, "hopper", "scenes", "main.json"));
      expect(planned.structuredContent).toMatchObject({ exitCode: 0, written: false, issues: [] });
      await expect(readFile(join(dir, "hopper", "index.ts"), "utf8")).rejects.toThrow();

      const made = await call("game_new", { id: "hopper", preset: "grid", dir, dryRun: false });
      expect(made.structuredContent).toMatchObject({ exitCode: 0, written: true });
      expect(made.structuredContent.urls).toEqual({
        play: "/game/dev?game=hopper",
        edit: "/game/dev?edit=1&project=hopper",
      });
      for (const f of files) await expect(readFile(f, "utf8")).resolves.toBeTypeOf("string");

      const again = await call("game_new", { id: "hopper", preset: "grid", dir });
      expect(again.structuredContent.exitCode).toBe(1);
      expect((again.structuredContent.issues as { code: string }[]).map((i) => i.code)).toEqual([
        "project-id-taken",
      ]);
      const taken = await call("game_new", { id: "platformer", dir });
      expect((taken.structuredContent.issues as { code: string }[])[0]?.code).toBe(
        "project-id-taken",
      );
    },
  );

  it("game_new offers side-view; scene_schema and scene_codes carry the standard behaviors as they are", async () => {
    const { tools } = await client.listTools();
    const gameNew = tools.find((t) => t.name === "game_new")!;
    const preset = (gameNew.inputSchema.properties as Record<string, { enum?: string[] }>).preset;
    expect(preset?.enum).toEqual(["top-down", "side-view", "grid", "turns"]);

    const behaviors = [
      "collider",
      "body",
      "player-input",
      "character-top-down",
      "character-side-view",
      "camera-target",
      "spawner",
      "nav-agent",
      "path-follow",
      "force-area",
      "joint",
    ];
    for (const which of ["scene", "prefab"]) {
      const out = await call("scene_schema", { which });
      expect(out.structuredContent.exitCode).toBe(0);
      const text = JSON.stringify(out.structuredContent);
      for (const name of behaviors) expect(text, `${which}: ${name}`).toContain(`"${name}"`);
    }

    const listed = await call("scene_codes");
    const engine = (
      listed.structuredContent.codes as Record<string, Record<string, { hint?: string }>>
    ).engine!;
    for (const code of [
      "behavior-conflict",
      "character-body-kind",
      "nav-missing",
      "body-missing",
      "body-not-dynamic",
      "joint-ref-type",
      "joint-self",
    ])
      expect(engine[code]?.hint, code).toBeTruthy();
  });

  it("shows a project's tree and an asset's references", async () => {
    const ambiguous = await call("project_tree");
    expect(ambiguous).toMatchObject({ isError: true, structuredContent: { exitCode: 2 } });
    const tree = await call("project_tree", { project: "engine" });
    expect(tree.structuredContent).toMatchObject({ exitCode: 0, project: "engine" });
    expect(JSON.stringify(tree.structuredContent.tree)).toContain('"id":"engine-yard-checks"');

    const refs = await call("asset_refs", { id: "engine-yard" });
    expect(refs.structuredContent).toMatchObject({
      exitCode: 0,
      project: "engine",
      asset: { id: "engine-yard", kind: "scene" },
      referrers: [{ id: "engine-yard-checks", kind: "checks" }],
    });
    const none = await call("asset_refs", { project: "platformer" });
    expect(none.structuredContent).toMatchObject({ exitCode: 0, dangling: [] });
    const miss = await call("asset_refs", { id: "engine-yrd" });
    expect(miss.isError).toBe(true);
    expect(String(miss.structuredContent.error)).toContain('Did you mean "engine-yard"?');
    const urlOnly = await call("asset_refs", { id: "engine-yard", url: "ws://localhost:1/x" });
    expect(urlOnly).toMatchObject({ isError: true, structuredContent: { exitCode: 2 } });
  });

  it("imports a file and applies a project op batch, as dry runs by default", async () => {
    const dry = await call("asset_import", { file: DOT, path: "art/", project: "engine" });
    expect(dry.structuredContent).toMatchObject({
      exitCode: 0,
      dryRun: true,
      written: false,
      created: ["dot"],
    });
    await expect(readFile(join(dirs.engine, "art/dot.png"))).rejects.toThrow();

    const imported = await call("asset_import", {
      file: DOT,
      path: "art/",
      settings: { filter: "nearest" },
      dryRun: false,
      project: "engine",
    });
    expect(imported.structuredContent).toMatchObject({ exitCode: 0, written: true });
    expect(await readFile(join(dirs.engine, "art/dot.png"))).toEqual(await readFile(DOT));
    const sidecar = JSON.parse(await readFile(join(dirs.engine, "art/dot.png.asset.json"), "utf8"));
    expect(sidecar).toMatchObject({ id: "dot", import: { filter: "nearest" } });

    const batch = { v: 1, ops: [{ op: "moveAsset", ids: ["dot"], to: "sprites/" }] };
    const planned = await call("asset_apply_ops", { ops: batch });
    expect(planned.structuredContent).toMatchObject({ exitCode: 0, dryRun: true, written: false });
    const moved = await call("asset_apply_ops", { ops: batch, dryRun: false, agentId: "claude" });
    expect(moved.structuredContent).toMatchObject({
      exitCode: 0,
      written: true,
      actor: { kind: "agent", agentId: "claude" },
    });
    expect(await readFile(join(dirs.engine, "sprites/dot.png"))).toEqual(await readFile(DOT));

    const refused = await call("asset_apply_ops", {
      ops: { v: 1, ops: [{ op: "renameAsset", id: "nope", name: "x" }] },
      dryRun: false,
    });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent.exitCode).toBe(1);
    const stale = await call("asset_apply_ops", {
      ops: { v: 1, ops: [{ op: "renameAsset", id: "dot", name: "Dot" }] },
      base: "0".repeat(64),
      dryRun: false,
    });
    expect(stale).toMatchObject({ isError: true, structuredContent: { exitCode: 3 } });
  });

  it("takes current-format ops in metres in scene_apply_ops and shows the fields they set", async () => {
    const file = join(dirs.engine, "z-yard.json");
    const def = JSON.parse(await readFile(ENGINE_YARD, "utf8"));
    await writeFile(file, JSON.stringify({ ...def, name: "z-yard" }));
    try {
      const ops = await call("scene_schema", { which: "ops" });
      expect(ops.structuredContent.$id).toBe(`urn:jams-engine:ops:v${SCENE_FORMAT_VERSION}`);
      const batch = {
        ops: [
          { op: "useAssets", add: ["dot"] },
          { op: "setZ", refs: ["zone"], z: 3 },
          { op: "setGroup", id: "west", at: [2, 0] },
          { op: "update", ref: "start", set: { group: "west" } },
          { op: "transform", groups: ["west"], flip: "x" },
        ],
      };
      const wrote = await call("scene_apply_ops", { scene: "z-yard", ops: batch, dryRun: false });
      expect(wrote.structuredContent, JSON.stringify(wrote.structuredContent)).toMatchObject({
        exitCode: 0,
        written: true,
      });
      const saved = JSON.parse(await readFile(file, "utf8"));
      expect(saved.assets).toEqual(["dot"]);
      expect(saved.groups.west).toMatchObject({ at: [2, 0], flip: true });

      const zone = await call("scene_show", { scene: "z-yard", ref: "zone" });
      expect(zone.structuredContent.entities).toEqual([expect.objectContaining({ z: 3 })]);
      const start = await call("scene_show", { scene: "z-yard", ref: "start" });
      expect(start.structuredContent.entities).toEqual([
        expect.objectContaining({ origin: [2, 0], transform: { rot: 0, flip: true } }),
      ]);
    } finally {
      await rm(file, { force: true });
    }
  });

  it("reports the asset codes from scene_apply_ops for a scene in a project", async () => {
    const art = join(dirs.engine, "crate-art");
    const file = join(dirs.engine, "sprite-yard.json");
    await mkdir(art);
    for (const name of [
      "crates.json",
      "crates.json.asset.json",
      "crates.png",
      "crates.png.asset.json",
    ])
      await copyFile(repoFile(`packages/engine/scenes/art/${name}`), join(art, name));
    const def = JSON.parse(await readFile(ENGINE_YARD, "utf8"));
    await writeFile(file, JSON.stringify({ ...def, name: "sprite-yard" }));
    const pic = (sprite: Record<string, unknown>) => ({
      ops: [
        {
          op: "add",
          entity: { id: "pic", type: "marker", at: [1, 1], behaviors: { sprite } },
        },
      ],
    });
    const codes = (r: Called) =>
      (r.structuredContent.issues as { code: string }[]).map((i) => i.code);
    try {
      const frame = await call("scene_apply_ops", {
        scene: "sprite-yard",
        ops: pic({ asset: "crates", frame: "crate-9" }),
      });
      expect(frame.structuredContent).toMatchObject({ exitCode: 1, written: false });
      expect(codes(frame)).toContain("asset-frame-unknown");
      const bare = await call("scene_apply_ops", {
        scene: "sprite-yard",
        ops: pic({ alpha: 0.5 }),
      });
      expect(bare.structuredContent).toMatchObject({ exitCode: 0 });
      expect(codes(bare)).toEqual(["sprite-no-asset"]);
    } finally {
      await rm(file, { force: true });
      await rm(art, { recursive: true, force: true });
    }
  });
});

/** A physics-free turns game that counts `bump`s, keeps time away, and lists a `bump` while under 10. */
const tallyGame = defineGame({
  id: "tally-game",
  types: [],
  actions: [],
  time: { kind: "turns", catchUp: { maxMs: 1000 } },
  commands: {
    bump: { description: "Adds n.", args: z.strictObject({ n: z.number().int() }) },
  },
  createRuntime() {
    let count = 0;
    let away = 0;
    return {
      beforeStep(_dt, _actions, commands) {
        for (const c of commands) {
          if (c.name === "bump") count += (c.args as { n: number }).n;
          else if (c.name === "@elapsed") away += (c.args as { ms: number }).ms;
        }
      },
      snapshot: () => ({ count, away }),
    };
  },
  play: {
    commands: ({ snapshot }) =>
      (snapshot as { count: number }).count < 10 ? [{ name: "bump", args: { n: 1 } }] : [],
  },
});

describe("world models", () => {
  /** A 6×3 square grid with a wall down column 2, open in the bottom row unless `sealed`. */
  const yard = (sealed: boolean) => ({
    v: 3,
    name: sealed ? "sealed-yard" : "tally-yard",
    game: tallyGame.id,
    bounds: [0, 0, 192, 96],
    settings: { physics: "none", grid: { kind: "square", cell: [32, 32] } },
    solid: [["box", 80, sealed ? 48 : 32, 16, sealed ? 48 : 32]],
    entities: [
      { id: "start", type: "marker", at: [16, 16] },
      { id: "exit", type: "marker", at: [176, 16] },
    ],
  });
  const CONNECTED = {
    v: 1,
    checks: [{ id: "path", kind: "connected", from: "start", to: ["exit"] }],
  };
  let world: Client;
  let loads = 0;
  const callWorld = async (name: string, args: Record<string, unknown>) =>
    (await world.callTool({ name, arguments: args })) as Called;

  beforeAll(async () => {
    const dir = join(root, tallyGame.id);
    await mkdir(dir);
    for (const sealed of [false, true]) {
      const scene = yard(sealed);
      await writeFile(join(dir, `${scene.name}.json`), JSON.stringify(scene, null, 2));
      await writeFile(join(dir, `${scene.name}.checks.json`), JSON.stringify(CONNECTED));
    }
    const ctx: ToolContext = {
      projects: [await tempProject(dir, { game: tallyGame })],
      loadRapier: () => {
        loads++;
        return Promise.reject(new Error("a physics-free tool loaded Rapier"));
      },
    };
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createSceneMcpServer(ctx).connect(serverSide);
    world = new Client({ name: "scene-mcp-world-test", version: "0" });
    await world.connect(clientSide);
  });

  afterAll(async () => {
    await world.close();
    expect(loads).toBe(0);
  });

  it("scene_show carries time and physics", async () => {
    const shown = await callWorld("scene_show", { scene: "tally-yard" });
    expect(shown.structuredContent).toMatchObject({
      exitCode: 0,
      time: { kind: "turns", rate: 60, catchUp: { maxMs: 1000 }, wakeOnPointerMove: false },
      physics: "none",
    });
    const rapier = await call("scene_show", { scene: "test-yard", ref: "elevator" });
    expect(rapier.structuredContent).toMatchObject({
      time: { kind: "fixed", rate: 60, catchUp: null },
      physics: "rapier",
    });
  });

  it("scene_playtest takes command and elapse steps", async () => {
    const script = {
      v: 1,
      steps: [
        { command: "bump", args: { n: 2 } },
        { elapse: 5000 },
        { command: "bump", args: { n: 3 } },
      ],
    };
    const played = await callWorld("scene_playtest", { scene: "tally-yard", script });
    expect(played.isError).toBe(false);
    expect(played.structuredContent).toMatchObject({
      exitCode: 0,
      outcome: { result: "script-end" },
      final: { count: 5, away: 1000 },
      legal: [{ name: "bump", args: { n: 1 } }],
    });
    expect(played.structuredContent).not.toHaveProperty("legalTruncated");
    const full = await callWorld("scene_playtest", {
      scene: "tally-yard",
      script: { v: 1, steps: [{ command: "bump", args: { n: 10 } }] },
    });
    expect(full.structuredContent).toMatchObject({ exitCode: 0, legal: [] });
    expect((played.structuredContent.commands as unknown[][]).map((c) => c.slice(1))).toEqual([
      ["bump", { n: 2 }],
      ["@elapsed", { ms: 1000 }],
      ["bump", { n: 3 }],
    ]);

    const typo = await callWorld("scene_playtest", {
      scene: "tally-yard",
      script: { v: 1, steps: [{ command: "bum" }] },
    });
    expect(typo.structuredContent.exitCode).toBe(1);
    expect(JSON.stringify(typo.structuredContent)).toContain('did you mean \\"bump\\"');
  });

  it("scene_check runs a connected check", async () => {
    const open = await callWorld("scene_check", { scene: "tally-yard" });
    expect(open.structuredContent).toMatchObject({
      exitCode: 0,
      ok: true,
      results: [expect.objectContaining({ id: "path", pass: true })],
    });
    const sealed = await callWorld("scene_check", { scene: "sealed-yard" });
    expect(sealed.isError).toBe(false);
    expect(sealed.structuredContent).toMatchObject({
      exitCode: 1,
      results: [expect.objectContaining({ id: "path", pass: false })],
    });
    expect(JSON.stringify(sealed.structuredContent)).toContain("grid-unreachable");
  });
});

/** Spawns a marker every tick and destroys the oldest once three are live. */
const spawnerGame = defineGame({
  id: "spawner-game",
  types: [],
  actions: [{ action: "right", keys: ["d"], description: "Unused." }],
  createRuntime(ctx) {
    const live: string[] = [];
    return {
      beforeStep() {
        if (live.length >= 3) ctx.destroy(live.shift()!);
        live.push(ctx.spawn({ type: "marker", at: [16, 16] }).id);
      },
      snapshot: () => ({ live: live.length }),
    };
  },
});

describe("lifecycle events", () => {
  const SPAWNS = {
    v: 1,
    steps: [{ hold: [], until: { exists: "marker#5" }, max: 100 }, { wait: 4 }],
  };
  const reaches = (id: string, expect: Record<string, unknown>) => ({
    id,
    kind: "reaches",
    result: "script-end",
    script: { v: 1, steps: [{ wait: 10 }] },
    expect,
  });
  let spawns: Client;
  const callSpawns = async (name: string, args: Record<string, unknown>) =>
    (await spawns.callTool({ name, arguments: args })) as Called;

  beforeAll(async () => {
    const dir = join(root, spawnerGame.id);
    await mkdir(dir);
    await writeFile(
      join(dir, "spawn-yard.json"),
      JSON.stringify({
        v: 1,
        name: "spawn-yard",
        game: spawnerGame.id,
        bounds: [0, 0, 320, 240],
        settings: { physics: "none" },
        entities: [{ id: "start", type: "marker", at: [16, 16] }],
      }),
    );
    await writeFile(
      join(dir, "spawn-yard.checks.json"),
      JSON.stringify({
        v: 1,
        checks: [
          reaches("three-live", { count: { type: "marker", eq: 4 }, exists: "marker#10" }),
          reaches("all-gone", { count: { type: "marker", max: 0 } }),
        ],
      }),
    );
    const ctx: ToolContext = {
      projects: [await tempProject(dir, { game: spawnerGame })],
      loadRapier: () => Promise.reject(new Error("a physics-free tool loaded Rapier")),
    };
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createSceneMcpServer(ctx).connect(serverSide);
    spawns = new Client({ name: "scene-mcp-spawn-test", version: "0" });
    await spawns.connect(clientSide);
  });

  afterAll(async () => {
    await spawns.close();
  });

  it("scene_playtest waits on exists and carries the lifecycle events and counts", async () => {
    const played = await callSpawns("scene_playtest", { scene: "spawn-yard", script: SPAWNS });
    expect(played.isError).toBe(false);
    const out = played.structuredContent as Called["structuredContent"] & {
      steps: { end: string }[];
      events: { type: string; entityId?: string }[];
      lifecycle: Record<string, { spawned: number; destroyed: number }>;
    };
    expect(out.exitCode).toBe(0);
    expect(out.steps.map((s) => s.end)).toEqual(["until", "done"]);
    expect(out.lifecycle).toEqual({ marker: { spawned: 9, destroyed: 6 } });
    expect(out.events).toContainEqual(
      expect.objectContaining({ type: "entity:spawned", entityId: "marker#5" }),
    );

    const only = await callSpawns("scene_playtest", {
      scene: "spawn-yard",
      script: SPAWNS,
      events: ["entity:destroyed"],
    });
    const kept = only.structuredContent.events as { type: string }[];
    expect(kept.map((e) => e.type)).toEqual(Array(6).fill("entity:destroyed"));
    expect(only.structuredContent.lifecycle).toEqual(out.lifecycle);
  });

  it("scene_check judges a reaches check's expect on the last tick", async () => {
    const checked = await callSpawns("scene_check", { scene: "spawn-yard" });
    expect(checked.isError).toBe(false);
    expect(checked.structuredContent).toMatchObject({
      exitCode: 1,
      results: [
        expect.objectContaining({ id: "three-live", pass: true }),
        expect.objectContaining({ id: "all-gone", pass: false }),
      ],
    });
    expect(JSON.stringify(checked.structuredContent)).toContain("count");
    const one = await callSpawns("scene_check", { scene: "spawn-yard", only: "three-live" });
    expect(one.structuredContent).toMatchObject({ exitCode: 0, ok: true });
  });
});

/** Two seats: each adds up its `move` stick's x, counts its `fire` presses and primary clicks, and keeps its pointer. */
const seatsGame = defineGame({
  id: "seats-game",
  types: [],
  actions: [
    {
      action: "move",
      kind: "vector",
      bindings: [
        { device: "key", code: "KeyA", axis: "x", value: -1 },
        { device: "key", code: "KeyD", axis: "x", value: 1 },
        { device: "pad", stick: "left" },
      ],
      description: "Move the seat.",
    },
    {
      action: "fire",
      bindings: [
        { device: "key", code: "Space" },
        { device: "pad", button: "south" },
      ],
      description: "Fire.",
    },
  ],
  input: { players: { max: 2, join: "press" } },
  world: { physics: "none" },
  time: { kind: "fixed" },
  createRuntime(ctx) {
    const seats = [0, 1].map(() => ({
      x: 0,
      fires: 0,
      clicks: 0,
      down: false,
      pointer: null as number[] | null,
    }));
    return {
      beforeStep() {
        seats.forEach((s, seat) => {
          s.x += ctx.input.vector("move", seat).x;
          if (ctx.input.pressed("fire", seat)) s.fires++;
          const p = ctx.input.pointer(seat);
          const down = !!p && (p.buttons & 1) === 1;
          if (down && !s.down) s.clicks++;
          s.down = down;
          if (p) s.pointer = [p.x, p.y];
        });
      },
      snapshot: () =>
        seats.map((s, seat) => ({
          x: Math.round(s.x * 1000) / 1000,
          fires: s.fires,
          clicks: s.clicks,
          pointer: s.pointer,
          joined: ctx.input.players()[seat]?.joined ?? false,
        })),
    };
  },
});

describe("input v2", () => {
  const TWO_SEATS = {
    v: 2,
    players: 2,
    tracks: [
      {
        player: 0,
        steps: [
          { join: "keyboard" },
          { set: { move: [1, 0] }, for: 10 },
          { press: "fire" },
          { wait: 1 },
          { pointer: { at: [2.5, 3], press: "primary" }, for: 2 },
          { pointer: { at: [2.5, 3], drag: [4.5, 3], release: "primary" }, for: 5 },
        ],
      },
      {
        player: 1,
        steps: [{ wait: 3 }, { join: "pad:0" }, { set: { move: [-0.5, 0] }, for: 8 }, { wait: 1 }],
      },
    ],
  };
  let seats: Client;
  let dir: string;
  const callSeats = async (name: string, args: Record<string, unknown>) =>
    (await seats.callTool({ name, arguments: args })) as Called;

  beforeAll(async () => {
    dir = join(root, seatsGame.id);
    await mkdir(dir);
    await writeFile(
      join(dir, "seat-yard.json"),
      JSON.stringify({
        v: SCENE_FORMAT_VERSION,
        name: "seat-yard",
        game: seatsGame.id,
        bounds: [0, 0, 10, 6],
        entities: [{ id: "start", type: "marker", at: [1, 1] }],
      }),
    );
    const ctx: ToolContext = {
      projects: [await tempProject(dir, { game: seatsGame })],
      loadRapier: () => Promise.reject(new Error("a physics-free tool loaded Rapier")),
    };
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createSceneMcpServer(ctx).connect(serverSide);
    seats = new Client({ name: "scene-mcp-seats-test", version: "0" });
    await seats.connect(clientSide);
  });

  afterAll(async () => {
    await seats.close();
  });

  it("describes v2 scripts, v1 migration and input-map edits", async () => {
    const { tools } = await client.listTools();
    const tool = (name: string) => tools.find((t) => t.name === name)!;
    const field = (name: string, key: string) =>
      (tool(name).inputSchema.properties as Record<string, { description?: string }>)[key]
        ?.description;
    const playtest = tool("scene_playtest").description!;
    for (const word of ["format v2", "v1 script migrates", "`tracks`", "`set`", "`pointer`"])
      expect(playtest).toContain(word);
    expect(playtest).toMatch(/`join` a device .*`leave`/);
    expect(playtest).toMatch(/`legal`: the commands it may send after the last tick, at most 64/);
    expect(field("scene_playtest", "script")).toMatch(/v2 or v1/);
    const replay = tool("scene_replay").description!;
    expect(replay).toContain("`migratedFrom: 1`");
    expect(replay).toContain("recording-other-platform");
    expect(field("scene_replay", "run")).toMatch(/v2 or v1/);
    const assets = tool("asset_apply_ops").description!;
    expect(assets).toContain("/actions/@fire/bindings");
    expect(assets).toContain("binding-unknown");
    expect(assets).toContain("player-unknown");
  });

  it("scene_playtest plays a two-track v2 script: sticks, pointer and joins per seat", async () => {
    const played = await callSeats("scene_playtest", { scene: "seat-yard", script: TWO_SEATS });
    expect(played.isError, JSON.stringify(played.structuredContent)).toBe(false);
    expect(played.structuredContent).toMatchObject({
      exitCode: 0,
      outcome: { result: "script-end" },
      final: [
        { x: 10, fires: 1, clicks: 1, pointer: [4.5, 3], joined: true },
        { x: -4, fires: 0, clicks: 0, pointer: null, joined: true },
      ],
    });
    const recording = played.structuredContent.recording as { v: number; inputs: unknown[] };
    expect(recording.v).toBe(2);
    expect(recording.inputs).toHaveLength(2);

    const replayed = await callSeats("scene_replay", { scene: "seat-yard", run: recording });
    expect(replayed.structuredContent).toMatchObject({
      exitCode: 0,
      matches: true,
      stale: false,
      issues: [],
      final: played.structuredContent.final,
    });
    expect(replayed.structuredContent).not.toHaveProperty("migratedFrom");
    const fromResult = await callSeats("scene_replay", {
      scene: "seat-yard",
      run: { ...played.structuredContent, blocked: false },
    });
    expect(fromResult.structuredContent).toMatchObject({ exitCode: 0, matches: true });
  });

  it("scene_playtest migrates a v1 script and refuses a v2 step the game can't play", async () => {
    const v1 = await callSeats("scene_playtest", {
      scene: "seat-yard",
      script: { v: 1, steps: [{ press: "fire" }, { wait: 2 }] },
    });
    expect(v1.structuredContent).toMatchObject({
      exitCode: 0,
      final: [{ fires: 1 }, { fires: 0 }],
    });

    const tooMany = await callSeats("scene_playtest", {
      scene: "seat-yard",
      script: { v: 2, tracks: [{ player: 2, steps: [{ wait: 1 }] }] },
    });
    expect(tooMany.isError).toBe(false);
    expect(tooMany.structuredContent).toMatchObject({ exitCode: 1, stage: "script" });
  });

  it("scene_replay migrates a frozen v1 recording", { timeout: 20_000 }, async () => {
    const replayed = await call("scene_replay", {
      scene: V1_ENGINE_YARD,
      run: V1_SETTLES,
    });
    expect(replayed.isError).toBe(false);
    expect(replayed.structuredContent).toMatchObject({
      exitCode: 0,
      migratedFrom: 1,
      matches: true,
      recording: { v: 2 },
    });
  });

  it("asset_apply_ops appends an input-map binding and refuses one the game can't read", async () => {
    const created = await callSeats("asset_apply_ops", {
      ops: {
        v: 1,
        ops: [
          {
            op: "createAsset",
            kind: "input-map",
            path: "input-map.json",
            content: {
              kind: "input-map",
              v: 1,
              actions: [{ action: "fire", bindings: [{ device: "key", code: "Space" }] }],
            },
          },
        ],
      },
      dryRun: false,
    });
    expect(created.structuredContent, JSON.stringify(created.structuredContent)).toMatchObject({
      exitCode: 0,
      written: true,
    });
    const append = (value: object) => ({
      v: 1,
      ops: [
        { op: "editAsset", id: "input-map", edits: [{ insert: "/actions/@fire/bindings", value }] },
      ],
    });
    const fire = async () =>
      JSON.parse(await readFile(join(dir, "input-map.json"), "utf8")).actions.find(
        (a: { action: string }) => a.action === "fire",
      ).bindings;

    const planned = await callSeats("asset_apply_ops", {
      ops: append({ device: "pad", button: "south" }),
    });
    expect(planned.structuredContent).toMatchObject({ exitCode: 0, written: false });
    expect(await fire()).toHaveLength(1);

    const added = await callSeats("asset_apply_ops", {
      ops: append({ device: "pad", button: "south" }),
      dryRun: false,
    });
    expect(added.structuredContent).toMatchObject({ exitCode: 0, written: true });
    expect(await fire()).toEqual([
      { device: "key", code: "Space" },
      { device: "pad", button: "south" },
    ]);

    for (const value of [
      { device: "key", code: "Spcae" },
      { device: "pad", stick: "left" },
      { device: "key", code: "KeyF", player: 5 },
    ]) {
      const refused = await callSeats("asset_apply_ops", { ops: append(value), dryRun: false });
      expect(refused.structuredContent, JSON.stringify(value)).toMatchObject({
        exitCode: 1,
        written: false,
        issue: { code: value.player === undefined ? "binding-unknown" : "player-unknown" },
      });
    }
    const typo = await callSeats("asset_apply_ops", {
      ops: append({ device: "key", code: "Spcae" }),
    });
    expect(typo.structuredContent.issue).toMatchObject({
      message: expect.stringContaining('unknown key code "Spcae"'),
    });
    expect(await fire()).toHaveLength(2);
  });
});

type HopSnap = { scene: string | null; x: number; trips: number };

/** Holding `right` counts up `x`; `go` requests a scene and counts the trip in persistent state. */
const hopGame = defineGame<HopSnap>({
  id: "flow-hop",
  types: [],
  actions: [{ action: "right", keys: ["d"], description: "Counts up." }],
  world: { physics: "none" },
  time: { kind: "fixed" },
  persist: {
    initial: () => ({ trips: 0 }),
    schema: z.strictObject({ trips: z.number().int().min(0) }),
  },
  saves: { version: 1 },
  commands: {
    go: { description: "Requests a scene.", args: z.strictObject({ to: z.string() }) },
  },
  createRuntime(ctx) {
    let x = 0;
    const trips = () => (ctx.persist.value as { trips: number }).trips;
    return {
      onLoad() {
        x = 0;
      },
      beforeStep(_dt, _actions, commands) {
        if (ctx.input.held("right")) x++;
        for (const c of commands)
          if (c.name === "go")
            ctx.flow.request({
              to: (c.args as { to: string }).to,
              persist: { trips: trips() + 1 },
            });
      },
      snapshot: () => ({ scene: ctx.flow.scene, x, trips: trips() }),
      restore(state) {
        x = state.x;
      },
    };
  },
});

describe("scene flow and saves", () => {
  let hop: Client;
  let dir: string;
  let ctx: ToolContext;
  const callHop = async (name: string, args: Record<string, unknown>) =>
    (await hop.callTool({ name, arguments: args })) as Called;
  const hopScene = (name: string) =>
    JSON.stringify({
      v: SCENE_FORMAT_VERSION,
      name,
      game: hopGame.id,
      bounds: [0, 0, 10, 6],
      entities: [{ id: "start", type: "marker", at: [1, 1] }],
    });
  const listFile = async () => JSON.parse(await readFile(join(dir, "scene-list.json"), "utf8"));
  const editList = (...edits: object[]) => ({
    v: 1,
    ops: [{ op: "editAsset", id: "scene-list", edits }],
  });
  const GO_THEN_RIGHT = {
    v: 2,
    steps: [
      { command: "go", args: { to: "level" } },
      { hold: ["right"], for: 3 },
    ],
  };

  beforeAll(async () => {
    dir = join(root, hopGame.id);
    await mkdir(dir);
    for (const name of ["menu", "level", "vault"])
      await writeFile(join(dir, `${name}.json`), hopScene(name));
    ctx = {
      projects: [await tempProject(dir, { game: hopGame })],
      loadRapier: () => Promise.reject(new Error("a physics-free tool loaded Rapier")),
    };
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createSceneMcpServer(ctx).connect(serverSide);
    hop = new Client({ name: "scene-mcp-flow-test", version: "0" });
    await hop.connect(clientSide);
  });

  afterAll(async () => {
    await hop.close();
  });

  it("describes scene_flow, the playtest's flow and fromSave, and scene-list edits", async () => {
    const { tools } = await client.listTools();
    const tool = (name: string) => tools.find((t) => t.name === name)!;
    expect(tool("scene_flow").description).toMatch(/scene list as data/);
    expect(tool("scene_flow").description).toContain("`unlisted`");
    expect(tool("scene_flow").inputSchema.properties).toHaveProperty("project");
    const props = tool("scene_playtest").inputSchema.properties as Record<string, object>;
    expect(props.flow).toMatchObject({ type: "boolean" });
    expect(props.fromSave).toBeDefined();
    expect(tool("scene_playtest").description).toContain("`segments`");
    const assets = tool("asset_apply_ops").description!;
    for (const code of ["start-scene-missing", "id-taken", "asset-missing"])
      expect(assets).toContain(code);
  });

  it("asset_apply_ops writes and edits the scene list through its kind", async () => {
    const created = await callHop("asset_apply_ops", {
      ops: {
        v: 1,
        ops: [
          {
            op: "createAsset",
            kind: "scene-list",
            path: "scene-list.json",
            content: {
              kind: "scene-list",
              v: 1,
              start: "menu",
              scenes: [{ scene: "menu", title: "Menu" }],
            },
          },
        ],
      },
      dryRun: false,
    });
    expect(created.structuredContent, JSON.stringify(created.structuredContent)).toMatchObject({
      exitCode: 0,
      written: true,
    });

    const listLevel = editList({ insert: "/scenes", value: { scene: "level", title: "Level 1" } });
    const planned = await callHop("asset_apply_ops", { ops: listLevel });
    expect(planned.structuredContent).toMatchObject({ exitCode: 0, written: false });
    expect((await listFile()).scenes).toHaveLength(1);
    const listed = await callHop("asset_apply_ops", { ops: listLevel, dryRun: false });
    expect(listed.structuredContent, JSON.stringify(listed.structuredContent)).toMatchObject({
      exitCode: 0,
      written: true,
    });
    expect(await listFile()).toMatchObject({
      start: "menu",
      scenes: [
        { scene: "menu", title: "Menu" },
        { scene: "level", title: "Level 1" },
      ],
    });

    const sublevel = await callHop("asset_apply_ops", {
      ops: editList({ insert: "/scenes", value: { scene: "vault", sublevel: true } }),
      dryRun: false,
    });
    expect(sublevel.structuredContent).toMatchObject({ exitCode: 0, written: true });
    for (const [edit, code] of [
      [{ set: "/start", value: "vault" }, "start-scene-missing"],
      [{ set: "/start", value: "attic" }, "start-scene-missing"],
      [{ insert: "/scenes", value: { scene: "menu" } }, "id-taken"],
    ] as const) {
      const refused = await callHop("asset_apply_ops", { ops: editList(edit), dryRun: false });
      expect(refused.structuredContent, JSON.stringify(edit)).toMatchObject({
        exitCode: 1,
        written: false,
        issue: { code },
      });
    }
    expect(await listFile()).toMatchObject({ start: "menu" });
    expect((await listFile()).scenes).toHaveLength(3);

    const nowhere = await callHop("asset_apply_ops", {
      ops: editList({ insert: "/scenes", value: { scene: "nowhere" } }),
      dryRun: false,
    });
    expect(nowhere.structuredContent).toMatchObject({ exitCode: 0, written: true });
    const dangling = await callHop("asset_refs", {});
    expect(dangling.structuredContent).toMatchObject({
      exitCode: 1,
      dangling: [{ code: "asset-missing" }],
    });
    const unlisted = await callHop("asset_apply_ops", {
      ops: editList({ remove: "/scenes/@nowhere" }),
      dryRun: false,
    });
    expect(unlisted.structuredContent).toMatchObject({ exitCode: 0, written: true });
    expect((await callHop("asset_refs", {})).structuredContent).toMatchObject({
      exitCode: 0,
      dangling: [],
    });
    expect((await listFile()).scenes.map((e: { scene: string }) => e.scene)).toEqual([
      "menu",
      "level",
      "vault",
    ]);
  });

  it("scene_flow hands back the CLI's scene flow as data", async () => {
    const called = await callHop("scene_flow", {});
    const cli = await flowTool({}, { ...ctx, project: hopGame.id });
    expect(cli.exitCode, cli.text).toBe(0);
    expect(called.isError).toBe(false);
    expect(called.structuredContent).toEqual(toMcpResult(cli).structuredContent);
    expect(called.structuredContent).toMatchObject({
      projects: [
        {
          project: hopGame.id,
          list: { path: "scene-list.json" },
          start: "menu",
          scenes: [
            { scene: "menu", title: "Menu", start: true, physics: "none" },
            { scene: "level", title: "Level 1", start: false, physics: "none" },
            { scene: "vault", sublevel: true, physics: "none" },
          ],
          unlisted: [],
        },
      ],
    });
    const scenes = (called.structuredContent.projects as { scenes: { bundle: object }[] }[])[0]!
      .scenes;
    for (const row of scenes) expect(row.bundle).toMatchObject({ bytes: expect.any(Number) });
  });

  it("scene_playtest ends at a scene request, or follows it with flow", async () => {
    const stopped = await callHop("scene_playtest", { scene: "menu", script: GO_THEN_RIGHT });
    expect(stopped.structuredContent, JSON.stringify(stopped.structuredContent)).toMatchObject({
      exitCode: 0,
      outcome: { result: "flow" },
      recording: { next: { scene: "level" } },
    });
    expect(stopped.structuredContent).not.toHaveProperty("segments");

    const followed = await callHop("scene_playtest", {
      scene: "menu",
      script: GO_THEN_RIGHT,
      flow: true,
    });
    expect(followed.structuredContent, JSON.stringify(followed.structuredContent)).toMatchObject({
      exitCode: 0,
      outcome: { result: "script-end" },
      final: { scene: "level", x: 3, trips: 1 },
      segments: [
        { scene: "menu", end: { result: "flow", to: "level" } },
        { scene: "level", end: { result: "script-end" } },
      ],
    });
  });

  it("scene_playtest starts from a save fixture, by path or inline", async () => {
    const registry = createRegistry(hopGame);
    const runtime = createHeadlessRuntime({
      game: hopGame,
      registry,
      scene: expandScene(JSON.parse(hopScene("level")), registry),
    });
    for (let tick = 0; tick < 5; tick++)
      runtime.step(runtime.ctx.time.tickMs, [
        { action: "right", pressed: true, tick, timestamp: 0 },
      ]);
    expect(runtime.snapshot()).toMatchObject({ x: 5 });
    const saved = runtime.save({ depth: "world", slot: "fixture", now: 0 });
    runtime.destroy();
    if (!saved.ok) throw new Error(saved.issue.message);
    const text = formatSaveFile(saved.file);
    const file = join(root, "level.save.json");
    await writeFile(file, text);
    const sha256 = createHash("sha256").update(text).digest("hex");
    const script = { v: 2, steps: [{ hold: ["right"], for: 2 }] };

    const fresh = await callHop("scene_playtest", { scene: "level", script });
    expect(fresh.structuredContent).toMatchObject({ final: { x: 2 } });
    expect(fresh.structuredContent.recording).not.toHaveProperty("fromSave");

    const resumed = await callHop("scene_playtest", { scene: "level", script, fromSave: file });
    expect(resumed.structuredContent, JSON.stringify(resumed.structuredContent)).toMatchObject({
      exitCode: 0,
      final: { x: 7 },
      recording: { fromSave: { slot: "fixture", sha256 } },
    });

    const inline = await callHop("scene_playtest", {
      scene: "level",
      script,
      fromSave: JSON.parse(text),
    });
    expect(inline.structuredContent, JSON.stringify(inline.structuredContent)).toMatchObject({
      exitCode: 0,
      final: { x: 7 },
      recording: { fromSave: { slot: "fixture" } },
    });
  });
});

describe("hosted URLs", () => {
  const SITE = "https://staging.example.test";
  const SECRET = "jat_mcpSecretThatMustStayHome";
  const projectTree = MCP_TOOLS.find((t) => t.name === "project_tree")!;

  async function attempt(url: string, env: Record<string, string>) {
    const sentTo: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new Headers(init?.headers).get("authorization")?.includes(SECRET)) sentTo.push(target);
      return Response.json({ message: "no" }, { status: 401 });
    }) as typeof globalThis.fetch;
    const result = (await runMcpTool(
      projectTree,
      { live: true, url },
      { projects: [], loadRapier: loadCompatRapier, env, fetch },
    )) as Called;
    return { result, sentTo };
  }

  it(`sends the agent token only to the origin ${AGENT_SITE_ENV} pins`, async () => {
    const pinned = { [AGENT_TOKEN_ENV]: SECRET, [AGENT_SITE_ENV]: SITE };
    for (const [url, env, says] of [
      ["https://attacker.example", pinned, AGENT_SITE_ENV],
      ["http://attacker.example", pinned, AGENT_SITE_ENV],
      ["http://staging.example.test", pinned, AGENT_SITE_ENV],
      [`${SITE}:8443`, pinned, AGENT_SITE_ENV],
      [SITE, { [AGENT_TOKEN_ENV]: SECRET }, AGENT_SITE_ENV],
      [SITE, { [AGENT_SITE_ENV]: SITE }, AGENT_TOKEN_ENV],
    ] as const) {
      const { result, sentTo } = await attempt(url, env);
      expect(result, url).toMatchObject({ isError: true, structuredContent: { exitCode: 2 } });
      expect(JSON.stringify(result), url).toContain(says);
      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(sentTo, url).toEqual([]);
    }

    const { result, sentTo } = await attempt(`${SITE}/projects/demo`, pinned);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(sentTo.length).toBeGreaterThan(0);
    for (const target of sentTo) expect(new URL(target).origin).toBe(SITE);
  });
});

describe("live docs", { timeout: 60_000 }, () => {
  let server: ListeningSceneCollab;
  let human: { doc: Y.Doc; provider: HocuspocusProvider };

  const speedOf = (doc: Y.Doc) =>
    (docToScene(doc).entities!.find((e) => e.id === "lift")!.path as { speed: number }).speed;

  async function until(check: () => boolean, what: string, ms = 5_000) {
    const end = Date.now() + ms;
    while (!check()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  beforeAll(async () => {
    const liveDir = join(root, "live");
    await mkdir(liveDir);
    await copyFile(ENGINE_YARD, join(liveDir, "engine-yard.json"));
    await copyFile(ENGINE_YARD_CHECKS, join(liveDir, "engine-yard.checks.json"));
    await writeFile(
      join(liveDir, "jams.project.json"),
      JSON.stringify({ kind: "project", v: 1, id: "engine", name: "Engine", game: null }),
    );
    server = await listenSceneCollab({
      projects: [await readFileProject(liveDir, { cacheDir: join(root, "live-cache") })],
      debounceMs: 50,
      warn: () => undefined,
    });
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: server.url,
      name: docNameOf({ kind: "scene", project: "engine", key: "engine-yard" }),
      document: doc,
    });
    await until(() => provider.synced, "the human's first sync");
    human = { doc, provider };
  });

  afterAll(async () => {
    human.provider.destroy();
    human.doc.destroy();
    await server.close();
  });

  it("reads the live doc, unsaved edits included", async () => {
    const shown = await call("scene_show", {
      scene: "engine-yard",
      ref: "lift",
      live: true,
      url: server.url,
    });
    expect(shown.structuredContent).toMatchObject({
      exitCode: 0,
      scene: "engine-yard",
      live: true,
      url: server.url,
    });
    const valid = await call("scene_validate", {
      scene: "engine-yard",
      live: true,
      url: server.url,
    });
    expect(valid.structuredContent).toMatchObject({ exitCode: 0, scene: "engine-yard" });
    const checked = await call("scene_check", {
      scene: "engine-yard",
      only: "valid",
      live: true,
      url: server.url,
    });
    expect(checked.structuredContent).toMatchObject({ exitCode: 0, scene: "engine-yard" });
  });

  it("applies a live batch as one agent entry the human sees", async () => {
    const dry = await call("scene_apply_ops", {
      scene: "engine-yard",
      ops: SLOW_LIFT,
      live: true,
      url: server.url,
    });
    expect(dry.structuredContent).toMatchObject({ dryRun: true, written: false, live: true });
    expect(speedOf(human.doc)).toBe(0.8);

    const r = await call("scene_apply_ops", {
      scene: "engine-yard",
      ops: { label: "Slow the lift", ...SLOW_LIFT },
      dryRun: false,
      onBehalfOf: "ada",
      live: true,
      url: server.url,
    });
    expect(r.isError).toBe(false);
    expect(r.structuredContent).toMatchObject({ exitCode: 0, written: true });
    await until(() => speedOf(human.doc) === 0.3, "the batch to reach the human");
    const entry = readLog(human.doc).at(-1)!;
    expect(entry.actor).toEqual({
      kind: "agent",
      agentId: DEFAULT_MCP_AGENT_ID,
      onBehalfOf: "ada",
    });
    expect(entry.label).toBe("Slow the lift");
  });

  it("reads the live tree and references", async () => {
    const tree = await call("project_tree", { live: true, url: server.url });
    expect(tree.structuredContent).toMatchObject({ exitCode: 0, project: "engine", live: true });
    expect(JSON.stringify(tree.structuredContent.tree)).toContain('"id":"engine-yard-checks"');
    const refs = await call("asset_refs", { id: "engine-yard", live: true, url: server.url });
    expect(refs.structuredContent).toMatchObject({
      exitCode: 0,
      live: true,
      asset: { id: "engine-yard", kind: "scene" },
      referrers: [expect.objectContaining({ id: "engine-yard-checks", kind: "checks" })],
    });
    const dangling = await call("asset_refs", { live: true, url: server.url, project: "engine" });
    expect(dangling.structuredContent).toMatchObject({ exitCode: 0, live: true, dangling: [] });
  });

  it("imports and applies project ops live, as the agent the human's project doc names", async () => {
    const projectDoc = new Y.Doc();
    const watcher = new HocuspocusProvider({
      url: server.url,
      name: docNameOf({ kind: "project", project: "engine" }),
      document: projectDoc,
    });
    try {
      await until(() => watcher.synced, "the project doc's first sync");
      const live = { live: true, url: server.url };
      const dry = await call("asset_import", { file: DOT, path: "art/", ...live });
      expect(dry.structuredContent).toMatchObject({ dryRun: true, written: false, live: true });
      expect(Object.values(readProject(projectDoc).assets).map((a) => a.id)).not.toContain("dot");

      const imported = await call("asset_import", {
        file: DOT,
        path: "art/",
        dryRun: false,
        onBehalfOf: "ada",
        ...live,
      });
      expect(imported.structuredContent).toMatchObject({ exitCode: 0, written: true });
      const actor = { kind: "agent", agentId: DEFAULT_MCP_AGENT_ID, onBehalfOf: "ada" };
      await until(
        () => Object.values(readProject(projectDoc).assets).some((a) => a.id === "dot"),
        "the import to reach the project doc",
      );
      expect(readProjectLog(projectDoc).at(-1)!.actor).toEqual(actor);

      const renamed = await call("asset_apply_ops", {
        ops: { v: 1, label: "Name the dot", ops: [{ op: "renameAsset", id: "dot", name: "Dot" }] },
        dryRun: false,
        agentId: "claude",
        ...live,
      });
      expect(renamed.structuredContent).toMatchObject({ exitCode: 0, written: true, live: true });
      await until(
        () => Object.values(readProject(projectDoc).assets).some((a) => a.name === "Dot"),
        "the rename to reach the project doc",
      );
      expect(readProjectLog(projectDoc).at(-1)).toMatchObject({
        label: "Name the dot",
        actor: { kind: "agent", agentId: "claude" },
      });
      const based = await call("asset_apply_ops", {
        ops: { v: 1, ops: [{ op: "renameAsset", id: "dot", name: "x" }] },
        base: "0".repeat(64),
        ...live,
      });
      expect(based).toMatchObject({ isError: true, structuredContent: { exitCode: 2 } });
    } finally {
      watcher.destroy();
      projectDoc.destroy();
    }
  });

  it("refuses a collab server that isn't local", async () => {
    for (const [name, args] of [
      ["project_tree", {}],
      ["asset_refs", { id: "engine-yard" }],
      ["asset_import", { file: DOT }],
      ["asset_apply_ops", { ops: { v: 1, ops: [] } }],
    ] as const) {
      const r = await call(name, {
        ...args,
        live: true,
        url: "ws://192.0.2.1:3000/__scene-collab",
      });
      expect(r, name).toMatchObject({ isError: true, structuredContent: { exitCode: 2 } });
    }

    const r = await call("scene_show", {
      scene: "engine-yard",
      live: true,
      url: "ws://192.0.2.1:3000/__scene-collab",
    });
    expect(r).toMatchObject({ isError: true, structuredContent: { exitCode: 2 } });
  });
});

describe("game_build and game_manifest", () => {
  const BUILD_TIMEOUT = 300_000;
  let buildRoot: string;
  let gameClient: Client;
  const callGame = async (name: string, args: Record<string, unknown>) =>
    (await gameClient.callTool({ name, arguments: args })) as Called;

  beforeAll(async () => {
    buildRoot = await mkdtemp(join(tmpdir(), "scene-mcp-build-"));
    const projects = (await discoverProjects(REPO_ROOT)).filter((p) => p.file.id === "tactics");
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createSceneMcpServer({ projects, loadRapier: loadCompatRapier }).connect(serverSide);
    gameClient = new Client({ name: "scene-mcp-build-test", version: "0" });
    await gameClient.connect(clientSide);
  });

  afterAll(async () => {
    await gameClient.close();
    await rm(buildRoot, { recursive: true, force: true });
  });

  it("drops file contents from a report and keeps paths, hashes and sizes", () => {
    const report = {
      summary: { scenes: 1 },
      issues: [],
      plan: {
        files: [
          { path: "index.html", role: "shell", source: { kind: "text", text: "<!doctype html>" } },
          {
            path: "icons/icon-192.png",
            role: "icon",
            source: { kind: "bytes", bytes: new Uint8Array(3) },
          },
          { path: "a.png", role: "asset", source: { kind: "blob", sha256: "ab" } },
        ],
      },
      manifest: { build: { files: [{ path: "a.png", sha256: "ab", bytes: 12, role: "asset" }] } },
      raw: Buffer.from("png"),
    };
    expect(withoutFileBytes(report)).toEqual({
      summary: { scenes: 1 },
      issues: [],
      plan: {
        files: [
          { path: "index.html", role: "shell", source: { kind: "text" } },
          { path: "icons/icon-192.png", role: "icon", source: { kind: "bytes" } },
          { path: "a.png", role: "asset", source: { kind: "blob", sha256: "ab" } },
        ],
      },
      manifest: { build: { files: [{ path: "a.png", sha256: "ab", bytes: 12, role: "asset" }] } },
    });
  });

  it(
    "builds tactics, returning the plan summary and issues and no file bytes, and validates its manifest",
    { timeout: BUILD_TIMEOUT },
    async () => {
      const out = join(buildRoot, "tactics-web");
      const built = await callGame("game_build", { id: "tactics", out });
      expect(built.isError).toBe(false);
      expect(built.structuredContent.exitCode).toBe(0);
      expect(built.structuredContent).toHaveProperty("summary");
      const wasmLines = (summary: unknown) => String(summary).match(/\bwasm: .*/g);
      expect(wasmLines(built.structuredContent.summary)).toEqual([
        "wasm: 0 B (no listed scene uses Rapier)",
      ]);
      expect(Array.isArray(built.structuredContent.issues)).toBe(true);
      expect(built.content.map((c) => c.type)).toEqual(["text"]);
      const json = JSON.stringify(built.structuredContent);
      expect(json).not.toMatch(/<!doctype/i);
      expect(json).not.toMatch(/"0":\d+,"1":\d+/);
      expect(json.length).toBeLessThan(256 * 1024);

      const manifestText = await readFile(join(out, "release.json"), "utf8");

      const checked = await callGame("game_manifest", { path: out });
      expect(checked.isError).toBe(false);
      expect(checked.structuredContent.exitCode).toBe(0);
      expect(checked.structuredContent).toHaveProperty("summary");
      expect(wasmLines(checked.structuredContent.summary)).toEqual(
        wasmLines(built.structuredContent.summary),
      );
      expect(checked.structuredContent.wasm).toEqual(built.structuredContent.wasm);
      expect(checked.structuredContent.manifest).toMatchObject({
        kind: "release",
        v: 1,
        project: { id: "tactics" },
        build: { target: "web", rapier: null },
      });

      const inline = await callGame("game_manifest", { path: JSON.parse(manifestText) });
      expect(inline.structuredContent.exitCode).toBe(0);
      expect(JSON.stringify(inline.structuredContent)).not.toContain(tmpdir());

      const broken = await callGame("game_manifest", { path: { kind: "release", v: 1 } });
      expect(broken.structuredContent.exitCode).toBeGreaterThan(0);
    },
  );

  it(
    "reports a target this engine doesn't build before bundling anything",
    { timeout: BUILD_TIMEOUT },
    async () => {
      const r = await callGame("game_build", {
        id: "tactics",
        target: "desktop",
        out: join(buildRoot, "tactics-desktop"),
      });
      expect(r.structuredContent.exitCode).toBe(1);
      expect((r.structuredContent.issues as { code: string }[]).map((i) => i.code)).toContain(
        "export-target-unsupported",
      );
    },
  );
});

describe("game releases", () => {
  const SITE = "https://staging.example.test";
  const SECRET = "jat_mcpReleaseTokenThatStaysHome";
  const PROJECT = "fixture";
  const ENV = { [AGENT_TOKEN_ENV]: SECRET, [AGENT_SITE_ENV]: SITE };
  const tool = (name: string) => MCP_TOOLS.find((t) => t.name === name)!;
  let releaseRoot: string;
  let buildDir: string;
  let planned: PlannedRelease;
  let projects: ToolContext["projects"];

  type Release = { version: number; id: string; totalBytes: number; fileCount: number };
  type FakeSite = {
    fetch: typeof fetch;
    requests: { method: string; url: string; auth: string | null; body: string | null }[];
    preview: number | null;
    production: number | null;
    releases: Release[];
  };

  const apiError = (status: number, code: string, message: string, hint?: string) =>
    Response.json({ code, message, ...(hint === undefined ? {} : { hint }) }, { status });

  const line = (quota: string, used: number, max: number) => ({
    quota,
    used,
    max,
    ratio: used / max,
    level: used / max >= 1 ? "full" : used / max >= 0.8 ? "warn" : "ok",
  });

  /** The site's release routes for one project and one agent token, in memory. */
  function fakeSite(): FakeSite {
    const held = new Set<string>();
    let upload: { id: string; releaseId: string; text: string; missing: Set<string> } | null = null;
    const site: FakeSite = {
      requests: [],
      preview: null,
      production: null,
      releases: [],
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input : input.url,
        );
        const method = init?.method ?? "GET";
        const auth = new Headers(init?.headers).get("authorization");
        const body =
          typeof init?.body === "string"
            ? init.body
            : init?.body instanceof Uint8Array
              ? `<${init.body.byteLength} bytes>`
              : null;
        site.requests.push({ method, url: url.href, auth, body });
        if (url.origin !== SITE) return apiError(404, "not-found", "Not found.");
        if (auth !== `Bearer ${SECRET}`)
          return apiError(401, "release-forbidden", "That agent token isn't valid.");
        const base = `/api/engine/projects/${PROJECT}/releases`;
        const json = () => JSON.parse(body ?? "{}") as Record<string, unknown>;
        const usageNow = () => [
          line("releaseStorageBytes", 430 * 1_048_576, 512 * 1_048_576),
          line("releasesPerDay", 1, 20),
        ];
        if (url.pathname === base && method === "POST") {
          const { manifest } = json() as { manifest: string };
          const parsed = JSON.parse(manifest) as {
            build: { files: { path: string; sha256: string; bytes: number }[] };
          };
          const missing = parsed.build.files.filter((f) => !held.has(f.sha256));
          upload = {
            id: "up-1",
            releaseId: planned.releaseId,
            text: manifest,
            missing: new Set(missing.map((f) => f.sha256)),
          };
          return Response.json({
            uploadId: upload.id,
            releaseId: upload.releaseId,
            version: null,
            missing,
            usage: { before: usageNow(), after: usageNow() },
          });
        }
        if (url.pathname === base && method === "GET") {
          return Response.json({
            releases: site.releases.map((r) => ({
              ...r,
              createdAt: "2026-11-12T00:00:00.000Z",
              engineVersion: planned.manifest.engine.version,
              target: "web",
              channels: [
                ...(site.preview === r.version ? ["preview"] : []),
                ...(site.production === r.version ? ["production"] : []),
              ],
              jams: [],
              firstPromotedAt: null,
              collectedAt: null,
              hidden: null,
              audience: "publishers",
              removalAt: null,
              playUrl: `${SITE}/games/${PROJECT}/play/${r.version}`,
            })),
          });
        }
        const put = /^\/api\/engine\/releases\/uploads\/([^/]+)\/files\/([0-9a-f]{64})$/.exec(
          url.pathname,
        );
        if (put && method === "PUT") {
          if (upload?.id !== put[1]) return apiError(404, "not-found", "No such upload.");
          held.add(put[2]!);
          upload.missing.delete(put[2]!);
          return new Response(null, { status: 204 });
        }
        if (url.pathname === `${base}/commit` && method === "POST") {
          if (upload === null) return apiError(404, "not-found", "No such upload.");
          if (upload.missing.size > 0)
            return apiError(409, "release-files-missing", `${upload.missing.size} files missing.`);
          const total = planned.manifest.build.files.reduce((n, f) => n + f.bytes, 0);
          const version = site.releases.length + 1;
          site.releases.unshift({
            version,
            id: upload.releaseId,
            totalBytes: total,
            fileCount: planned.manifest.build.files.length,
          });
          site.preview = version;
          return Response.json(
            {
              releaseId: upload.releaseId,
              version,
              created: true,
              playUrl: `${SITE}/games/${PROJECT}/play/${version}`,
            },
            { status: 201 },
          );
        }
        const move = /\/releases\/(?:(\d+)\/(promote|rollback)|(rollback))$/.exec(url.pathname);
        if (move && method === "POST" && url.pathname.startsWith(base)) {
          const { channel } = json() as { channel: string };
          if (channel === "production")
            return apiError(
              403,
              "release-forbidden",
              "Production releases are moved by a person on the game's page.",
              `${SITE}/games/${PROJECT}`,
            );
          const from = site.preview;
          const to = move[1] !== undefined ? Number(move[1]) : (from ?? 1) - 1;
          site.preview = to;
          return Response.json({ from, to });
        }
        return apiError(404, "not-found", "Not found.");
      }) as typeof globalThis.fetch,
    };
    return site;
  }

  const ctxFor = (site: FakeSite, env: Record<string, string> = ENV): ToolContext => ({
    projects,
    loadRapier: loadCompatRapier,
    env,
    fetch: site.fetch,
  });

  const run = async (name: string, input: Record<string, unknown>, ctx: ToolContext) =>
    (await runMcpTool(tool(name), input, ctx)) as Called;

  beforeAll(async () => {
    releaseRoot = await mkdtemp(join(tmpdir(), "scene-mcp-release-"));
    projects = [await tempProject(join(releaseRoot, PROJECT), { id: PROJECT })];
    planned = await plannedRelease({ projectId: PROJECT });
    buildDir = join(releaseRoot, "build");
    await mkdir(buildDir, { recursive: true });
    await writeFile(join(buildDir, "release.json"), planned.text);
    for (const [path, bytes] of planned.files) {
      await mkdir(dirname(join(buildDir, path)), { recursive: true });
      await writeFile(join(buildDir, path), bytes);
    }
  });

  afterAll(async () => {
    await rm(releaseRoot, { recursive: true, force: true });
  });

  it("asks for the agent token and site in the server's environment, sending nothing", async () => {
    for (const [env, says] of [
      [{ [AGENT_SITE_ENV]: SITE }, AGENT_TOKEN_ENV],
      [{ [AGENT_TOKEN_ENV]: SECRET }, AGENT_SITE_ENV],
      [{ [AGENT_TOKEN_ENV]: SECRET, [AGENT_SITE_ENV]: "ftp://example.test" }, AGENT_SITE_ENV],
    ] as const) {
      const site = fakeSite();
      for (const [name, input] of [
        ["game_release_create", { id: PROJECT, from: buildDir }],
        ["game_release_list", { id: PROJECT }],
        ["game_release_promote", { id: PROJECT, version: 1, channel: "preview" }],
        ["game_release_rollback", { id: PROJECT, channel: "preview" }],
      ] as const) {
        const r = await run(name, input, ctxFor(site, env));
        expect(r, name).toMatchObject({ isError: true, structuredContent: { exitCode: 2 } });
        expect(JSON.stringify(r), name).toContain(says);
      }
      expect(site.requests).toEqual([]);
    }
  });

  it("creates a release and returns its summary, never a file's bytes", async () => {
    const site = fakeSite();
    const r = await run("game_release_create", { id: PROJECT, from: buildDir }, ctxFor(site));
    expect(r.isError, JSON.stringify(r)).toBe(false);
    expect(r.structuredContent.exitCode).toBe(0);
    expect(site.preview).toBe(1);
    const json = JSON.stringify(r);
    expect(json).toContain(`${SITE}/games/${PROJECT}/play/1`);
    expect(json).toContain(planned.releaseId.slice(0, 6));
    expect(r.structuredContent).toMatchObject({
      version: 1,
      releaseId: planned.releaseId,
      playUrl: `${SITE}/games/${PROJECT}/play/1`,
      gamePage: `${SITE}/games/${PROJECT}`,
    });
    const summary = String(r.structuredContent.summary);
    expect(summary).toMatch(
      new RegExp(`^Released ${PROJECT} v1 \\(${planned.releaseId.slice(0, 6)}`),
    );
    expect(summary).toContain("release storage");
    expect(summary).toMatch(/^warning: release storage is 83% full/m);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain("export {};");
    for (const bytes of planned.files.values())
      if (bytes.byteLength >= 16) expect(json).not.toContain(Buffer.from(bytes).toString("base64"));
    expect(json.length).toBeLessThan(16_384);
    for (const req of site.requests) {
      expect(new URL(req.url).origin).toBe(SITE);
      expect(req.auth).toBe(`Bearer ${SECRET}`);
    }
    expect(site.requests.some((q) => q.method === "PUT")).toBe(true);

    const listed = await run("game_release_list", { id: PROJECT }, ctxFor(site));
    expect(listed.isError, JSON.stringify(listed)).toBe(false);
    expect(JSON.stringify(listed)).toContain(planned.releaseId.slice(0, 6));
  });

  it("refuses production and names the game's page, moving nothing", async () => {
    const site = fakeSite();
    site.releases = [
      { version: 2, id: "b".repeat(64), totalBytes: 10, fileCount: 1 },
      { version: 1, id: "a".repeat(64), totalBytes: 10, fileCount: 1 },
    ];
    site.preview = 2;
    for (const [name, input] of [
      ["game_release_promote", { id: PROJECT, version: 1, channel: "production" }],
      ["game_release_rollback", { id: PROJECT, channel: "production" }],
      ["game_release_create", { id: PROJECT, from: buildDir, channel: "production" }],
    ] as const) {
      const r = await run(name, input, ctxFor(site));
      expect(r.isError, name).toBe(true);
      expect(r.structuredContent.exitCode, name).toBeGreaterThanOrEqual(1);
      const json = JSON.stringify(r);
      expect(json, name).toMatch(/production/i);
      if (name !== "game_release_create") {
        expect(json, name).toContain("release-forbidden");
        expect(json, name).toContain(`${SITE}/games/${PROJECT}`);
      }
      expect(json, name).not.toContain(SECRET);
    }
    expect(site.production).toBe(null);
    expect(site.preview).toBe(2);
    expect(site.releases).toHaveLength(2);

    const promoted = await run(
      "game_release_promote",
      { id: PROJECT, version: 1, channel: "preview" },
      ctxFor(site),
    );
    expect(promoted.isError, JSON.stringify(promoted)).toBe(false);
    expect(site.preview).toBe(1);
  });
});
