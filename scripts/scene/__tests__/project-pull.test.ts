// @vitest-environment node
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { applyOpsToDoc, readProject } from "@jams/engine/collab";
import {
  memoryContentStore,
  PROJECT_FILE,
  type CodeModuleInfo,
  type ContentStore,
  type ProjectBundle,
} from "@jams/engine/project";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { bundleProjectState } from "../../../src/lib/engine/bundle";
import { prepareLoadedState } from "../../../src/lib/scene/doc-bytes";
import {
  emptyProjectState,
  seedAssetState,
  seedProjectState,
} from "../../../src/lib/scene/project-bytes";
import { runCli } from "../commands";
import type { ToolContext } from "../context";
import type { ProjectHandle } from "../projects";
import { loadCompatRapier } from "../rapier-compat";
import { tempProject } from "./fixtures";

vi.mock("@/db", () => ({ db: {} }));

const ENGINE_SCENES = fileURLToPath(new URL("../../../src/engine/scenes", import.meta.url));
const SITE = "https://staging.example.test";
const TOKEN = "jat_pullTestSecret";
const PROJECT = "deck";
const RUBBER = { kind: "material", v: 1, description: "Bouncy." };

/** A 1×1 PNG. */
const DOT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * The project the site hosts, in memory as the site keeps it: null while
 * the id is reserved and empty; once pushed, the registry and doc rows
 * `seedHostedProject` writes, each doc laid out as the service lays out
 * its seed on first load (the material left unloaded, with its seed only).
 */
type Hosted = {
  registry: Y.Doc;
  docs: Map<string, { prefix: "scene" | "asset"; kind: string; doc: Y.Doc | null; seed: string }>;
};

let root: string;
let deck: string;
let project: ProjectHandle;
let ctx: ToolContext;
let hosted: Hosted | null = null;
let blobs: ContentStore = memoryContentStore();
const requests: { method: string; path: string; auth: string | null }[] = [];
const uploads: { kind: string | null; type: string | null }[] = [];

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** What `seedHostedProject` does with a pushed bundle, judged as `bundleProjectState` judges it. */
async function seed(body: { bundle: ProjectBundle; code: Record<string, CodeModuleInfo> }) {
  const derived = await bundleProjectState(body.bundle, {
    store: blobs,
    kinds: project.kinds,
    registry: project.registry,
    code: body.code,
  });
  if (!derived.ok) return Response.json({ problems: derived.problems }, { status: 400 });
  const registry = new Y.Doc();
  Y.applyUpdate(registry, seedProjectState(derived.state));
  const docs: Hosted["docs"] = new Map();
  for (const d of derived.docs) {
    let doc: Y.Doc | null = null;
    if (d.kind !== "material") {
      doc = new Y.Doc();
      Y.applyUpdate(
        doc,
        d.prefix === "scene"
          ? prepareLoadedState(`${PROJECT}.${d.key}`, null, d.seed).state
          : seedAssetState({ project: PROJECT, key: d.key, kind: d.kind, seed: d.seed }),
      );
    }
    docs.set(d.key, { prefix: d.prefix, kind: d.kind, doc, seed: d.seed });
  }
  hosted = { registry, docs };
  return Response.json({ projectId: PROJECT, docs: docs.size, warnings: [] }, { status: 201 });
}

/** The site's bundle and blob routes for project `deck`, for the one agent token. */
const fakeSite = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  const headers = new Headers(init?.headers);
  const auth = headers.get("authorization");
  const method = init?.method ?? "GET";
  requests.push({ method, path: url.pathname, auth });
  if (auth !== `Bearer ${TOKEN}`)
    return Response.json({ message: "That agent token isn't valid." }, { status: 401 });
  const base = `/api/engine/projects/${PROJECT}`;
  if (url.pathname === `${base}/bundle`) {
    if (method === "POST") {
      if (hosted) return Response.json({ message: "exists" }, { status: 409 });
      return seed(JSON.parse(init?.body as string));
    }
    const registry = hosted
      ? Y.encodeStateAsUpdate(hosted.registry)
      : seedProjectState(emptyProjectState(PROJECT, "Deck"));
    const docs = [...(hosted?.docs ?? [])].map(([key, d]) => ({
      prefix: d.prefix,
      key,
      kind: d.kind,
      state: d.doc ? b64(Y.encodeStateAsUpdate(d.doc)) : null,
      seed: d.doc ? null : d.seed,
    }));
    return Response.json({
      projectId: PROJECT,
      name: "Deck",
      game: null,
      project: b64(registry),
      docs,
      blobs: [],
    });
  }
  if (url.pathname === `${base}/blobs` && method === "POST") {
    uploads.push({ kind: headers.get("x-asset-kind"), type: headers.get("content-type") });
    const bytes = new Uint8Array(init?.body as Uint8Array);
    const sha = await blobs.put(bytes, headers.get("x-expect-sha256") ?? undefined);
    return Response.json({ sha256: sha, bytes: bytes.byteLength }, { status: 201 });
  }
  const blob = new RegExp(`^${base}/blobs/([0-9a-f]{64})$`).exec(url.pathname);
  if (blob) {
    const bytes = await blobs.get(blob[1]!);
    if (!bytes) return Response.json({ message: "Not found." }, { status: 404 });
    return new Response(method === "HEAD" ? null : new Uint8Array(bytes));
  }
  return Response.json({ message: "Not found." }, { status: 404 });
}) as typeof fetch;

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
  ctx = { projects: [project], loadRapier: loadCompatRapier, fetch: fakeSite, env: {} };
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
    expect(hosted?.docs.get("kitchen-sink")?.prefix).toBe("scene");
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
    const scene = hosted!.docs.get("engine-yard")!.doc!;
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
    const assets = hosted!.registry.getMap<Y.Map<unknown>>("assets");
    const key = Object.values(readProject(hosted!.registry).assets).find(
      (e) => e.id === "rubber",
    )!.key;
    hosted!.registry.transact(() => assets.get(key)!.set("deleted", { at: 1, by: "agent-1" }));

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
    const held = blobs;
    blobs = memoryContentStore();
    try {
      const r = await pull("--out", out);
      expect(r.exitCode).toBe(1);
      const missing = (await binaries()).map((b) => `${b.path} (${b.sha256})`);
      expect([...(r.data.missing as string[])].sort()).toEqual(missing.sort());
      expect(await readdir(out)).toEqual([]);
    } finally {
      blobs = held;
    }
  });
});
