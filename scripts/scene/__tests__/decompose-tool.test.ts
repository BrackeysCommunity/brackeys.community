// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  docToScene,
  historyRows,
  readLog,
  readProjectLog,
  type DocOrigin,
  type SessionDoc,
} from "@jams/engine/collab";
import { listenSceneCollab, readFileProject, type ListeningSceneCollab } from "@jams/engine/vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { runCli } from "../commands";
import type { ToolContext } from "../context";
import { devContentStore, openProjectClient, type ProjectClient } from "../project-client";
import { loadCompatRapier } from "../rapier-compat";
import { copyProject, ENGINE_SCENES, tempProject } from "./fixtures";

const SCENE = "kitchen-sink";
const ELL = ["poly", 40, 0, 44, 0, 44, 1, 41, 1, 41, 3, 40, 3];
const SQUARE = ["poly", 50, 0, 52, 0, 52, 2, 50, 2];
const SEED = {
  label: "Seed shapes",
  ops: [
    { op: "add", entity: { id: "ell", type: "nav", shape: ELL } },
    { op: "add", entity: { id: "square", type: "nav", shape: SQUARE } },
  ],
};

async function seededProject(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const dir = join(root, "engine");
  await copyProject(ENGINE_SCENES, dir);
  const handle = await tempProject(dir, { id: "engine" });
  const ctx: ToolContext = { projects: [handle], loadRapier: loadCompatRapier };
  const seeded = await runCli(["apply", SCENE, "--ops", "-"], {
    ...ctx,
    readStdin: async () => JSON.stringify(SEED),
  });
  expect(seeded.exitCode, seeded.stdout + seeded.stderr).toBe(0);
  return { root, dir, handle, ctx, file: join(dir, `${SCENE}.json`) };
}

describe("scene decompose", { timeout: 60_000 }, () => {
  let env: Awaited<ReturnType<typeof seededProject>>;
  beforeEach(async () => {
    env = await seededProject("scene-decompose-");
    return () => rm(env.root, { recursive: true, force: true });
  });

  const ids = async () =>
    (JSON.parse(await readFile(env.file, "utf8")) as { entities: { id: string; type: string }[] })
      .entities;

  it("writes the pieces as one batch, reports their ids and the area, and the scene validates", async () => {
    const r = await runCli(["decompose", SCENE, "ell", "--json"], env.ctx);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    const data = JSON.parse(r.stdout) as {
      written: boolean;
      pieces: string[];
      area: number;
      piecesArea: number;
      batch: { ops: unknown[] };
    };
    expect(data.written).toBe(true);
    expect(data.pieces.length).toBeGreaterThanOrEqual(2);
    expect(data.pieces.every((id) => id.startsWith("ell-"))).toBe(true);
    expect(data.area).toBe(6);
    expect(data.piecesArea).toBe(6);
    const after = (await ids()).map((e) => e.id);
    expect(after).not.toContain("ell");
    for (const id of data.pieces) expect(after).toContain(id);
    const valid = await runCli(["validate", SCENE], env.ctx);
    expect(valid.exitCode, valid.stdout + valid.stderr).toBe(0);

    const text = await runCli(["decompose", SCENE, "ell-1"], env.ctx);
    expect(text.exitCode).toBe(1);
  });

  it("prints the pieces and the area check", async () => {
    const r = await runCli(["decompose", SCENE, "ell", "--dry-run"], env.ctx);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/pieces: ell-1, ell-2/);
    expect(r.stdout).toContain("area 6 → pieces 6 (preserved)");
    expect((await ids()).map((e) => e.id)).toContain("ell");
  });

  it("--group puts the pieces under one group", async () => {
    // a concave solid is already an error, which `apply` refuses, so it goes in as text
    const doc = JSON.parse(await readFile(env.file, "utf8")) as { entities: object[] };
    doc.entities.push({ id: "wall", type: "solid", shape: ELL });
    await writeFile(env.file, JSON.stringify(doc));
    const r = await runCli(["decompose", SCENE, "wall", "--group", "--json"], env.ctx);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    const { pieces } = JSON.parse(r.stdout) as { pieces: string[] };
    const entities = await ids();
    const groups = entities.filter((e) => pieces.includes(e.id) && e.type === "node");
    expect(groups).toHaveLength(1);
    expect(entities.some((e) => e.id === "wall" && e.type !== "node")).toBe(false);
    const valid = await runCli(["validate", SCENE], env.ctx);
    expect(valid.exitCode, valid.stdout + valid.stderr).toBe(0);
  });

  it("refuses --group for a type that can't be in the tree", async () => {
    const before = await readFile(env.file, "utf8");
    const r = await runCli(["decompose", SCENE, "ell", "--group"], env.ctx);
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain("parent-type");
    expect(await readFile(env.file, "utf8")).toBe(before);
  });

  it("refuses a convex or unknown poly with the issue, writing nothing", async () => {
    const before = await readFile(env.file, "utf8");
    const convex = await runCli(["decompose", SCENE, "square"], env.ctx);
    expect(convex.exitCode).toBe(1);
    expect(convex.stdout + convex.stderr).toContain("square");
    const missing = await runCli(["decompose", SCENE, "nobody"], env.ctx);
    expect(missing.exitCode).toBe(1);
    expect(await readFile(env.file, "utf8")).toBe(before);
    const bare = await runCli(["decompose", SCENE], env.ctx);
    expect(bare.exitCode).toBe(2);
  });
});

describe("scene decompose --live", { timeout: 60_000 }, () => {
  const HUMAN: DocOrigin = { kind: "user", userId: "ada", name: "Ada" };
  const AGENT = { kind: "agent", agentId: "cli-bot", onBehalfOf: "ada" };
  let env: Awaited<ReturnType<typeof seededProject>>;
  let server: ListeningSceneCollab;
  let human: ProjectClient;
  let held: SessionDoc;

  beforeAll(async () => {
    env = await seededProject("scene-decompose-live-");
    server = await listenSceneCollab({
      projects: [await readFileProject(env.dir, { cacheDir: join(env.root, "server-cache") })],
      debounceMs: 50,
      warn: () => undefined,
    });
    human = await openProjectClient({
      project: "engine",
      url: server.url,
      registry: env.handle.registry,
      kinds: env.handle.kinds,
      origin: HUMAN,
      store: devContentStore(server.url, "engine"),
    });
    const entry = human.session.view().byId.get(SCENE)!;
    held = await human.session.open(human.session.docNameFor(entry)!);
  });

  afterAll(async () => {
    if (held) human?.session.release(held.name);
    await human?.close();
    await server?.close();
    await rm(env.root, { recursive: true, force: true });
  });

  it("lands as one agent batch in the human's doc, off the human's undo stack", async () => {
    const agentRows = () =>
      historyRows(readLog(held.doc), readProjectLog(human.session.projectDoc), held.name).filter(
        (r) => JSON.stringify(r.actor) === JSON.stringify(AGENT),
      );
    const before = agentRows().length;
    const r = await runCli(
      [
        "decompose",
        SCENE,
        "ell",
        "--live",
        "--url",
        server.url,
        "--agent",
        "cli-bot",
        "--on-behalf-of",
        "ada",
        "--json",
      ],
      env.ctx,
    );
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    const data = JSON.parse(r.stdout) as { live: boolean; written: boolean; pieces: string[] };
    expect(data).toMatchObject({ live: true, written: true, actor: AGENT });

    const end = Date.now() + 8_000;
    const present = () => docToScene(held.doc).entities?.map((e) => e.id) ?? [];
    while (present().includes("ell")) {
      if (Date.now() > end) throw new Error("timed out waiting for the pieces");
      await new Promise((res) => setTimeout(res, 10));
    }
    for (const id of data.pieces) expect(present()).toContain(id);
    expect(agentRows().length - before).toBe(1);
    expect(human.session.canUndo()).toBe(false);
  });
});
