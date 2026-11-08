// @vitest-environment node
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { docToScene, readLog, readProject, readProjectLog } from "@jams/engine/collab";
import { docNameOf } from "@jams/engine/project";
import { listenSceneCollab, readFileProject, type ListeningSceneCollab } from "@jams/engine/vite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { platformerGame } from "../../../src/games/platformer";
import type { ToolContext } from "../context";
import { AGENT_SITE_ENV, AGENT_TOKEN_ENV } from "../hosted";
import { createSceneMcpServer, MCP_SERVER_NAME } from "../mcp";
import { DEFAULT_MCP_AGENT_ID, MCP_TOOL_NAMES, MCP_TOOLS, runMcpTool } from "../mcp-tools";
import { loadCompatRapier } from "../rapier-compat";
import { tempProject } from "./fixtures";

const repoFile = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const ENGINE_YARD = repoFile("src/engine/scenes/engine-yard.json");
const ENGINE_YARD_CHECKS = repoFile("src/engine/scenes/engine-yard.checks.json");
const TEST_YARD = repoFile("src/games/platformer/scenes/test-yard.json");
const HOP_LEFT = repoFile("scripts/scene/examples/hop-left.json");
const DOT = repoFile("scripts/scene/examples/dot.png");
const SPRITES = repoFile("src/engine/scene/__tests__/fixtures/sprites.json");

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

const SLOW_LIFT = { ops: [{ op: "update", ref: "lift", set: { "path.speed": 30 } }] };

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
      "project_tree",
      "scene_apply_ops",
      "scene_check",
      "scene_codes",
      "scene_diff",
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
    };
    for (const t of tools) {
      expect(t.inputSchema.properties, t.name).toHaveProperty("project");
      if (t.name in writers) {
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

  it("lists, shows, and prints schemas and codes", async () => {
    const listed = await call("scene_list");
    expect(listed.isError).toBe(false);
    const names = (listed.structuredContent.scenes as { name: string }[]).map((s) => s.name);
    expect(names).toEqual(["engine-yard", "test-yard"]);
    expect(JSON.parse(listed.content[0]!.text!)).toEqual(
      expect.objectContaining({ scenes: listed.structuredContent.scenes }),
    );

    const shown = await call("scene_show", { scene: "engine-yard", near: [1200, 940, 30] });
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
    expect(lift.path.speed).toBe(30);
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
      box: { minX: 80, minY: 240, maxX: 112, maxY: 272 },
    });
    const shown = await call("scene_show", { scene: "sprites", ref: "lamp" });
    expect(shown.structuredContent.entities).toMatchObject([
      {
        ref: "lamp",
        sprite: { label: "lamp", aabb: { minX: 308, minY: 224, maxX: 332, maxY: 288 } },
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

  it("takes v3 ops in scene_apply_ops and shows the fields they set", async () => {
    const file = join(dirs.engine, "z-yard.json");
    const def = JSON.parse(await readFile(ENGINE_YARD, "utf8"));
    await writeFile(file, JSON.stringify({ ...def, name: "z-yard" }));
    try {
      const ops = await call("scene_schema", { which: "ops" });
      expect(ops.structuredContent.$id).toBe("urn:jams-engine:ops:v3");
      const batch = {
        ops: [
          { op: "useAssets", add: ["dot"] },
          { op: "setZ", refs: ["zone"], z: 3 },
          { op: "setGroup", id: "west", at: [200, 0] },
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
      expect(saved.groups.west).toMatchObject({ at: [200, 0], flip: true });

      const zone = await call("scene_show", { scene: "z-yard", ref: "zone" });
      expect(zone.structuredContent.entities).toEqual([expect.objectContaining({ z: 3 })]);
      const start = await call("scene_show", { scene: "z-yard", ref: "start" });
      expect(start.structuredContent.entities).toEqual([
        expect.objectContaining({ origin: [200, 0], transform: { rot: 0, flip: true } }),
      ]);
    } finally {
      await rm(file, { force: true });
    }
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
    expect(speedOf(human.doc)).toBe(80);

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
    await until(() => speedOf(human.doc) === 30, "the batch to reach the human");
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
