// @vitest-environment node
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { applyOpsToDoc, readProject } from "@jams/engine/collab";
import { memoryContentStore, PROJECT_FILE } from "@jams/engine/project";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { tacticsGame } from "../../../src/games/tactics";
import { runCli } from "../commands";
import type { ToolContext } from "../context";
import { openProject, type ProjectHandle } from "../projects";
import { loadCompatRapier } from "../rapier-compat";
import { tempProject } from "./fixtures";
import { hostedSite } from "./fixtures/hosted-site";

vi.mock("@/db", () => ({ db: {} }));

const ENGINE_SCENES = fileURLToPath(new URL("../../../packages/engine/scenes", import.meta.url));
const TACTICS = fileURLToPath(new URL("../../../src/games/tactics", import.meta.url));
const SITE = "https://staging.example.test";
const TOKEN = "jat_pullTestSecret";
const PROJECT = "deck";
const RUBBER = { kind: "material", v: 1, description: "Bouncy." };

/** A 1×1 PNG. */
const DOT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** The ids the site has reserved, with the names it gave them. */
const RESERVED: Record<string, string> = { [PROJECT]: "Deck", tactics: "Tactics" };

let root: string;
let deck: string;
let project: ProjectHandle;
let ctx: ToolContext;
const site = hostedSite({
  token: TOKEN,
  reserved: RESERVED,
  handle: (id) => ctx.projects.find((p) => p.file.id === id)!,
});
const { requests, uploads } = site;
const hostedProjects = site.projects;
const deckHosted = () => hostedProjects.get(PROJECT)!;

/** Every file under `dir` but the project file, by relative path. */
async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = relative(dir, join(entry.parentPath, entry.name)).split("\\").join("/");
    if (path !== PROJECT_FILE) out[path] = (await readFile(join(dir, path))).toString("base64");
  }
  return out;
}

/** Every binary the deck holds (the engine project's art and the imported dot): what a push uploads. */
async function binaries(): Promise<{ path: string; sha256: string }[]> {
  const out: { path: string; sha256: string }[] = [];
  for (const path of Object.keys(await tree(deck)).sort()) {
    if (!path.endsWith(".asset.json")) continue;
    const sidecar = JSON.parse(await readFile(join(deck, path), "utf8")) as { sha256?: string };
    if (sidecar.sha256)
      out.push({ path: path.slice(0, -".asset.json".length), sha256: sidecar.sha256 });
  }
  return out;
}

async function pull(...args: string[]) {
  const r = await runCli(
    ["project", "pull", PROJECT, "--url", SITE, "--token", TOKEN, ...args, "--json"],
    ctx,
  );
  return { exitCode: r.exitCode, data: JSON.parse(r.stdout) as Record<string, unknown> };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-pull-"));
  deck = join(root, "deck");
  await cp(ENGINE_SCENES, deck, { recursive: true });
  await writeFile(join(root, "dot.png"), DOT);
  await writeFile(join(root, "rubber.json"), JSON.stringify(RUBBER));
  project = await tempProject(deck, { id: PROJECT });
  ctx = { projects: [project], loadRapier: loadCompatRapier, fetch: site.fetch, env: {} };
  const setUp = [
    ["fmt"],
    ["assets", "import", join(root, "dot.png"), "--path", "art/"],
    ["assets", "import", join(root, "rubber.json"), "--path", "materials/"],
    ["assets", "rename", "rubber", "--name", "Rubber ball"],
  ];
  for (const argv of setUp) {
    const r = await runCli(argv, ctx);
    expect(r.exitCode, `${argv.join(" ")}\n${r.stderr}`).toBe(0);
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("project push", () => {
  const push = (...args: string[]) =>
    runCli(["project", "push", deck, "--url", SITE, "--token", TOKEN, ...args, "--json"], ctx).then(
      (r) => ({ exitCode: r.exitCode, data: JSON.parse(r.stdout) as Record<string, unknown> }),
    );

  it("needs --create, and takes only a site URL", async () => {
    expect((await push()).exitCode).toBe(2);
    const ws = await runCli(
      ["project", "push", deck, "--create", "--url", "ws://localhost:3000"],
      ctx,
    );
    expect(ws.exitCode).toBe(2);
    expect(requests).toEqual([]);
  });

  it("uploads each binary, then has the site seed every doc from the bundle", async () => {
    const r = await push("--create");
    expect(r.exitCode, JSON.stringify(r.data)).toBe(0);
    const held = await binaries();
    expect(held.map((b) => b.path)).toContain("art/dot.png");
    expect(r.data).toMatchObject({ ok: true, project: PROJECT, url: SITE, uploaded: held.length });
    const json = { kind: "atlas", type: "application/json" };
    const png = { kind: "texture", type: "image/png" };
    expect(uploads).toEqual(
      expect.arrayContaining(held.map((b) => (b.path.endsWith(".json") ? json : png))),
    );
    expect(uploads).toHaveLength(held.length);
    const sent = requests.map((q) => `${q.method} ${q.path.split("/").pop()}`);
    expect(sent[0]).toBe("GET bundle");
    expect(sent.at(-1)).toBe("POST bundle");
    const heads = sent.slice(1, 1 + held.length);
    expect([...heads].sort()).toEqual(held.map((b) => `HEAD ${b.sha256}`).sort());
    expect(sent.slice(1 + held.length, -1)).toEqual(held.map(() => "POST blobs"));
    expect(hostedProjects.get(PROJECT)?.docs.get("kitchen-sink")?.prefix).toBe("scene");
  });

  it("is refused once the project exists, before anything is uploaded", async () => {
    const sent = requests.length;
    const r = await push("--create");
    expect(r.exitCode).toBe(1);
    expect(r.data).toMatchObject({ exists: true });
    expect(requests.slice(sent).map((q) => q.method)).toEqual(["GET"]);
  });
});

describe("project pull", () => {
  it("reproduces the pushed files byte for byte, sidecars included", async () => {
    const out = join(root, "pulled");
    const r = await pull("--out", out);
    expect(r.exitCode, JSON.stringify(r.data)).toBe(0);
    expect(r.data).toMatchObject({ ok: true, project: PROJECT, written: true, skipped: [] });
    const want = await tree(deck);
    expect(Object.keys(want)).toEqual(
      expect.arrayContaining([
        "art/dot.png",
        "art/dot.png.asset.json",
        "materials/rubber.json.asset.json",
        "kitchen-sink.json",
        "prefabs/post.json",
      ]),
    );
    expect(await tree(out)).toEqual(want);
    const changes = r.data.changes as { path: string; change: string }[];
    expect(changes.map((c) => c.path).sort()).toEqual([...Object.keys(want), PROJECT_FILE].sort());
    expect(changes.every((c) => c.change === "added")).toBe(true);
    expect(JSON.parse(await readFile(join(out, PROJECT_FILE), "utf8"))).toMatchObject({
      id: PROJECT,
      name: "Deck",
    });
    for (const r of requests) expect(r.auth).toBe(`Bearer ${TOKEN}`);
  });

  it("finds nothing to change in the files it came from", async () => {
    const r = await pull("--check");
    expect(r.exitCode).toBe(0);
    expect(r.data).toMatchObject({ out: deck, changes: [], written: false });
  });

  it("--check exits 1 after a hosted edit and writes nothing; a pull then brings it in", async () => {
    const before = await readFile(join(deck, "engine-yard.json"), "utf8");
    const scene = deckHosted().docs.get("engine-yard")!.doc!;
    const edited = applyOpsToDoc(
      scene,
      { ops: [{ op: "update", ref: "lift", set: { "path.speed": 60 } }] },
      { kind: "agent", agentId: "agent-1", onBehalfOf: "ada" },
      project.registry,
    );
    expect(edited.ok).toBe(true);

    const checked = await pull("--check");
    expect(checked.exitCode).toBe(1);
    expect(checked.data).toMatchObject({
      changes: [{ path: "engine-yard.json", change: "changed" }],
      written: false,
    });
    expect(await readFile(join(deck, "engine-yard.json"), "utf8")).toBe(before);

    const text = await runCli(
      ["project", "pull", PROJECT, "--url", SITE, "--token", TOKEN, "--check"],
      ctx,
    );
    expect(text.exitCode).toBe(1);
    expect(text.stderr).toMatch(/1 file would change/);
    expect(text.stderr).toMatch(/changed engine-yard\.json/);

    const pulled = await pull();
    expect(pulled).toMatchObject({ exitCode: 0, data: { written: true } });
    const after = JSON.parse(await readFile(join(deck, "engine-yard.json"), "utf8")) as {
      entities: { id: string; path?: { speed: number } }[];
    };
    expect(after.entities.find((e) => e.id === "lift")?.path?.speed).toBe(60);
    expect((await pull("--check")).exitCode).toBe(0);
  });

  it("removes a file the hosted project trashed, with its sidecar", async () => {
    const assets = deckHosted().registry.getMap<Y.Map<unknown>>("assets");
    const key = Object.values(readProject(deckHosted().registry).assets).find(
      (e) => e.id === "rubber",
    )!.key;
    deckHosted().registry.transact(() => assets.get(key)!.set("deleted", { at: 1, by: "agent-1" }));

    const checked = await pull("--check");
    expect(checked.exitCode).toBe(1);
    expect(checked.data.changes).toEqual([
      { path: "materials/rubber.json", change: "removed" },
      { path: "materials/rubber.json.asset.json", change: "removed" },
    ]);
    expect((await pull()).exitCode).toBe(0);
    expect(Object.keys(await tree(deck))).not.toContain("materials/rubber.json");
  });

  it("refuses without a token, and reports the site's refusal of a bad one", async () => {
    const none = await runCli(
      ["project", "pull", PROJECT, "--url", SITE, "--out", join(root, "x"), "--json"],
      ctx,
    );
    expect(none.exitCode).toBe(2);
    expect(JSON.parse(none.stdout).error).toMatch(/JAMS_AGENT_TOKEN/);

    const bad = await runCli(
      ["project", "pull", PROJECT, "--url", SITE, "--token", "jat_wrong", "--json"],
      ctx,
    );
    expect(bad.exitCode).toBe(1);
    expect(JSON.parse(bad.stdout).error).not.toContain("jat_wrong");

    const ws = await runCli(["project", "pull", PROJECT, "--url", "ws://localhost:3000"], ctx);
    expect(ws.exitCode).toBe(2);
  });

  it("fails without writing when the site lacks a blob's bytes", async () => {
    const out = join(root, "no-blob");
    await mkdir(out);
    const held = site.blobs;
    site.blobs = memoryContentStore();
    try {
      const r = await pull("--out", out);
      expect(r.exitCode).toBe(1);
      const missing = (await binaries()).map((b) => `${b.path} (${b.sha256})`);
      expect([...(r.data.missing as string[])].sort()).toEqual(missing.sort());
      expect(await readdir(out)).toEqual([]);
    } finally {
      site.blobs = held;
    }
  });
});

describe("a game's project, hosted and pulled back", () => {
  let tactics: string;
  let handle: ProjectHandle;

  beforeAll(async () => {
    tactics = join(root, "tactics");
    await cp(TACTICS, tactics, { recursive: true });
    handle = await openProject(tactics, {
      game: tacticsGame,
      cacheDir: join(root, ".jams-cache", "tactics"),
    });
    ctx = { ...ctx, projects: [...ctx.projects, handle] };
  });

  /** Every asset the checkout lists, with its sidecar and the project file: the files a pull writes. */
  async function assetFiles(dir: string) {
    const listed = await runCli(["assets", "list", "--project", "tactics", "--json"], ctx);
    expect(listed.exitCode, listed.stderr).toBe(0);
    const all = await tree(dir);
    const paths = (JSON.parse(listed.stdout) as { assets: { path: string }[] }).assets.flatMap(
      ({ path }) => [path, `${path}.asset.json`],
    );
    const out: Record<string, string> = {};
    for (const path of [...paths, PROJECT_FILE].sort()) {
      if (path === PROJECT_FILE) out[path] = (await readFile(join(dir, path))).toString("base64");
      else if (all[path] !== undefined) out[path] = all[path];
    }
    return out;
  }

  it("push --create, then pull, reproduces every file byte for byte, art blobs and sidecars included", async () => {
    const sent = requests.length;
    const pushed = await runCli(
      ["project", "push", tactics, "--create", "--url", SITE, "--token", TOKEN, "--json"],
      ctx,
    );
    expect(pushed.exitCode, pushed.stdout).toBe(0);
    expect(JSON.parse(pushed.stdout)).toMatchObject({ ok: true, project: "tactics" });
    expect(hostedProjects.get("tactics")?.game).toBe(tacticsGame.id);

    const want = await assetFiles(tactics);
    const paths = Object.keys(want);
    expect(paths).toEqual(
      expect.arrayContaining([
        "game-settings.json",
        "game-settings.json.asset.json",
        "input-map.json",
        "data/unit-classes.json",
        "data/unit-classes.json.asset.json",
        "scenes/level-1.json",
        "scenes/prefabs/knight.json",
        "scenes/prefabs/archer.json",
      ]),
    );
    expect(Object.keys(await tree(tactics))).toContain("art/make-art.ts");
    expect(paths).not.toContain("art/make-art.ts");
    const art = paths.filter((p) => p.startsWith("art/") && p.endsWith(".png"));
    expect(art.length, "tactics holds its art").toBeGreaterThan(0);
    for (const png of art) expect(paths).toContain(`${png}.asset.json`);
    for (const png of art) {
      const sidecar = JSON.parse(await readFile(join(tactics, `${png}.asset.json`), "utf8")) as {
        sha256: string;
      };
      expect(await site.blobs.has(sidecar.sha256), `${png} is on the site`).toBe(true);
    }
    for (const q of requests.slice(sent))
      expect(q.path).toMatch(/^\/api\/engine\/projects\/tactics\//);

    const out = join(root, "tactics-pulled");
    const pulled = await runCli(
      ["project", "pull", "tactics", "--url", SITE, "--token", TOKEN, "--out", out, "--json"],
      ctx,
    );
    expect(pulled.exitCode, pulled.stdout).toBe(0);
    const data = JSON.parse(pulled.stdout) as {
      written: boolean;
      skipped: string[];
      game: string | null;
      changes: { path: string; change: string }[];
    };
    expect(data).toMatchObject({ written: true, skipped: [], game: tacticsGame.id });
    expect(data.changes.every((c) => c.change === "added")).toBe(true);
    expect(data.changes.map((c) => c.path).sort()).toEqual(paths);
    expect(await tree(out)).toEqual(
      Object.fromEntries(Object.entries(want).filter(([p]) => p !== PROJECT_FILE)),
    );
    expect(await readFile(join(out, PROJECT_FILE), "utf8")).toBe(
      await readFile(join(tactics, PROJECT_FILE), "utf8"),
    );
  });

  it("finds nothing to change in the checkout it came from", async () => {
    const r = await runCli(
      [
        "project",
        "pull",
        "tactics",
        "--url",
        SITE,
        "--token",
        TOKEN,
        "--out",
        tactics,
        "--check",
        "--json",
      ],
      ctx,
    );
    expect(r.exitCode, r.stdout).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ changes: [], written: false });
  });

  it("leaves a script beside the art alone: neither pulled nor removed", async () => {
    const out = join(root, "tactics-pulled");
    await writeFile(join(out, "art", "make-art.ts"), "export {};\n");
    const r = await runCli(
      ["project", "pull", "tactics", "--url", SITE, "--token", TOKEN, "--out", out, "--json"],
      ctx,
    );
    expect(r.exitCode, r.stdout).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ changes: [], written: false });
    expect(await readFile(join(out, "art", "make-art.ts"), "utf8")).toBe("export {};\n");
  });
});
