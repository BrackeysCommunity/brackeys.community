// @vitest-environment node
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { finishExport, planContent, type BuiltCode } from "@jams/engine/export";
import type { GameDefinition } from "@jams/engine/game";
import {
  buildSceneVersion,
  formatReleaseManifest,
  parseReleaseManifest,
  parseSceneVersion,
  RELEASE_FILE,
  sceneVersionId,
  sceneVersionOptions,
  sha256,
} from "@jams/engine/project";
import type { SceneDefinition } from "@jams/engine/scene";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { tacticsGame } from "../../../src/games/tactics";
import type { UsageLine } from "../../../src/lib/engine/quota";
import { runCli } from "../commands";
import type { ToolContext, ToolResult } from "../context";
import { openProject } from "../projects";
import { exportInputOf } from "../tools/game-build";
import {
  gameLiveBuild,
  gameLiveCheck,
  gameLiveClear,
  gameLiveList,
  gameLivePromote,
  gameLivePublish,
  gameLiveRollback,
  type GameLivePublishInput,
  type SceneVersionListEntry,
} from "../tools/game-live";

const TACTICS = fileURLToPath(new URL("../../../src/games/tactics", import.meta.url));
const SCENE = "level-1";

/** Tactics as a game that takes new versions mid-run, so the swap check runs. */
const liveTactics: GameDefinition = {
  ...tacticsGame,
  live: { timings: ["next-load", "boundary", "now"] },
};

/** Tactics as a game that takes new versions only at the next load. */
const nextLoadTactics: GameDefinition = { ...tacticsGame, live: { timings: ["next-load"] } };

const builtCode: BuiltCode = {
  files: [{ path: "code/main-abc123.js", sha256: "d".repeat(64), bytes: 1000, role: "code" }],
  entry: "code/main-abc123.js",
  rapier: null,
  thirdParty: [],
};

let root: string;
let dir: string;
let ctx: ToolContext;
let live: ToolContext;
let nextLoad: ToolContext;
let release: string;

const contextFor = async (game: GameDefinition): Promise<ToolContext> => ({
  projects: [
    await openProject(dir, {
      game,
      cacheDir: join(root, ".cache", game.live?.timings.join("-") ?? "none"),
    }),
  ],
  loadRapier: () => Promise.reject(new Error("tactics runs without physics")),
  env: {},
});

/** Edits a file of the copy for one test, and puts it back after. */
async function editing<T>(path: string, edit: (text: string) => string, body: () => Promise<T>) {
  const file = join(dir, path);
  const was = await readFile(file, "utf8");
  await writeFile(file, edit(was));
  try {
    return await body();
  } finally {
    await writeFile(file, was);
  }
}

/** The marsh costs 2 instead of 1: one entity changes. */
const costlierMarsh = (text: string) => {
  const scene = JSON.parse(text) as SceneDefinition;
  const marsh = scene.entities!.find((e) => e.id === "marsh") as unknown as { cost: number };
  marsh.cost = 2;
  return JSON.stringify(scene);
};

const dataOf = <T = Record<string, unknown>>(r: ToolResult) => r.data as T;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "game-live-"));
  dir = join(root, "tactics");
  await cp(TACTICS, dir, {
    recursive: true,
    filter: (src) => !["__tests__", "node_modules", "dist"].includes(basename(src)),
  });
  ctx = await contextFor(tacticsGame);
  live = await contextFor(liveTactics);
  nextLoad = await contextFor(nextLoadTactics);

  // A release of the copy as `game build` would write its data: the manifest and every doc it ships.
  const input = await exportInputOf(ctx.projects[0]!, "web");
  if (!("view" in input)) throw new Error(input.text);
  const { manifest } = await finishExport(await planContent(input), builtCode, input);
  release = join(root, "release");
  await mkdir(release, { recursive: true });
  await writeFile(join(release, RELEASE_FILE), formatReleaseManifest(manifest));
  for (const [id, asset] of Object.entries(manifest.assets)) {
    if (asset.storage !== "doc") continue;
    await mkdir(dirname(join(release, asset.file)), { recursive: true });
    await writeFile(join(release, asset.file), input.texts.get(id)!);
  }
}, 120_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("game live build", () => {
  it("writes the version file and every text it carries, named by its hash", async () => {
    const out = join(root, "out", "build");
    const r = await gameLiveBuild({ project: "tactics", scene: SCENE, hosted: false, out }, ctx);
    expect(r.exitCode, r.text).toBe(0);
    const { id, files, dataBytes } = dataOf<{
      id: string;
      files: { file: string; bytes: number; asset?: string }[];
      dataBytes: number;
    }>(r);

    const text = await readFile(join(out, "scene-version.json"), "utf8");
    const parsed = parseSceneVersion(text);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(await sceneVersionId(parsed.version)).toBe(id);
    expect(await sha256(text)).toBe(id);

    const docs = Object.entries(parsed.version.assets).filter(([, a]) => a.storage === "doc");
    expect(docs.map(([asset]) => asset).sort()).toEqual(["archer", "knight", SCENE]);
    for (const [, a] of docs)
      expect(await sha256(await readFile(join(out, `${a.sha256}.json`), "utf8"))).toBe(a.sha256);
    expect((await readdir(out)).sort()).toEqual(files.map((f) => f.file).sort());
    expect(dataBytes).toBe(files.reduce((n, f) => n + f.bytes, 0));
    expect(r.text).toMatch(
      new RegExp(`^Built tactics ${SCENE} \\(${id.slice(0, 6)}…\\): \\d+ KB of data, 4 files in `),
    );

    const again = await gameLiveBuild(
      { project: "tactics", scene: SCENE, hosted: false, out },
      ctx,
    );
    expect(dataOf(again).id).toBe(id);
    const stray = join(root, "out", "stray");
    await mkdir(stray, { recursive: true });
    await writeFile(join(stray, "notes.txt"), "mine");
    const refused = await gameLiveBuild(
      { project: "tactics", scene: SCENE, hosted: false, out: stray },
      ctx,
    );
    expect(refused.exitCode).toBe(1);
    expect(await readFile(join(stray, "notes.txt"), "utf8")).toBe("mine");
  });

  // The editor's docs give buildSceneVersion's id for the same files (build-scene-version.test.ts).
  it("gives buildSceneVersion's id for the same files, and a new one when they change", async () => {
    const r = await gameLiveBuild(
      { project: "tactics", scene: SCENE, hosted: false, out: join(root, "out", "editor") },
      ctx,
    );
    const { id } = dataOf<{ id: string }>(r);
    const input = await exportInputOf(ctx.projects[0]!, "web");
    if (!("view" in input)) throw new Error(input.text);
    const direct = await buildSceneVersion(sceneVersionOptions(input, SCENE));
    expect(direct.ok && direct.id).toBe(id);

    const changed = await editing(`scenes/${SCENE}.json`, costlierMarsh, () =>
      gameLiveBuild(
        { project: "tactics", scene: SCENE, hosted: false, out: join(root, "out", "changed") },
        ctx,
      ),
    );
    expect(dataOf(changed).id).not.toBe(id);
  });

  it("builds from a pull of the hosted project over a copy of the files, and removes the copy", async () => {
    const pulled: string[] = [];
    const r = await gameLiveBuild(
      { project: "tactics", scene: SCENE, hosted: true, out: join(root, "out", "hosted") },
      { ...ctx, env: { JAMS_AGENT_SITE: "https://jams.example" } },
      {
        pull: async (input) => {
          pulled.push(input.out!);
          const file = join(input.out!, "scenes", `${SCENE}.json`);
          await writeFile(file, costlierMarsh(await readFile(file, "utf8")));
          return { exitCode: 0, data: {}, text: "" };
        },
      },
    );
    expect(r.exitCode, r.text).toBe(0);
    expect(dataOf(r)).toMatchObject({ from: "https://jams.example" });
    expect(dirname(pulled[0]!)).toBe(root);
    expect((await readdir(root)).filter((f) => f.startsWith(".tactics-"))).toEqual([]);

    const local = await gameLiveBuild(
      { project: "tactics", scene: SCENE, hosted: false, out: join(root, "out", "local") },
      ctx,
    );
    expect(dataOf(r).id).not.toBe(dataOf(local).id);
    expect(
      (await gameLiveBuild({ project: "tactics", scene: SCENE, hosted: true }, ctx)).exitCode,
    ).toBe(2);
  });

  it("refuses an unknown project or scene as usage", async () => {
    expect(
      (await gameLiveBuild({ project: "nope", scene: SCENE, hosted: false }, ctx)).exitCode,
    ).toBe(2);
    const r = await gameLiveBuild({ project: "tactics", scene: "level-9", hosted: false }, ctx);
    expect(r.exitCode).toBe(2);
    expect(r.text).toContain('did you mean "level-1"?');
  });
});

describe("game live check", () => {
  it("fits the release it was built from, and swap-checks from the release's scene", async () => {
    const r = await gameLiveCheck({ project: "tactics", scene: SCENE, against: release }, live);
    expect(r.exitCode, r.text).toBe(0);
    expect(r.text).toMatch(/^ {2}Fits: {5}release \S+ \(.*release\.json\) · timing: now$/m);
    expect(r.text).toContain("  Changes:  nothing changed (players' worlds update in place)");
    expect(r.text).toMatch(
      /^ {2}Swaps: {4}\d+ runs over scenes\/level-1\.script\.json passed; checks 2 passed$/m,
    );
    expect(r.text).not.toContain("warning:");
    const { swapCheck, newFiles } = dataOf<{
      swapCheck: { ok: boolean; runs: unknown[] };
      newFiles: number;
    }>(r);
    expect(swapCheck.ok).toBe(true);
    expect(swapCheck.runs.length).toBe(3);
    expect(newFiles).toBe(0);
  });

  it("refuses, against a release, a version whose shared asset changed", async () => {
    const png = join(dir, "art", "tile-wall.png");
    const sidecar = `${png}.asset.json`;
    const [bytes, side] = [await readFile(png), await readFile(sidecar, "utf8")];
    const changed = Buffer.concat([bytes, Buffer.from([0])]);
    await writeFile(png, changed);
    await writeFile(
      sidecar,
      JSON.stringify({
        ...JSON.parse(side),
        sha256: await sha256(new Uint8Array(changed)),
        bytes: changed.length,
      }),
    );
    try {
      const r = await gameLiveCheck({ project: "tactics", scene: SCENE, against: release }, ctx);
      expect(r.exitCode, r.text).toBe(1);
      expect(dataOf<{ issues: { code: string }[] }>(r).issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "live-asset-conflict" })]),
      );
      expect(r.text).toMatch(/^ {2}Fits: {5}doesn't fit release /m);
      expect(r.text).toContain("tile-wall");
    } finally {
      await writeFile(png, bytes);
      await writeFile(sidecar, side);
    }
  });

  it("names what changed since --from's version and swaps it in mid-run", async () => {
    const from = join(root, "out", "from");
    expect(
      (await gameLiveBuild({ project: "tactics", scene: SCENE, hosted: false, out: from }, live))
        .exitCode,
    ).toBe(0);
    const r = await editing(`scenes/${SCENE}.json`, costlierMarsh, () =>
      gameLiveCheck({ project: "tactics", scene: SCENE, from }, live),
    );
    expect(r.exitCode, r.text).toBe(0);
    expect(r.text).toContain("  Changes:  1 entity changed (players' worlds update in place)");
    expect(dataOf(r)).toMatchObject({
      diff: { changed: ["marsh"], added: [], removed: [], header: false },
      swapCheck: { ok: true },
    });
    expect(r.text).not.toContain("Fits:");
  });

  it("only validates without --against or --from, and warns of a clamped timing", async () => {
    const r = await gameLiveCheck({ project: "tactics", scene: SCENE }, nextLoad);
    expect(r.exitCode, r.text).toBe(0);
    expect(r.text).toContain(
      "warning: This game accepts only next load; level-1 will reach players then.",
    );
    expect(r.text).toContain("warning: only validated: pass --against");
    expect(dataOf(r)).toMatchObject({
      swapCheck: null,
      timing: { timing: "next-load", clamped: true },
    });

    const clamped = await gameLiveCheck(
      { project: "tactics", scene: SCENE, against: release },
      nextLoad,
    );
    expect(clamped.exitCode, clamped.text).toBe(0);
    expect(clamped.text).toContain("· timing: next load");
    expect(clamped.text).toContain(
      "  Swaps:    not checked: this game takes new versions only at the next load",
    );
  });

  it("--json gives the same fields as the tool", async () => {
    const r = await runCli(
      ["game", "live", "check", "tactics", SCENE, "--against", release, "--json"],
      ctx,
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const direct = await gameLiveCheck({ project: "tactics", scene: SCENE, against: release }, ctx);
    expect(JSON.parse(r.stdout)).toEqual(JSON.parse(JSON.stringify(direct.data)));
    expect(JSON.parse(r.stdout)).toMatchObject({
      ok: true,
      project: "tactics",
      scene: SCENE,
      against: { file: join(release, RELEASE_FILE) },
    });
  });
});

// ─── publish, list and the pointers, against a fake site ───

const SITE = "https://staging.example.test";
const TOKEN = "jat_liveTestSecret";
const MIB = 1_048_576;
const PRODUCTION_REFUSAL = "Production releases are moved by a person on the game's page.";

const lineOf = (quota: UsageLine["quota"], used: number, max: number): UsageLine => {
  const ratio = used / max;
  return { quota, used, max, ratio, level: ratio >= 1 ? "full" : ratio >= 0.8 ? "warn" : "ok" };
};

type FakeLive = {
  fetch: typeof fetch;
  /** Hashes the site holds. */
  stored: Set<string>;
  requests: { method: string; path: string; body?: unknown }[];
  puts: string[];
};

/**
 * The site's live routes over memory: `base` serves the release built in
 * `beforeAll` on preview, `begin` names the doc texts it doesn't hold, the
 * file `PUT` checks each text's hash, and `commit` numbers the version.
 */
async function fakeLive(opts: { liveToday?: number; versions?: SceneVersionListEntry[] } = {}) {
  const manifestText = await readFile(join(release, RELEASE_FILE), "utf8");
  const parsed = parseReleaseManifest(manifestText);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const texts: Record<string, string> = {};
  for (const a of Object.values(parsed.manifest.assets))
    if (a.storage === "doc") texts[a.sha256] = await readFile(join(release, a.file), "utf8");

  const uploads = new Map<string, { missing: string[]; id: string; channel: string }>();
  const numbers = new Map<string, number>();
  const fake: FakeLive = {
    stored: new Set(),
    requests: [],
    puts: [],
    fetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input : input.url,
      );
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      fake.requests.push({ method, path: url.pathname + url.search, body });
      if (new Headers(init.headers).get("authorization") !== `Bearer ${TOKEN}`)
        return Response.json({ code: "release-forbidden", message: "No." }, { status: 401 });
      const live = "/api/engine/projects/tactics/live";

      if (url.pathname === `${live}/scenes/${SCENE}/base` && method === "GET")
        return Response.json({
          channel: url.searchParams.get("channel"),
          release: { id: "e".repeat(64), version: 7, manifest: manifestText },
          live: null,
          texts,
          latest: null,
        });
      if (url.pathname === live && method === "POST") {
        const { version, channel } = body as { version: string; channel: string };
        const read = parseSceneVersion(version);
        if (!read.ok) return Response.json({ code: "schema", message: "bad" }, { status: 400 });
        const id = await sha256(version);
        const missing = Object.values(read.version.assets)
          .filter((a) => a.storage === "doc" && !fake.stored.has(a.sha256))
          .filter((a, i, all) => all.findIndex((b) => b.sha256 === a.sha256) === i)
          .map((a) => ({ sha256: a.sha256, bytes: a.bytes }));
        const uploadId = `up${uploads.size + 1}`;
        uploads.set(uploadId, { missing: missing.map((m) => m.sha256), id, channel });
        const today = opts.liveToday ?? 5;
        return Response.json({
          uploadId,
          versionId: id,
          number: numbers.get(id) ?? null,
          missing,
          issues: [],
          usage: {
            before: [lineOf("liveVersionsPerDay", today, 100)],
            after: [
              lineOf("releaseStorageBytes", 124 * MIB, 512 * MIB),
              lineOf("liveVersionsPerDay", today + 1, 100),
            ],
          },
        });
      }
      const put = /^\/api\/engine\/releases\/uploads\/([^/]+)\/files\/([^/]+)$/.exec(url.pathname);
      if (put && method === "PUT") {
        const [, uploadId, hash] = put as unknown as [string, string, string];
        fake.puts.push(hash);
        if (!uploads.get(uploadId)?.missing.includes(hash))
          return Response.json({ code: "schema", message: "Not missing." }, { status: 409 });
        if ((await sha256(new Uint8Array(init.body as Uint8Array))) !== hash)
          return Response.json({ code: "schema", message: "Wrong hash." }, { status: 400 });
        fake.stored.add(hash);
        return new Response(null, { status: 204 });
      }
      if (url.pathname === `${live}/commit` && method === "POST") {
        const upload = uploads.get((body as { uploadId: string }).uploadId)!;
        const absent = upload.missing.filter((h) => !fake.stored.has(h)).length;
        if (absent > 0)
          return Response.json(
            { code: "release-files-missing", message: `${absent} missing.` },
            { status: 409 },
          );
        const created = !numbers.has(upload.id);
        if (created) numbers.set(upload.id, numbers.size + 1);
        return Response.json(
          {
            versionId: upload.id,
            scene: SCENE,
            number: numbers.get(upload.id),
            created,
            liveOn: upload.channel === "preview" ? "preview" : null,
          },
          { status: created ? 201 : 200 },
        );
      }
      if (url.pathname === live && method === "GET")
        return Response.json({ versions: opts.versions ?? [] });
      if (url.pathname === `${live}/scenes/${SCENE}/3/promote` && method === "POST")
        return Response.json({ from: 2, to: 3, timing: (body as { timing: string }).timing });
      if (url.pathname === `${live}/scenes/${SCENE}/rollback` && method === "POST")
        return Response.json({ from: 3, to: null });
      if (url.pathname === `${live}/scenes/${SCENE}/clear` && method === "POST")
        return Response.json({ from: 3 });
      return Response.json({ code: "not-found", message: "Not found." }, { status: 404 });
    }) as typeof fetch,
  };
  return fake;
}

const onSite = (base: ToolContext, fake: FakeLive): ToolContext => ({
  ...base,
  env: { JAMS_AGENT_SITE: SITE, JAMS_AGENT_TOKEN: TOKEN },
  fetch: fake.fetch,
});

const publishInput = (over: Partial<GameLivePublishInput> = {}): GameLivePublishInput => ({
  project: "tactics",
  scene: SCENE,
  hosted: false,
  noSwapCheck: false,
  ...over,
});

const docHashes = async (path: string) => {
  const text = await readFile(join(dir, path), "utf8");
  return sha256(text);
};

describe("game live publish", () => {
  it("uploads only the texts the site doesn't hold, and prints the publish summary", async () => {
    const fake = await fakeLive();
    // The site holds the prefabs already: only the edited scene's text goes up.
    for (const prefab of ["scenes/prefabs/knight.json", "scenes/prefabs/archer.json"])
      fake.stored.add(await docHashes(prefab));
    const r = await editing(`scenes/${SCENE}.json`, costlierMarsh, () =>
      gameLivePublish(publishInput(), onSite(live, fake)),
    );
    expect(r.exitCode, r.text).toBe(0);
    expect(fake.puts).toHaveLength(1);
    const data = dataOf<{ versionId: string; newFiles: number; uploaded: { files: number } }>(r);
    expect(data).toMatchObject({ newFiles: 1, uploaded: { files: 1 } });
    const scene = parseSceneVersion(
      (
        fake.requests.find((q) => q.method === "POST" && q.path.endsWith("/live"))!.body as {
          version: string;
        }
      ).version,
    );
    if (!scene.ok) throw new Error("the begin body isn't a version");
    expect(fake.puts).toEqual([scene.version.assets[SCENE]!.sha256]);

    const lines = r.text.split("\n");
    expect(lines[0]).toMatch(
      new RegExp(
        `^Published tactics level-1@1 \\(${data.versionId.slice(0, 6)}…\\) to preview: \\d+ KB of data, 1 new file\\.$`,
      ),
    );
    expect(lines).toContain("  Fits:     v7 (preview) · timing: next load");
    expect(lines).toContain("  Changes:  1 entity changed (players' worlds update in place)");
    expect(lines).toContain(
      "  Today:    6 of 100 scene versions · release storage 124 MB of 512 MB",
    );
    expect(lines.at(-1)).toBe(`Put it on production on the game's page: ${SITE}/games/tactics`);
    expect(r.text).not.toContain("warning:");
    expect(r.text).not.toContain("Swaps:");

    // The same files again: nothing new to send, and the site names the version it has.
    const again = await editing(`scenes/${SCENE}.json`, costlierMarsh, () =>
      gameLivePublish(publishInput(), onSite(live, fake)),
    );
    expect(again.exitCode, again.text).toBe(0);
    expect(fake.puts).toHaveLength(1);
    expect(again.text).toMatch(
      /^tactics level-1@1 \(\w+…\) was published already; preview names it: /,
    );
  });

  it("refuses a production channel locally with the site's refusal, before any request", async () => {
    const fake = await fakeLive();
    const ctxOn = onSite(live, fake);
    const results = [
      await gameLivePublish(publishInput({ channel: "production" }), ctxOn),
      await gameLivePromote(
        { project: "tactics", scene: SCENE, number: "3", channel: "production" },
        ctxOn,
      ),
      await gameLiveRollback({ project: "tactics", scene: SCENE, channel: "production" }, ctxOn),
      await gameLiveClear({ project: "tactics", scene: SCENE, channel: "production" }, ctxOn),
    ];
    for (const r of results) {
      expect(r.exitCode).toBe(1);
      expect(r.text).toBe(
        `error: release-forbidden: ${PRODUCTION_REFUSAL}\n  ${SITE}/games/tactics`,
      );
      expect(r.data).toMatchObject({ code: "release-forbidden", error: PRODUCTION_REFUSAL });
    }
    expect(fake.requests).toEqual([]);
  });

  it("runs the swap check before a now move, and skips it with --no-swap-check", async () => {
    const fake = await fakeLive();
    const checked = await editing(`scenes/${SCENE}.json`, costlierMarsh, () =>
      gameLivePublish(publishInput({ timing: "now" }), onSite(live, fake)),
    );
    expect(checked.exitCode, checked.text).toBe(0);
    expect(checked.text).toContain("  Fits:     v7 (preview) · timing: now");
    expect(checked.text).toMatch(
      /^ {2}Swaps: {4}\d+ runs over scenes\/level-1\.script\.json passed; checks 2 passed$/m,
    );
    expect(dataOf(checked)).toMatchObject({ swapCheck: { ok: true }, strategy: "reconcile" });
    const begin = fake.requests.find((q) => q.method === "POST" && q.path.endsWith("/live"));
    expect(begin?.body).toMatchObject({ channel: "preview", timing: "now" });

    const skipped = await editing(`scenes/${SCENE}.json`, costlierMarsh, () =>
      gameLivePublish(publishInput({ timing: "now", noSwapCheck: true }), onSite(live, fake)),
    );
    expect(skipped.exitCode, skipped.text).toBe(0);
    expect(skipped.text).toContain("  Swaps:    not checked: --no-swap-check");
    expect(dataOf(skipped)).toMatchObject({ swapCheck: null, swapSkipped: "--no-swap-check" });
  });

  it("clamps a timing the game doesn't declare, with a warning, and sends the clamped one", async () => {
    const fake = await fakeLive();
    const r = await gameLivePublish(publishInput({ timing: "now" }), onSite(nextLoad, fake));
    expect(r.exitCode, r.text).toBe(0);
    expect(r.text).toContain(
      "warning: This game accepts only next load; level-1 will reach players then.",
    );
    expect(r.text).toContain("  Fits:     v7 (preview) · timing: next load");
    expect(dataOf(r)).toMatchObject({
      timing: { wanted: "now", timing: "next-load", clamped: true },
      swapCheck: null,
    });
    const begin = fake.requests.find((q) => q.method === "POST" && q.path.endsWith("/live"));
    expect(begin?.body).toMatchObject({ timing: "next-load" });
  });

  it("warns of a quota at or over 80%", async () => {
    const fake = await fakeLive({ liveToday: 84 });
    const r = await gameLivePublish(publishInput(), onSite(live, fake));
    expect(r.exitCode, r.text).toBe(0);
    expect(r.text.split("\n").at(-1)).toBe("warning: scene versions today is 85% full: 85 of 100");
    expect(dataOf(r)).toMatchObject({
      warnings: ["warning: scene versions today is 85% full: 85 of 100"],
      today: { versions: { used: 85, max: 100 } },
    });
  });

  it("--json gives the same fields the lines print", async () => {
    const fake = await fakeLive();
    const r = await gameLivePublish(
      publishInput({ channel: "none", note: "Fewer marsh tiles" }),
      onSite(live, fake),
    );
    expect(r.exitCode, r.text).toBe(0);
    const data = JSON.parse(JSON.stringify(r.data)) as Record<string, unknown>;
    expect(data).toMatchObject({
      ok: true,
      project: "tactics",
      scene: SCENE,
      name: "level-1@1",
      number: 1,
      channel: "none",
      liveOn: null,
      created: true,
      fits: { channel: "production", release: { version: 7 } },
      today: {
        versions: { used: 6, max: 100 },
        releaseStorage: { used: 124 * MIB, max: 512 * MIB },
      },
      gamePage: `${SITE}/games/tactics`,
      warnings: [],
    });
    expect(r.text).toMatch(/^Published tactics level-1@1 \(\w+…\): /);
    expect(r.text).toContain("  Fits:     v7 (production)\n");
    expect(r.text).toContain(
      `Put it on preview with vp run scene game live promote tactics ${SCENE} 1 --channel preview`,
    );
    const begin = fake.requests.find((q) => q.method === "POST" && q.path.endsWith("/live"));
    expect(begin?.body).toMatchObject({ channel: "none", note: "Fewer marsh tiles" });
    expect(begin?.body).not.toHaveProperty("timing");
  });

  it("refuses an unknown timing or channel as usage", async () => {
    const fake = await fakeLive();
    for (const over of [{ timing: "later" }, { channel: "beta" }, { scene: undefined }])
      expect((await gameLivePublish(publishInput(over), onSite(live, fake))).exitCode).toBe(2);
    expect(fake.requests).toEqual([]);
  });
});

describe("game live list, promote, rollback and clear", () => {
  const entry: SceneVersionListEntry = {
    scene: SCENE,
    number: 3,
    id: "a".repeat(64),
    createdAt: "2026-11-10T12:00:00.000Z",
    createdBy: null,
    note: "Fewer marsh tiles",
    physics: "none",
    dataBytes: 14_336,
    compatKey: "b".repeat(64),
    baseReleaseId: null,
    pointers: [{ channel: "preview", timing: "now", since: "2026-11-10T12:00:00.000Z", by: null }],
    blocked: null,
    hidden: null,
    collectedAt: null,
    reports: { ok: 0, failed: 0 },
    removalAt: null,
  };

  it("lists a scene's versions with where each is live", async () => {
    const fake = await fakeLive({
      versions: [
        entry,
        { ...entry, number: 2, pointers: [], note: null, removalAt: "2026-11-24T00:00:00.000Z" },
      ],
    });
    const r = await gameLiveList({ project: "tactics", scene: SCENE }, onSite(live, fake));
    expect(r.exitCode, r.text).toBe(0);
    expect(fake.requests[0]).toMatchObject({
      method: "GET",
      path: `/api/engine/projects/tactics/live?scene=${SCENE}`,
    });
    expect(r.text.split("\n")).toEqual([
      "tactics level-1: 2 scene versions",
      `  level-1@3  aaaaaa…  14 KB  preview (now)  kept  "Fewer marsh tiles"`,
      "  level-1@2  aaaaaa…  14 KB  -  removal 24 Nov 2026",
    ]);
    const empty = await gameLiveList({ project: "tactics" }, onSite(live, await fakeLive()));
    expect(empty.text).toBe(
      "tactics: no scene versions yet; publish one with vp run scene game live publish tactics <scene>",
    );
  });

  it("moves preview's pointer and says where it was", async () => {
    const fake = await fakeLive();
    const on = onSite(nextLoad, fake);
    const promoted = await gameLivePromote(
      { project: "tactics", scene: SCENE, number: "3", channel: "preview", timing: "now" },
      on,
    );
    expect(promoted.exitCode, promoted.text).toBe(0);
    expect(fake.requests.at(-1)?.body).toEqual({ channel: "preview", timing: "next-load" });
    expect(promoted.text.split("\n")).toEqual([
      "tactics level-1: preview now plays level-1@3 (was level-1@2) · timing: next load",
      `  Play:     ${SITE}/games/tactics/play/preview`,
      "warning: This game accepts only next load; level-1 will reach players then.",
    ]);

    const back = await gameLiveRollback(
      { project: "tactics", scene: SCENE, channel: "preview" },
      on,
    );
    expect(back.text.split("\n")[0]).toBe(
      "tactics level-1: preview rolled back to the release's scene (was level-1@3) · timing: next load",
    );
    const stopped = await gameLiveClear(
      { project: "tactics", scene: SCENE, channel: "preview" },
      on,
    );
    expect(stopped.exitCode, stopped.text).toBe(0);
    expect(stopped.text.split("\n")[0]).toBe(
      "tactics level-1: preview stopped level-1@3; players get the release's scene at their next load",
    );
    expect(dataOf(stopped)).toMatchObject({ channel: "preview", from: 3, to: null });
    expect(
      (
        await gameLivePromote(
          { project: "tactics", scene: SCENE, number: "0", channel: "preview" },
          on,
        )
      ).exitCode,
    ).toBe(2);
    expect((await gameLiveRollback({ project: "tactics", scene: SCENE }, on)).exitCode).toBe(2);
  });
});
