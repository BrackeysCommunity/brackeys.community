// @vitest-environment node
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "@jams/engine/project";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { emptyProjectState, seedProjectState } from "../../../src/lib/scene/project-bytes";
import { runCli } from "../commands";
import type { ToolContext } from "../context";
import { loadCompatRapier } from "../rapier-compat";
import { tempProject } from "./fixtures";

const ENGINE_SCENES = fileURLToPath(new URL("../../../src/engine/scenes", import.meta.url));
const SITE = "https://staging.example.test";
const TOKEN = "jat_pushDryRunSecret";
const PROJECT = "deck";

/** A 1×1 PNG. */
const DOT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let root: string;
let deck: string;
let ctx: ToolContext;
/** Whether the site's project holds an asset; a dry run must never change it. */
let holds = false;
const requests: string[] = [];

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** The site's read routes for project `deck`: an empty (or, with `holds`, occupied) bundle and no blobs. Any write fails the test. */
const readOnlySite = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  const method = init?.method ?? "GET";
  requests.push(`${method} ${url.pathname.split("/").pop()}`);
  if (new Headers(init?.headers).get("authorization") !== `Bearer ${TOKEN}`)
    return Response.json({ message: "That agent token isn't valid." }, { status: 401 });
  const base = `/api/engine/projects/${PROJECT}`;
  if (method === "GET" && url.pathname === `${base}/bundle`) {
    const empty = emptyProjectState(PROJECT, "Deck");
    const taken = {
      key: "taken",
      id: "taken",
      kind: "scene",
      path: "taken.json",
      created: { at: 0, by: "disk" },
    };
    const state = holds ? { ...empty, assets: { taken } } : empty;
    return Response.json({
      projectId: PROJECT,
      name: "Deck",
      game: null,
      project: b64(seedProjectState(state)),
      docs: [],
      blobs: [],
    });
  }
  if (method === "HEAD" && url.pathname.startsWith(`${base}/blobs/`))
    return new Response(null, { status: 404 });
  return Response.json({ message: `${method} isn't expected in a dry run.` }, { status: 500 });
}) as typeof fetch;

async function push(...args: string[]) {
  const r = await runCli(
    ["project", "push", deck, "--url", SITE, "--token", TOKEN, ...args, "--json"],
    ctx,
  );
  return { exitCode: r.exitCode, data: JSON.parse(r.stdout) as Record<string, unknown> };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-push-"));
  deck = join(root, "deck");
  await cp(ENGINE_SCENES, deck, { recursive: true });
  await writeFile(join(root, "dot.png"), DOT);
  const project = await tempProject(deck, { id: PROJECT });
  ctx = { projects: [project], loadRapier: loadCompatRapier, fetch: readOnlySite, env: {} };
  for (const argv of [["fmt"], ["assets", "import", join(root, "dot.png"), "--path", "art/"]]) {
    const r = await runCli(argv, ctx);
    expect(r.exitCode, `${argv.join(" ")}\n${r.stderr}`).toBe(0);
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("project push --dry-run", () => {
  it("still needs --create", async () => {
    expect((await push("--dry-run")).exitCode).toBe(2);
    expect(requests).toEqual([]);
  });

  it("reports the docs it would seed and the binaries it would upload, sending nothing", async () => {
    const r = await push("--create", "--dry-run");
    expect(r.exitCode, JSON.stringify(r.data)).toBe(0);
    const binaries = [
      { path: "art/backdrop.png", kind: "texture" },
      { path: "art/crates.json", kind: "atlas" },
      { path: "art/crates.png", kind: "texture" },
      { path: "art/dot.png", kind: "texture" },
      { path: "art/hero.json", kind: "atlas" },
      { path: "art/hero.png", kind: "texture" },
    ];
    const want = await Promise.all(
      binaries.map(async (b) => ({
        ...b,
        sha256: await sha256(await readFile(join(deck, b.path))),
      })),
    );
    expect(r.data).toMatchObject({
      ok: true,
      dryRun: true,
      written: false,
      project: PROJECT,
      url: SITE,
      uploaded: 0,
    });
    const uploads = r.data.uploads as { path: string }[];
    expect([...uploads].sort((a, b) => (a.path < b.path ? -1 : 1))).toEqual(
      want.map((w) => expect.objectContaining(w)),
    );
    const seeds = r.data.seeds as string[];
    expect(seeds).toContain("kitchen-sink.json");
    for (const b of binaries) expect(seeds).not.toContain(b.path);
    expect(r.data.docs).toBe(seeds.length);
    expect(r.data.files).toBe(seeds.length + binaries.length);
    expect(requests[0]).toBe("GET bundle");
    expect(requests.slice(1).sort()).toEqual(want.map((w) => `HEAD ${w.sha256}`).sort());
  });

  it("is refused like a push once the project holds anything", async () => {
    requests.length = 0;
    holds = true;
    try {
      const r = await push("--create", "--dry-run");
      expect(r.exitCode).toBe(1);
      expect(r.data).toMatchObject({ exists: true });
      expect(requests).toEqual(["GET bundle"]);
    } finally {
      holds = false;
    }
  });

  it("checks the files first: a doc that doesn't parse sends nothing at all", async () => {
    requests.length = 0;
    const scene = join(deck, "engine-yard.json");
    const text = await readFile(scene, "utf8");
    await writeFile(scene, "{ not json");
    try {
      const r = await push("--create", "--dry-run");
      expect(r.exitCode).toBe(1);
      expect(requests).toEqual([]);
    } finally {
      await writeFile(scene, text);
    }
  });
});
