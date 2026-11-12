// @vitest-environment node
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { docNameOf } from "@jams/engine/project";
import { createRegistry, formatScene } from "@jams/engine/scene";
import { listenSceneCollab, readFileProject, type ListeningSceneCollab } from "@jams/engine/vite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { platformerGame } from "../../../src/games/platformer";
import { runCli } from "../commands";
import type { ToolContext } from "../context";
import { openProject } from "../projects";
import { loadCompatRapier } from "../rapier-compat";
import { applyLive } from "../tools/apply-live";
import { tempProject } from "./fixtures";

const ENGINE = createRegistry();
const ENGINE_YARD = fileURLToPath(
  new URL("../../../packages/engine/scenes/engine-yard.json", import.meta.url),
);
const ENGINE_SCENES = fileURLToPath(new URL("../../../packages/engine/scenes", import.meta.url));

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
  await writeFile(
    join(dirs.engine, "jams.project.json"),
    JSON.stringify({ kind: "project", v: 1, id: "engine", name: "Engine", game: null }),
  );
  ctx = {
    projects: [
      await openProject(dirs.engine, { cacheDir: join(root, "cli-cache") }),
      await tempProject(dirs.platformer, { game: platformerGame }),
    ],
    loadRapier: loadCompatRapier,
  };
  server = await listenSceneCollab({
    projects: [await readFileProject(dirs.engine, { cacheDir: join(root, "cache") })],
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
      { ops: [{ op: "move", refs: ["crate"], by: [0.05, 0] }] },
      humanOrigin,
      ENGINE,
    );
    expect(own.ok).toBe(true);
    human.undo.commit({ before: [], after: [] });
    expect(human.undo.canUndo()).toBe(true);
    const crate = () => docToScene(human.doc).entities!.find((e) => e.id === "crate")!.shape;
    expect(crate()).toEqual(["circle", 12.05, 9.4, 0.2]);

    human.undo.undo();
    expect(crate()).toEqual(["circle", 12, 9.4, 0.2]);
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
    const file = join(root, "engine", "engine-yard.json");
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

  it("sends prefab ops as one project batch: the prefab doc and its file follow", async () => {
    const r = await applyLive(
      {
        scene: "engine-yard",
        ops: await opsFile({
          label: "Kit the crate",
          ops: [{ op: "createPrefab", refs: ["crate"], id: "crate-kit", at: [12, 9.4] }],
        }),
        url: server.url,
        agent: "claude",
      },
      ctx,
    );
    expect(r.exitCode, r.text).toBe(0);
    expect(r.data).toMatchObject({ written: true, project: "engine" });
    await until(
      () => (docToScene(human.doc).instances ?? []).some((i) => i.prefab === "crate-kit"),
      "the instance to reach the human",
    );
    expect(docToScene(human.doc).entities!.some((e) => e.id === "crate")).toBe(false);
    const prefab = join(root, "engine", "prefabs", "crate-kit.json");
    await until(
      () =>
        readFile(prefab, "utf8").then(
          (t) => JSON.parse(t).id === "crate-kit",
          () => false,
        ),
      "the prefab file",
    );
  });

  it("a dry run with prefab ops checks the prefab side and sends nothing", async () => {
    const before = formatScene(docToScene(human.doc)).text;
    const r = await applyLive(
      {
        scene: "engine-yard",
        ops: await opsFile({
          ops: [{ op: "createPrefab", refs: ["crate"], id: "crate-kit", at: [12, 9.4] }],
        }),
        url: server.url,
        dryRun: true,
      },
      ctx,
    );
    expect(r.exitCode, r.text).toBe(0);
    expect(r.data).toMatchObject({ dryRun: true, written: false });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(formatScene(docToScene(human.doc)).text).toBe(before);
  });

  it("refuses live-only flags without --live", async () => {
    const r = await runCli(["apply", "engine-yard", "--ops", "x.json", "--agent", "claude"], ctx);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/--agent needs --live/);
  });
});

describe("apply --live judges sprites against the project", { timeout: 60_000 }, () => {
  let sink: { dir: string; ctx: ToolContext; server: ListeningSceneCollab };

  beforeEach(async () => {
    const dir = join(root, "sink");
    await cp(ENGINE_SCENES, dir, { recursive: true });
    sink = {
      dir,
      ctx: {
        projects: [await openProject(dir, { cacheDir: join(root, "sink-cli-cache") })],
        loadRapier: loadCompatRapier,
      },
      server: await listenSceneCollab({
        projects: [await readFileProject(dir, { cacheDir: join(root, "sink-cache") })],
        debounceMs: 50,
        warn: () => undefined,
      }),
    };
  });

  afterEach(async () => {
    await sink.server.close();
  });

  const dryRun = async (batch: unknown) => {
    const r = await applyLive(
      { scene: "kitchen-sink", ops: await opsFile(batch), url: sink.server.url, dryRun: true },
      sink.ctx,
    );
    return { ...r, codes: (r.data as { issues?: { code: string }[] }).issues?.map((i) => i.code) };
  };

  it("reports an unknown atlas frame (exit 1) and a sprite with no asset (exit 0), writing nothing", async () => {
    const before = await readFile(join(sink.dir, "kitchen-sink.json"), "utf8");
    const frame = await dryRun({
      ops: [{ op: "update", ref: "crate", set: { "behaviors.sprite.frame": "crate-9" } }],
    });
    expect(frame.exitCode, frame.text).toBe(1);
    expect(frame.data).toMatchObject({ written: false });
    expect(frame.codes).toContain("asset-frame-unknown");

    const bare = await dryRun({
      ops: [{ op: "update", ref: "crate", unset: ["behaviors.sprite.asset"] }],
    });
    expect(bare.exitCode, bare.text).toBe(0);
    expect(bare.codes).toEqual(["sprite-no-asset"]);
    expect(await readFile(join(sink.dir, "kitchen-sink.json"), "utf8")).toBe(before);
  });
});
