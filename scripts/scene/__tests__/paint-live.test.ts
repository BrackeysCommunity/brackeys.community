// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  docToScene,
  historyRows,
  readLog,
  readProjectLog,
  type DocOrigin,
  type SessionDoc,
} from "@jams/engine/collab";
import { readCell, type GridCells } from "@jams/engine/scene";
import { listenSceneCollab, readFileProject, type ListeningSceneCollab } from "@jams/engine/vite";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { runCli } from "../commands";
import type { ToolContext } from "../context";
import { devContentStore, openProjectClient, type ProjectClient } from "../project-client";
import { loadCompatRapier } from "../rapier-compat";
import { copyProject, tempProject } from "./fixtures";

const ENGINE_SCENES = fileURLToPath(new URL("../../../packages/engine/scenes", import.meta.url));
const HUMAN: DocOrigin = { kind: "user", userId: "ada", name: "Ada" };
const AGENT = { kind: "agent", agentId: "cli-bot", onBehalfOf: "ada" };
const SCENE = "kitchen-sink";

let root: string;
let ctx: ToolContext;
let server: ListeningSceneCollab;
let human: ProjectClient;
let held: SessionDoc;

async function until(check: () => boolean, what: string, ms = 8_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const cell = (col: number, row: number) => {
  const map = docToScene(held.doc).entities?.find((e) => e.id === "tiles");
  return map?.cells ? readCell(map.cells as GridCells, col, row) : 0;
};
const rows = () =>
  historyRows(readLog(held.doc), readProjectLog(human.session.projectDoc), held.name);
const agentRows = () => rows().filter((r) => JSON.stringify(r.actor) === JSON.stringify(AGENT));

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-paint-live-"));
  const dir = join(root, "engine");
  await copyProject(ENGINE_SCENES, dir);
  const handle = await tempProject(dir, { id: "engine" });
  ctx = { projects: [handle], loadRapier: loadCompatRapier };
  server = await listenSceneCollab({
    projects: [await readFileProject(dir, { cacheDir: join(root, "server-cache") })],
    debounceMs: 50,
    warn: () => undefined,
  });
  human = await openProjectClient({
    project: "engine",
    url: server.url,
    registry: handle.registry,
    kinds: handle.kinds,
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
  await rm(root, { recursive: true, force: true });
});

describe("scene paint --live", () => {
  it(
    "lands as one batch in the human's doc and history as the agent, off the human's undo stack, while the human paints another chunk",
    { timeout: 60_000 },
    async () => {
      const before = agentRows().length;
      const [viaCli, own] = await Promise.all([
        runCli(
          [
            "paint",
            SCENE,
            "tiles",
            "--rect",
            "0,4,3,5=moss",
            "--rect",
            "0,6,0,6=plank",
            "--rect",
            "1,6,1,6=lamp",
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
        ),
        human.apply({
          v: 1,
          label: "Paint far away",
          ops: [
            {
              op: "editScene",
              id: SCENE,
              ops: [{ op: "paintCells", ref: "tiles", field: "cells", cells: [[200, 200, 3]] }],
            },
          ],
        }),
      ]);
      expect(viaCli.exitCode, viaCli.stdout + viaCli.stderr).toBe(0);
      expect(JSON.parse(viaCli.stdout)).toMatchObject({ live: true, written: true, actor: AGENT });
      expect(own.ok).toBe(true);

      await until(() => cell(3, 5) === 2 && cell(1, 6) === 4, "the agent's cells");
      expect(cell(0, 6)).toBe(3);
      expect(cell(200, 200)).toBe(3);
      expect(agentRows().length - before).toBe(1);
      expect(agentRows().at(-1)?.actor).toEqual(AGENT);

      expect(human.session.canUndo()).toBe(true);
      human.session.undo();
      expect(cell(200, 200)).toBe(0);
      expect(cell(3, 5)).toBe(2);
      expect(human.session.canUndo()).toBe(false);
    },
  );

  it("autotiles and fills against the doc as the server has it", { timeout: 60_000 }, async () => {
    const live = (...args: string[]) =>
      runCli(
        [
          "paint",
          SCENE,
          "tiles",
          ...args,
          "--live",
          "--url",
          server.url,
          "--agent",
          "cli-bot",
          "--on-behalf-of",
          "ada",
        ],
        ctx,
      );
    const auto = await live("--auto", "moss-top 0,8,2,9");
    expect(auto.exitCode, auto.stdout + auto.stderr).toBe(0);
    await until(() => cell(0, 9) === 1 && cell(2, 8) === 2, "the autotiled cells");
    const fill = await live("--fill", "0,4=stone");
    expect(fill.exitCode, fill.stdout + fill.stderr).toBe(0);
    await until(() => cell(3, 5) === 1, "the filled cells");
    expect(cell(0, 6)).toBe(3);
    expect(human.session.canUndo()).toBe(false);
  });
});
