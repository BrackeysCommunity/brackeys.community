// @vitest-environment node
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { HocuspocusProvider } from "@hocuspocus/provider";
import {
  applyOpsToDoc,
  createSceneUndo,
  docToScene,
  readLog,
  type SceneOrigin,
  type SceneUndo,
} from "@jams/engine/collab";
import { createRegistry, formatScene } from "@jams/engine/scene";
import { listenSceneCollab, sceneDocName, type ListeningSceneCollab } from "@jams/engine/vite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { runCli } from "../commands";
import type { ToolContext } from "../context";
import { GAMES } from "../games";
import { loadCompatRapier } from "../rapier-compat";
import { applyLive } from "../tools/apply-live";

const ENGINE = createRegistry();
const ENGINE_YARD = fileURLToPath(
  new URL("../../../src/engine/scenes/engine-yard.json", import.meta.url),
);

let root: string;
let server: ListeningSceneCollab;
let ctx: ToolContext;
let human: { doc: Y.Doc; provider: HocuspocusProvider; undo: SceneUndo };
const humanOrigin: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 5_000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const speedOf = (doc: Y.Doc) =>
  (docToScene(doc).entities!.find((e) => e.id === "lift")!.path as { speed: number }).speed;

async function opsFile(batch: unknown): Promise<string> {
  const file = join(root, `ops-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(file, JSON.stringify(batch));
  return file;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-live-"));
  const dirs = { engine: join(root, "engine"), platformer: join(root, "platformer") };
  await mkdir(dirs.engine);
  await mkdir(dirs.platformer);
  await copyFile(ENGINE_YARD, join(dirs.engine, "engine-yard.json"));
  ctx = { games: GAMES, scenesDirs: dirs, loadRapier: loadCompatRapier };
  server = await listenSceneCollab({
    homes: [{ dir: dirs.engine, registry: ENGINE }],
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
  human = { doc, provider, undo: createSceneUndo(doc, humanOrigin) };
});

afterEach(async () => {
  human.undo.destroy();
  human.provider.destroy();
  await server.close();
  await rm(root, { recursive: true, force: true });
});

describe("apply --live", () => {
  it("lands in the human's doc and history as the agent, off the human's undo stack", async () => {
    const ops = await opsFile({
      label: "Slow the lift",
      ops: [{ op: "update", ref: "lift", set: { "path.speed": 30 } }],
    });
    const r = await applyLive(
      { scene: "engine-yard", ops, url: server.url, agent: "claude", onBehalfOf: "ada" },
      ctx,
    );
    expect(r.exitCode, r.text).toBe(0);
    expect(r.data).toMatchObject({
      scene: "engine-yard",
      live: true,
      written: true,
      actor: { kind: "agent", agentId: "claude", onBehalfOf: "ada" },
    });

    await until(() => speedOf(human.doc) === 30, "the batch to reach the human");
    const entry = readLog(human.doc).at(-1)!;
    expect(entry.actor).toEqual({ kind: "agent", agentId: "claude", onBehalfOf: "ada" });
    expect(entry.label).toBe("Slow the lift");
    expect(human.undo.canUndo()).toBe(false);

    const own = applyOpsToDoc(
      human.doc,
      { ops: [{ op: "move", refs: ["crate"], by: [5, 0] }] },
      humanOrigin,
      ENGINE,
    );
    expect(own.ok).toBe(true);
    human.undo.commit({ before: [], after: [] });
    expect(human.undo.canUndo()).toBe(true);
    const crate = () => docToScene(human.doc).entities!.find((e) => e.id === "crate")!.shape;
    expect(crate()).toEqual(["circle", 1205, 940, 20]);

    human.undo.undo();
    expect(crate()).toEqual(["circle", 1200, 940, 20]);
    expect(speedOf(human.doc)).toBe(30);
    expect(human.undo.canUndo()).toBe(false);
  });

  it("is written back to the file by the server", async () => {
    const ops = await opsFile({ ops: [{ op: "update", ref: "lift", set: { "path.speed": 45 } }] });
    const r = await runCli(
      ["apply", "engine-yard", "--live", "--ops", ops, "--url", server.url, "--json"],
      ctx,
    );
    expect(r.exitCode, r.stdout).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({
      live: true,
      written: true,
      actor: { agentId: "scene-cli" },
    });
    const file = join(ctx.scenesDirs.engine!, "engine-yard.json");
    await until(
      async () =>
        JSON.parse(await readFile(file, "utf8")).entities.find(
          (e: { id: string }) => e.id === "lift",
        ).path.speed === 45,
      "the store",
    );
    expect(await readFile(file, "utf8")).toBe(formatScene(docToScene(human.doc)).text);
  });

  it("resolves bulk refs against the live doc with no base, and checks one it brings", async () => {
    const live = await applyLive(
      {
        scene: "engine-yard",
        ops: await opsFile({ ops: [{ op: "remove", refs: ["~solid:0"] }] }),
        url: server.url,
      },
      ctx,
    );
    expect(live.exitCode, live.text).toBe(0);
    const stale = await applyLive(
      {
        scene: "engine-yard",
        ops: await opsFile({
          base: "0000000000000000",
          ops: [{ op: "remove", refs: ["~solid:0"] }],
        }),
        url: server.url,
      },
      ctx,
    );
    expect(stale.exitCode).toBe(1);
    expect(stale.data).toMatchObject({ written: false, issue: { code: "stale-base" } });
  });

  it("changes nothing on a dry run or a failing batch", async () => {
    const before = formatScene(docToScene(human.doc)).text;
    const dry = await applyLive(
      {
        scene: "engine-yard",
        ops: await opsFile({ ops: [{ op: "update", ref: "lift", set: { "path.speed": 10 } }] }),
        url: server.url,
        dryRun: true,
      },
      ctx,
    );
    expect(dry.exitCode, dry.text).toBe(0);
    expect(dry.data).toMatchObject({ dryRun: true, written: false });
    const bad = await applyLive(
      {
        scene: "engine-yard",
        ops: await opsFile({ ops: [{ op: "remove", refs: ["nope"] }] }),
        url: server.url,
      },
      ctx,
    );
    expect(bad.exitCode).toBe(1);
    await new Promise((r) => setTimeout(r, 100));
    expect(formatScene(docToScene(human.doc)).text).toBe(before);
    expect(readLog(human.doc)).toEqual([]);
  });

  it("fails fast on a scene the server doesn't have or a server that isn't there", async () => {
    const ops = await opsFile({ ops: [] });
    const missing = await applyLive({ scene: "nope", ops, url: server.url }, ctx);
    expect(missing.exitCode).toBe(1);
    expect(missing.text).toMatch(/no scene named "nope"/);
    const down = await applyLive(
      { scene: "engine-yard", ops, url: "ws://127.0.0.1:9/__scene-collab", timeoutMs: 2_000 },
      ctx,
    );
    expect(down.exitCode).toBe(1);
    expect(down.text).toMatch(/Can't reach/);
  });

  it("refuses live-only flags without --live", async () => {
    const r = await runCli(["apply", "engine-yard", "--ops", "x.json", "--agent", "claude"], ctx);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/--agent needs --live/);
  });
});
