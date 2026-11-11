// @vitest-environment node
import { copyFile, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  docToPrefab,
  docToScene,
  historyRows,
  layoutFromDoc,
  readLog,
  readProjectLog,
  type DocOrigin,
  type SessionDoc,
} from "@jams/engine/collab";
import { defineEntityType, defineGame, gridField, pointField } from "@jams/engine/game";
import {
  assetInfo,
  type AssetEntry,
  type ProjectOpBatch,
  type ProjectView,
} from "@jams/engine/project";
import { readCell, type GridCells } from "@jams/engine/scene";
import { listenSceneCollab, readFileProject, type ListeningSceneCollab } from "@jams/engine/vite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { runCli } from "../commands";
import type { ToolContext } from "../context";
import { createSceneMcpServer } from "../mcp";
import { devContentStore, openProjectClient, type ProjectClient } from "../project-client";
import type { ProjectHandle } from "../projects";
import { loadCompatRapier } from "../rapier-compat";
import { tempProject } from "./fixtures";

const repoPath = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const ENGINE_SCENES = repoPath("src/engine/scenes");
const FIXTURES = repoPath("src/engine/project/__tests__/fixtures");

const PROJECT = "deck";
const HUMAN: DocOrigin = { kind: "user", userId: "ada", name: "Ada" };
const CLI_AGENT = { kind: "agent", agentId: "cli-bot", onBehalfOf: "ada" };
const MCP_AGENT = { kind: "agent", agentId: "claude", onBehalfOf: "ada" };

const PAINT = defineEntityType({
  type: "paint",
  description: "Cells painted on the scene's grid.",
  base: "marker",
  fields: {
    at: pointField("The grid's origin."),
    cells: gridField("The painted cells.", { values: ["red", "green", "blue"] }),
  },
});

/** A game with the card table and the settings the copied project's files use, a grid type, two actions, and nothing to play. */
const deckGame = defineGame({
  id: "deck-game",
  types: [PAINT],
  actions: [
    { action: "right", keys: ["d"], description: "Walk right." },
    { action: "fire", keys: [" "], description: "Fire." },
  ],
  tables: {
    card: {
      description: "Cards a deck holds.",
      row: { cost: z.number().int().min(0), damage: z.number().int().min(0).default(0) },
    },
  },
  projectSettings: {
    avatarSpeed: z.number().positive().default(300),
    title: z.string().optional(),
  },
  createRuntime: () => ({ snapshot: () => null }),
});

const SCRIPT_FILE = "kitchen-sink.script.json";
const INPUT_MAP = "input-map";
/** A scene of the deck game, so its grid type is there to paint. */
const TILES_ROOM = {
  v: 4,
  game: "deck-game",
  name: "tiles-room",
  bounds: [0, 0, 1200, 800],
  settings: { grid: { kind: "square", cell: [32, 32] } },
  instances: [
    { id: "post-a", prefab: "post", at: [200, 700] },
    { id: "post-b", prefab: "post", at: [400, 700] },
  ],
  entities: [{ id: "tiles", type: "paint", at: [600, 200], cells: {} }],
};
const SCRIPT = { v: 1, scene: "kitchen-sink", steps: [{ wait: 60 }] };

type Called = {
  content: { type: string; text?: string }[];
  structuredContent: Record<string, unknown> & { exitCode: number };
  isError?: boolean;
};
type Data = Record<string, unknown>;

let root: string;
let deck: string;
let ctx: ToolContext;
let handle: ProjectHandle;
let server: ListeningSceneCollab;
let mcpClient: Client;
let human: ProjectClient;
/** The docs the human has open, by asset id. */
const held = new Map<string, SessionDoc>();

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 8_000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A file's text, or "" while a write-back has it mid-move. */
async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

let files = 0;
async function jsonFile(value: unknown): Promise<string> {
  const file = join(root, `payload-${files++}.json`);
  await writeFile(file, JSON.stringify(value));
  return file;
}

/** A CLI writer on the dev server, as `cli-bot` for ada. */
async function cli(...argv: string[]): Promise<{ exitCode: number; data: Data }> {
  const r = await runCli(
    [
      ...argv,
      "--live",
      "--url",
      server.url,
      "--agent",
      "cli-bot",
      "--on-behalf-of",
      "ada",
      "--json",
    ],
    ctx,
  );
  return { exitCode: r.exitCode, data: JSON.parse(r.stdout) as Data };
}

/** An MCP writer on the dev server, as `claude` for ada, not a dry run. */
async function mcp(name: string, args: Record<string, unknown>): Promise<Called> {
  return (await mcpClient.callTool({
    name,
    arguments: {
      live: true,
      url: server.url,
      dryRun: false,
      agentId: "claude",
      onBehalfOf: "ada",
      ...args,
    },
  })) as Called;
}

const view = (): ProjectView => human.session.view();
const entryOf = (id: string): AssetEntry => {
  const entry = view().byId.get(id);
  if (!entry) throw new Error(`no asset ${id}`);
  return entry;
};

async function hold(id: string): Promise<void> {
  const name = human.session.docNameFor(entryOf(id));
  if (!name) throw new Error(`${id} has no doc`);
  held.set(id, await human.session.open(name));
}

function heldDoc(id: string): SessionDoc {
  const doc = held.get(id);
  if (!doc) throw new Error(`the human doesn't hold ${id}`);
  return doc;
}

/** A held doc's value as plain JSON, as the human's editor reads it. */
function valueOf(id: string): Record<string, unknown> {
  const d = heldDoc(id);
  if (d.layout) return layoutFromDoc(d.doc, d.layout);
  return (d.kind === "prefab" ? docToPrefab(d.doc) : docToScene(d.doc)) as Record<string, unknown>;
}

/** The newest row of a held doc's history panel: its own log merged with the project log. */
function lastRow(id: string) {
  const d = heldDoc(id);
  return historyRows(readLog(d.doc), readProjectLog(human.session.projectDoc), d.name).at(-1);
}

/** Waits for an edit to reach the human's doc, then checks its history row and the human's undo stack. */
async function landsInDoc(
  id: string,
  check: (value: Record<string, unknown>) => boolean,
  actor: object,
  what: string,
) {
  await until(() => check(valueOf(id)), what);
  expect(lastRow(id)?.actor, what).toEqual(actor);
  expect(human.session.canUndo(), what).toBe(false);
}

/** Waits for a registry edit to reach the human's project doc, then checks its project log entry. */
async function landsInRegistry(check: (view: ProjectView) => boolean, actor: object, what: string) {
  await until(() => check(view()), what);
  expect(readProjectLog(human.session.projectDoc).at(-1)?.actor, what).toEqual(actor);
  expect(human.session.canUndo(), what).toBe(false);
}

const editAsset = (id: string, edits: unknown[]) => ({
  v: 1,
  ops: [{ op: "editAsset", id, edits }],
});
const editScene = (id: string, ops: unknown[]) =>
  ({ v: 1, ops: [{ op: "editScene", id, ops }] }) as ProjectOpBatch;

const rows = (id: string) => valueOf(id).rows as { id: string; cost?: number; damage?: number }[];
const steps = (id: string) => valueOf(id).steps as Record<string, unknown>[];
const checks = (id: string) => valueOf(id).checks as { id: string; physical?: boolean }[];
const entity = (scene: Record<string, unknown>, id: string) =>
  (scene.entities as { id: string; density?: number; shape?: unknown }[]).find((e) => e.id === id);
const prefabEntity = (id: string) =>
  (valueOf("post").entities as { id: string; shape?: unknown; at?: unknown }[]).find(
    (e) => e.id === id,
  );

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-assets-live-"));
  deck = join(root, PROJECT);
  await cp(ENGINE_SCENES, deck, { recursive: true });
  await writeFile(join(deck, SCRIPT_FILE), `${JSON.stringify(SCRIPT)}\n`);
  await writeFile(join(deck, "tiles-room.json"), `${JSON.stringify(TILES_ROOM)}\n`);
  for (const name of [
    "texture.png",
    "texture.webp",
    "hero.json",
    "items.json",
    "font.fnt",
    "tone.ogg",
    "tone.mp3",
    "run.recording.json",
  ])
    await copyFile(join(FIXTURES, name), join(root, name));
  await copyFile(join(FIXTURES, "font.fnt"), join(root, "font2.fnt"));
  await copyFile(join(FIXTURES, "run.recording.json"), join(root, "run2.recording.json"));

  handle = await tempProject(deck, { id: PROJECT, game: deckGame });
  ctx = { projects: [handle], loadRapier: loadCompatRapier };
  server = await listenSceneCollab({
    projects: [await readFileProject(deck, { game: deckGame, cacheDir: handle.cacheDir })],
    debounceMs: 50,
    warn: () => undefined,
  });

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createSceneMcpServer(ctx).connect(serverSide);
  mcpClient = new Client({ name: "assets-live-test", version: "0" });
  await mcpClient.connect(clientSide);

  human = await openProjectClient({
    project: PROJECT,
    url: server.url,
    registry: handle.registry,
    kinds: handle.kinds,
    origin: HUMAN,
    store: devContentStore(server.url, PROJECT),
    prefabs: true,
  });
  const script = [...view().byId.values()].find((e) => e.path === SCRIPT_FILE)!;
  for (const id of [
    "kitchen-sink",
    "tiles-room",
    "post",
    "bouncy",
    "game-settings",
    "cards",
    script.id,
    "kitchen-sink-checks",
    "engine-yard-checks",
    INPUT_MAP,
  ])
    await hold(id);
});

afterAll(async () => {
  for (const d of held.values()) human?.session.release(d.name);
  await human?.close();
  await mcpClient?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
});

describe("a CLI and an MCP edit to every kind land in a human's docs and history", () => {
  it("scene: apply --live and scene_apply_ops", { timeout: 60_000 }, async () => {
    const ops = await jsonFile({ ops: [{ op: "update", ref: "crate", set: { density: 2 } }] });
    const viaCli = await cli("apply", "kitchen-sink", "--ops", ops);
    expect(viaCli.exitCode, JSON.stringify(viaCli.data)).toBe(0);
    await landsInDoc(
      "kitchen-sink",
      (s) => entity(s, "crate")?.density === 2,
      CLI_AGENT,
      "the CLI's scene edit",
    );

    const viaMcp = await mcp("scene_apply_ops", {
      scene: "kitchen-sink",
      ops: { ops: [{ op: "update", ref: "ball", set: { density: 3 } }] },
    });
    expect(viaMcp.structuredContent).toMatchObject({ exitCode: 0, written: true });
    await landsInDoc(
      "kitchen-sink",
      (s) => entity(s, "ball")?.density === 3,
      MCP_AGENT,
      "the MCP scene edit",
    );
  });

  it("prefab: editScene with definePrefab", { timeout: 60_000 }, async () => {
    const pole = (height: number) => ({
      id: "pole",
      type: "solid",
      shape: ["box", 0, -height, 10, height],
    });
    const cap = (y: number) => ({ id: "cap", type: "marker", at: [0, y], tags: ["top"] });
    const define = (height: number, y: number) =>
      editScene("kitchen-sink", [
        { op: "definePrefab", id: "post", prefab: { entities: [pole(height), cap(y)] } },
      ]);

    const viaCli = await cli("assets", "apply", "--ops", await jsonFile(define(70, -150)));
    expect(viaCli.exitCode, JSON.stringify(viaCli.data)).toBe(0);
    await landsInDoc(
      "post",
      () => JSON.stringify(prefabEntity("pole")?.shape) === '["box",0,-70,10,70]',
      CLI_AGENT,
      "the CLI's prefab edit",
    );

    const viaMcp = await mcp("asset_apply_ops", { ops: define(70, -160) });
    expect(viaMcp.structuredContent).toMatchObject({ exitCode: 0, written: true });
    await landsInDoc(
      "post",
      () => JSON.stringify(prefabEntity("cap")?.at) === "[0,-160]",
      MCP_AGENT,
      "the MCP prefab edit",
    );
  });

  it("scene: apply --live with paintCells and transform", { timeout: 60_000 }, async () => {
    const room = () => valueOf("tiles-room");
    const cell = (col: number, row: number) => {
      const tiles = entity(room(), "tiles") as { cells?: GridCells } | undefined;
      return tiles?.cells ? readCell(tiles.cells, col, row) : 0;
    };
    const instance = (id: string) =>
      (room().instances as { id: string; rot?: number; flip?: boolean }[]).find((i) => i.id === id);

    const viaCli = await cli(
      "apply",
      "tiles-room",
      "--ops",
      await jsonFile({
        ops: [
          { op: "paintCells", ref: "tiles", field: "cells", cells: [[0, 0, 1]] },
          { op: "paintCells", ref: "tiles", field: "cells", rects: [[31, 0, 33, 1, 2]] },
          { op: "transform", refs: ["post-a"], turn: 1 },
        ],
      }),
    );
    expect(viaCli.exitCode, JSON.stringify(viaCli.data)).toBe(0);
    await landsInDoc(
      "tiles-room",
      () =>
        cell(0, 0) === 1 && cell(31, 1) === 2 && cell(33, 0) === 2 && instance("post-a")?.rot === 1,
      CLI_AGENT,
      "the CLI's paintCells and transform",
    );

    const viaMcp = await mcp("scene_apply_ops", {
      scene: "tiles-room",
      ops: {
        ops: [
          {
            op: "paintCells",
            ref: "tiles",
            field: "cells",
            cells: [
              [0, 0, 0],
              [5, 40, 3],
            ],
          },
          { op: "transform", refs: ["post-b"], flip: "x" },
        ],
      },
    });
    expect(viaMcp.structuredContent).toMatchObject({ exitCode: 0, written: true });
    await landsInDoc(
      "tiles-room",
      () => cell(0, 0) === 0 && cell(5, 40) === 3 && instance("post-b")?.flip === true,
      MCP_AGENT,
      "the MCP paintCells and transform",
    );
    expect(cell(32, 1)).toBe(2);
    expect(instance("post-a")?.rot).toBe(1);
  });

  it("prefab: editScene with exposeParam", { timeout: 60_000 }, async () => {
    const params = () =>
      valueOf("post").params as Record<string, { targets: string[] }> | undefined;
    const viaCli = await cli(
      "assets",
      "apply",
      "--ops",
      await jsonFile(
        editScene("post", [
          {
            op: "exposeParam",
            name: "oneWay",
            param: {
              description: "The side things land on, for a one-way pole.",
              targets: ["pole.oneWay"],
            },
          },
        ]),
      ),
    );
    expect(viaCli.exitCode, JSON.stringify(viaCli.data)).toBe(0);
    await landsInDoc(
      "post",
      () => params()?.oneWay?.targets[0] === "pole.oneWay",
      CLI_AGENT,
      "the CLI's exposeParam",
    );

    const viaMcp = await mcp("asset_apply_ops", {
      ops: editScene("post", [
        {
          op: "exposeParam",
          name: "capTags",
          param: { description: "The cap's tags.", targets: ["cap.tags"] },
        },
      ]),
    });
    expect(viaMcp.structuredContent).toMatchObject({ exitCode: 0, written: true });
    await landsInDoc(
      "post",
      () => params()?.capTags !== undefined,
      MCP_AGENT,
      "the MCP exposeParam",
    );
    expect(Object.keys(params() ?? {}).sort()).toEqual(["capTags", "oneWay"]);
  });

  it(
    "material, game settings, data table, input script and checks: editAsset",
    {
      timeout: 60_000,
    },
    async () => {
      const scriptId = [...view().byId.values()].find((e) => e.path === SCRIPT_FILE)!.id;
      const cases: {
        id: string;
        cli: unknown[];
        mcp: unknown[];
        cliLanded: () => boolean;
        mcpLanded: () => boolean;
      }[] = [
        {
          id: "bouncy",
          cli: [{ set: "/physics", value: { friction: 0.4, restitution: 0.8 } }],
          mcp: [{ set: "/description", value: "Very bouncy rubber." }],
          cliLanded: () =>
            (valueOf("bouncy").physics as { restitution: number }).restitution === 0.8,
          mcpLanded: () => valueOf("bouncy").description === "Very bouncy rubber.",
        },
        {
          id: "game-settings",
          cli: [{ set: "/game/avatarSpeed", value: 250 }],
          mcp: [{ set: "/game/title", value: "Deck" }],
          cliLanded: () => (valueOf("game-settings").game as Data).avatarSpeed === 250,
          mcpLanded: () => (valueOf("game-settings").game as Data).title === "Deck",
        },
        {
          id: "cards",
          cli: [
            { insert: "/rows", value: { id: "shield", cost: 1 } },
            { set: "/rows/@heal/cost", value: 1 },
          ],
          mcp: [
            { insert: "/rows", value: { id: "bolt", cost: 2, damage: 2 }, before: "fireball" },
            { set: "/rows/@fireball/damage", value: 6 },
          ],
          cliLanded: () =>
            rows("cards").some((r) => r.id === "shield") &&
            rows("cards").find((r) => r.id === "heal")?.cost === 1,
          mcpLanded: () =>
            rows("cards")[0]?.id === "bolt" &&
            rows("cards").find((r) => r.id === "fireball")?.damage === 6,
        },
        {
          id: scriptId,
          cli: [{ insert: "/steps", value: { hold: ["right"], for: 10 } }],
          mcp: [{ set: "/steps/0", value: { wait: 30 } }],
          cliLanded: () => steps(scriptId).length === 2,
          mcpLanded: () => steps(scriptId)[0]?.wait === 30,
        },
        {
          id: "kitchen-sink-checks",
          cli: [{ set: "/checks/@valid/physical", value: false }],
          mcp: [
            {
              insert: "/checks",
              value: {
                id: "settles-long",
                kind: "reaches",
                result: "script-end",
                script: { v: 2, scene: "kitchen-sink", steps: [{ wait: 120 }] },
              },
            },
          ],
          cliLanded: () =>
            checks("kitchen-sink-checks").find((c) => c.id === "valid")?.physical === false,
          mcpLanded: () => checks("kitchen-sink-checks").some((c) => c.id === "settles-long"),
        },
      ];
      for (const c of cases) {
        const viaCli = await cli(
          "assets",
          "apply",
          "--ops",
          await jsonFile(editAsset(c.id, c.cli)),
        );
        expect(viaCli.exitCode, `${c.id}: ${JSON.stringify(viaCli.data)}`).toBe(0);
        await landsInDoc(c.id, c.cliLanded, CLI_AGENT, `the CLI's edit to ${c.id}`);

        const viaMcp = await mcp("asset_apply_ops", { ops: editAsset(c.id, c.mcp) });
        expect(viaMcp.structuredContent, c.id).toMatchObject({ exitCode: 0, written: true });
        await landsInDoc(c.id, c.mcpLanded, MCP_AGENT, `the MCP edit to ${c.id}`);
      }
    },
  );

  it(
    "input script: an agent's editAsset inserting a count step lands as the agent, off the human's undo stack",
    { timeout: 60_000 },
    async () => {
      const scriptId = [...view().byId.values()].find((e) => e.path === SCRIPT_FILE)!.id;
      const countStep = (eq: number) => ({ hold: [], until: { count: { type: "paint", eq } } });
      const hasCount = (eq: number) =>
        steps(scriptId).some(
          (s) => (s.until as { count?: { eq?: number } } | undefined)?.count?.eq === eq,
        );
      const first = () => steps(scriptId)[0];

      const own = await human.apply(
        editAsset(scriptId, [{ set: "/steps/0", value: { wait: 45 } }]) as ProjectOpBatch,
      );
      expect(own.ok).toBe(true);
      expect(first()).toEqual({ wait: 45 });
      expect(human.session.canUndo()).toBe(true);

      const viaCli = await cli(
        "assets",
        "apply",
        "--ops",
        await jsonFile(editAsset(scriptId, [{ insert: "/steps", value: countStep(1) }])),
      );
      expect(viaCli.exitCode, JSON.stringify(viaCli.data)).toBe(0);
      await until(() => hasCount(1), "the CLI's count step");
      expect(lastRow(scriptId)?.actor).toEqual(CLI_AGENT);

      const viaMcp = await mcp("asset_apply_ops", {
        ops: editAsset(scriptId, [{ insert: "/steps", value: countStep(0) }]),
      });
      expect(viaMcp.structuredContent).toMatchObject({ exitCode: 0, written: true });
      await until(() => hasCount(0), "the MCP count step");
      expect(lastRow(scriptId)?.actor).toEqual(MCP_AGENT);

      const unbounded = await mcp("asset_apply_ops", {
        ops: editAsset(scriptId, [
          { insert: "/steps", value: { hold: [], until: { count: { type: "paint" } } } },
        ]),
      });
      expect(unbounded.structuredContent).toMatchObject({ exitCode: 1, written: false });

      expect(human.session.canUndo()).toBe(true);
      human.session.undo();
      expect(first()).toEqual({ wait: 30 });
      expect(hasCount(1) && hasCount(0)).toBe(true);
      expect(human.session.canUndo()).toBe(false);

      await until(async () => {
        const text = await readOrEmpty(join(deck, SCRIPT_FILE));
        return text.includes('"eq": 0') && text.includes('"eq": 1');
      }, "the server to write the count steps back");
    },
  );

  it(
    "input map: an agent's editAsset inserting a binding lands as the agent, off the human's undo stack; an unknown code is refused",
    { timeout: 60_000 },
    async () => {
      type Action = { action: string; bindings: Record<string, unknown>[] };
      const fire = () =>
        (valueOf(INPUT_MAP).actions as Action[] | undefined)?.find((a) => a.action === "fire");
      const appendBinding = (binding: object) =>
        editAsset(INPUT_MAP, [{ insert: "/actions/@fire/bindings", value: binding }]);

      const viaCli = await cli(
        "assets",
        "apply",
        "--ops",
        await jsonFile(
          editAsset(INPUT_MAP, [
            {
              insert: "/actions",
              value: { action: "fire", bindings: [{ device: "key", code: "Space" }] },
            },
          ]),
        ),
      );
      expect(viaCli.exitCode, JSON.stringify(viaCli.data)).toBe(0);
      await landsInDoc(
        INPUT_MAP,
        () => fire()?.bindings.length === 1,
        CLI_AGENT,
        "the CLI's fire action",
      );

      const viaMcp = await mcp("asset_apply_ops", {
        ops: appendBinding({ device: "pad", button: "south" }),
      });
      expect(viaMcp.structuredContent).toMatchObject({ exitCode: 0, written: true });
      await landsInDoc(
        INPUT_MAP,
        () => fire()?.bindings.length === 2,
        MCP_AGENT,
        "the MCP fire binding",
      );
      expect(fire()?.bindings).toEqual([
        { device: "key", code: "Space" },
        { device: "pad", button: "south" },
      ]);

      const typo = appendBinding({ device: "key", code: "Spcae" });
      const badCli = await cli("assets", "apply", "--ops", await jsonFile(typo));
      expect(badCli.exitCode).toBe(1);
      expect(badCli.data).toMatchObject({ written: false, issue: { code: "binding-unknown" } });
      const badMcp = await mcp("asset_apply_ops", { ops: typo });
      expect(badMcp.structuredContent).toMatchObject({
        exitCode: 1,
        written: false,
        issue: { code: "binding-unknown" },
      });
      expect(fire()?.bindings).toHaveLength(2);
      expect(human.session.canUndo()).toBe(false);

      await until(async () => {
        const text = await readOrEmpty(join(deck, "input-map.json"));
        return text.includes('"action": "fire"') && text.includes('"button": "south"');
      }, "the server to write the fire bindings back");
    },
  );

  it(
    "game settings: editAsset of /engine/tickRate lands as the agent; a bad rate is refused",
    { timeout: 60_000 },
    async () => {
      const engine = () => valueOf("game-settings").engine as Data;
      const setRate = (value: unknown) =>
        editAsset("game-settings", [{ set: "/engine/tickRate", value }]);

      const viaCli = await cli("assets", "apply", "--ops", await jsonFile(setRate(30)));
      expect(viaCli.exitCode, JSON.stringify(viaCli.data)).toBe(0);
      await landsInDoc(
        "game-settings",
        () => engine().tickRate === 30,
        CLI_AGENT,
        "the CLI's tick rate",
      );

      const viaMcp = await mcp("asset_apply_ops", { ops: setRate(120) });
      expect(viaMcp.structuredContent).toMatchObject({ exitCode: 0, written: true });
      await landsInDoc(
        "game-settings",
        () => engine().tickRate === 120,
        MCP_AGENT,
        "the MCP tick rate",
      );

      const badCli = await cli("assets", "apply", "--ops", await jsonFile(setRate(0)));
      expect(badCli.exitCode).toBe(1);
      expect(badCli.data).toMatchObject({ written: false, issue: { code: "tick-rate-invalid" } });
      const badMcp = await mcp("asset_apply_ops", { ops: setRate(30.5) });
      expect(badMcp.structuredContent).toMatchObject({
        exitCode: 1,
        written: false,
        issue: { code: "tick-rate-invalid" },
      });
      expect(engine().tickRate).toBe(120);
      expect(human.session.canUndo()).toBe(false);

      const reset = await mcp("asset_apply_ops", {
        ops: editAsset("game-settings", [{ unset: "/engine/tickRate" }]),
      });
      expect(reset.structuredContent).toMatchObject({ exitCode: 0, written: true });
      await landsInDoc(
        "game-settings",
        () => !("tickRate" in engine()),
        MCP_AGENT,
        "the MCP unset of the tick rate",
      );
    },
  );

  it(
    "a material's render tint and blend, and a texture's import filter and pivot",
    { timeout: 60_000 },
    async () => {
      const render = () => valueOf("bouncy").render as Data;
      const tinted = await cli(
        "assets",
        "apply",
        "--ops",
        await jsonFile(editAsset("bouncy", [{ set: "/render/tint", value: "#ff8800" }])),
      );
      expect(tinted.exitCode, JSON.stringify(tinted.data)).toBe(0);
      await landsInDoc(
        "bouncy",
        () => render().tint === "#ff8800",
        CLI_AGENT,
        "the CLI's render.tint",
      );
      const blended = await mcp("asset_apply_ops", {
        ops: editAsset("bouncy", [{ set: "/render/blend", value: "add" }]),
      });
      expect(blended.structuredContent).toMatchObject({ exitCode: 0, written: true });
      await landsInDoc("bouncy", () => render().blend === "add", MCP_AGENT, "the MCP render.blend");
      expect(render()).toMatchObject({ tint: "#ff8800", blend: "add", style: { fill: "#e05a5a" } });

      const imported = await cli(
        "assets",
        "import",
        join(root, "texture.png"),
        "--path",
        "sprites/",
        "--id",
        "sprite-art",
        "--kind",
        "texture",
      );
      expect(imported.exitCode, JSON.stringify(imported.data)).toBe(0);
      await landsInRegistry(
        (v) => v.byId.get("sprite-art")?.kind === "texture",
        CLI_AGENT,
        "the sprite texture's import",
      );
      const filtered = await cli("assets", "set-import", "sprite-art", "--set", "filter=nearest");
      expect(filtered.exitCode, JSON.stringify(filtered.data)).toBe(0);
      await landsInRegistry(
        (v) => v.byId.get("sprite-art")?.import?.filter === "nearest",
        CLI_AGENT,
        "the CLI's filter",
      );
      const pivoted = await mcp("asset_apply_ops", {
        ops: { v: 1, ops: [{ op: "setImport", id: "sprite-art", set: { pivot: [0.5, 1] } }] },
      });
      expect(pivoted.structuredContent).toMatchObject({ exitCode: 0, written: true });
      await landsInRegistry(
        (v) => JSON.stringify(v.byId.get("sprite-art")?.import?.pivot) === "[0.5,1]",
        MCP_AGENT,
        "the MCP pivot",
      );
      expect(entryOf("sprite-art").import).toEqual({ filter: "nearest", pivot: [0.5, 1] });
      expect(assetInfo(view(), "sprite-art")).toMatchObject({
        size: [12, 10],
        filter: "nearest",
        pivot: [0.5, 1],
      });
    },
  );

  it(
    "texture, atlas, font, audio, recording: importAsset and replaceContent",
    {
      timeout: 120_000,
    },
    async () => {
      const store = devContentStore(server.url, PROJECT);
      const blobs = [
        { kind: "texture", folder: "imported/", cli: "texture.png", mcp: "texture.webp" },
        { kind: "atlas", folder: "imported/", cli: "hero.json", mcp: "items.json" },
        { kind: "font", folder: "fonts/", cli: "font.fnt", mcp: "font2.fnt" },
        { kind: "audio", folder: "sfx/", cli: "tone.ogg", mcp: "tone.mp3" },
        {
          kind: "recording",
          folder: "runs/",
          cli: "run.recording.json",
          mcp: "run2.recording.json",
        },
      ];
      for (const b of blobs) {
        const cliId = `${b.kind}-cli`;
        const mcpId = `${b.kind}-mcp`;
        // An atlas export is told by its meta.app, so it needs no kind.
        const named = b.kind !== "atlas";
        const imported = await cli(
          "assets",
          "import",
          join(root, b.cli),
          "--path",
          b.folder,
          "--id",
          cliId,
          ...(named ? ["--kind", b.kind] : []),
        );
        expect(imported.exitCode, `${b.kind}: ${JSON.stringify(imported.data)}`).toBe(0);
        await landsInRegistry(
          (v) => v.byId.get(cliId)?.kind === b.kind,
          CLI_AGENT,
          `the CLI's ${b.kind} import`,
        );

        const viaMcp = await mcp("asset_import", {
          file: join(root, b.mcp),
          path: b.folder,
          id: mcpId,
          ...(named ? { kind: b.kind } : {}),
        });
        expect(viaMcp.structuredContent, b.kind).toMatchObject({ exitCode: 0, written: true });
        await landsInRegistry(
          (v) => v.byId.get(mcpId)?.kind === b.kind,
          MCP_AGENT,
          `the MCP ${b.kind} import`,
        );

        for (const [id, via] of [
          [cliId, "cli"],
          [mcpId, "mcp"],
        ] as const) {
          const before = entryOf(id).sha256;
          const original = await readFile(join(root, via === "cli" ? b.cli : b.mcp));
          const bytes = new Uint8Array(
            Buffer.concat([original, Buffer.from(via === "cli" ? "\n" : "\n\n")]),
          );
          const sha256 = await store.put(bytes);
          const op = { op: "replaceContent", id, sha256, bytes: bytes.byteLength };
          const result =
            via === "cli"
              ? await cli("assets", "apply", "--ops", await jsonFile({ v: 1, ops: [op] }))
              : await mcp("asset_apply_ops", { ops: { v: 1, ops: [op] } }).then((r) => ({
                  exitCode: r.structuredContent.exitCode,
                  data: r.structuredContent,
                }));
          if (b.kind === "recording") {
            expect(result.exitCode, `${via} replace of a recording`).toBe(1);
            expect(result.data).toMatchObject({ written: false, issue: { code: "asset-kind" } });
            expect(entryOf(id).sha256).toBe(before);
            continue;
          }
          expect(result.exitCode, `${via} ${b.kind}: ${JSON.stringify(result.data)}`).toBe(0);
          await landsInRegistry(
            (v) => v.byId.get(id)?.sha256 === sha256,
            via === "cli" ? CLI_AGENT : MCP_AGENT,
            `the ${via} replace of ${id}`,
          );
          expect(human.session.state().history[entryOf(id).key]?.map((h) => h.sha256)).toContain(
            before,
          );
        }
      }
    },
  );

  it("registry: renameAsset and changeAssetId", { timeout: 60_000 }, async () => {
    const renamed = await cli("assets", "rename", "gate", "--name", "Gate");
    expect(renamed.exitCode, JSON.stringify(renamed.data)).toBe(0);
    await landsInRegistry(
      (v) => v.byId.get("gate")?.name === "Gate",
      CLI_AGENT,
      "the CLI's rename",
    );
    const viaMcp = await mcp("asset_apply_ops", {
      ops: { v: 1, ops: [{ op: "renameAsset", id: "cards", name: "Cards" }] },
    });
    expect(viaMcp.structuredContent).toMatchObject({ exitCode: 0, written: true });
    await landsInRegistry(
      (v) => v.byId.get("cards")?.name === "Cards",
      MCP_AGENT,
      "the MCP rename",
    );

    const changed = await cli("assets", "change-id", "gate", "door");
    expect(changed.exitCode, JSON.stringify(changed.data)).toBe(0);
    const prefabsOf = (s: Record<string, unknown>) =>
      (s.instances as { prefab: string }[]).map((i) => i.prefab);
    await landsInDoc(
      "kitchen-sink",
      (s) => prefabsOf(s).includes("door") && !prefabsOf(s).includes("gate"),
      CLI_AGENT,
      "the CLI's change-id",
    );
    expect(view().byId.has("door")).toBe(true);
    expect(readProjectLog(human.session.projectDoc).at(-1)?.actor).toEqual(CLI_AGENT);

    const viaMcpId = await mcp("asset_apply_ops", {
      ops: { v: 1, ops: [{ op: "changeAssetId", id: "engine-yard", to: "yard" }] },
    });
    expect(viaMcpId.structuredContent).toMatchObject({ exitCode: 0, written: true });
    await landsInDoc(
      "engine-yard-checks",
      (v) =>
        JSON.stringify(v).includes('"scene":"yard"') && !JSON.stringify(v).includes("engine-yard"),
      MCP_AGENT,
      "the MCP change-id",
    );
    expect(view().byId.get("yard")?.kind).toBe("scene");
  });

  it(
    "stays off the human's undo stack, which keeps the human's own edits",
    {
      timeout: 30_000,
    },
    async () => {
      expect(human.session.canUndo()).toBe(false);
      const own = await human.apply(
        editScene("kitchen-sink", [{ op: "move", refs: ["crate"], by: [0.05, 0] }]),
      );
      expect(own.ok).toBe(true);
      expect(human.session.canUndo()).toBe(true);
      const crateX = () => (entity(valueOf("kitchen-sink"), "crate")!.shape as number[])[1];
      expect(crateX()).toBe(8.85);
      human.session.undo();
      expect(crateX()).toBe(8.8);
      expect(entity(valueOf("kitchen-sink"), "crate")?.density).toBe(2);
      expect(human.session.canUndo()).toBe(false);
    },
  );
});

describe("an agent renames an asset over MCP while a human edits a scene using it", () => {
  it(
    "lands both edits and leaves nothing dangling, live and on disk",
    { timeout: 60_000 },
    async () => {
      const [rename, own] = await Promise.all([
        mcp("asset_apply_ops", {
          ops: {
            v: 1,
            label: "Rename the post",
            ops: [{ op: "renameAsset", id: "post", name: "Pillar", file: "pillar.json" }],
          },
        }),
        human.apply(
          editScene("kitchen-sink", [
            { op: "instantiate", instance: { id: "post-3", prefab: "post", at: [1500, 1160] } },
          ]),
        ),
      ]);
      expect(rename.structuredContent).toMatchObject({ exitCode: 0, written: true });
      expect(own.ok).toBe(true);

      await until(
        () => entryOf("post").path === "prefabs/pillar.json",
        "the rename to reach the human",
      );
      expect(entryOf("post").name).toBe("Pillar");
      const instances = valueOf("kitchen-sink").instances as { id: string; prefab: string }[];
      expect(instances.find((i) => i.id === "post-3")?.prefab).toBe("post");

      const refs = (await mcpClient.callTool({
        name: "asset_refs",
        arguments: { id: "post", live: true, url: server.url },
      })) as Called;
      expect(refs.structuredContent).toMatchObject({
        exitCode: 0,
        live: true,
        asset: { id: "post", path: "prefabs/pillar.json", deleted: false },
        dangling: [],
      });
      const referrers = refs.structuredContent.referrers as { id: string; pointer: string }[];
      expect(referrers.filter((r) => r.id === "kitchen-sink")).toHaveLength(3);
      const all = await runCli(
        ["project", "refs", "--live", "--url", server.url, "--project", PROJECT, "--json"],
        ctx,
      );
      expect(all.exitCode, all.stdout).toBe(0);
      expect(JSON.parse(all.stdout)).toMatchObject({ live: true, dangling: [] });

      await until(
        async () =>
          (await readOrEmpty(join(deck, "kitchen-sink.json"))).includes('"post-3"') &&
          (await readOrEmpty(join(deck, "prefabs/pillar.json"))) !== "",
        "the server to write both edits back",
      );
      const onDisk = (await mcpClient.callTool({
        name: "asset_refs",
        arguments: { project: PROJECT },
      })) as Called;
      expect(onDisk.structuredContent).toMatchObject({ exitCode: 0, dangling: [] });
    },
  );
});
