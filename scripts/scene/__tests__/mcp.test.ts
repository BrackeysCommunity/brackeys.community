// @vitest-environment node
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { docToScene, readLog } from "@jams/engine/collab";
import { createRegistry } from "@jams/engine/scene";
import { listenSceneCollab, sceneDocName, type ListeningSceneCollab } from "@jams/engine/vite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import type { ToolContext } from "../context";
import { GAMES } from "../games";
import { createSceneMcpServer, MCP_SERVER_NAME } from "../mcp";
import { DEFAULT_MCP_AGENT_ID, MCP_TOOL_NAMES } from "../mcp-tools";
import { loadCompatRapier } from "../rapier-compat";

const repoFile = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const ENGINE_YARD = repoFile("src/engine/scenes/engine-yard.json");
const ENGINE_YARD_CHECKS = repoFile("src/engine/scenes/engine-yard.checks.json");
const TEST_YARD = repoFile("src/games/platformer/scenes/test-yard.json");
const HOP_LEFT = repoFile("scripts/scene/examples/hop-left.json");

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
  const ctx: ToolContext = { games: GAMES, scenesDirs: dirs, loadRapier: loadCompatRapier };
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
    for (const t of tools) {
      if (t.name === "scene_apply_ops") {
        expect(t.annotations).toMatchObject({
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        });
        expect(t.inputSchema.properties?.dryRun).toMatchObject({ default: true });
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
});

describe("live docs", () => {
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
    server = await listenSceneCollab({
      homes: [{ dir: liveDir, registry: createRegistry() }],
      debounceMs: 50,
      warn: () => undefined,
    });
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: server.url,
      name: sceneDocName("engine-yard"),
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

  it("refuses a collab server that isn't local", async () => {
    const r = await call("scene_show", {
      scene: "engine-yard",
      live: true,
      url: "ws://192.0.2.1:3000/__scene-collab",
    });
    expect(r).toMatchObject({ isError: true, structuredContent: { exitCode: 2 } });
  });
});
