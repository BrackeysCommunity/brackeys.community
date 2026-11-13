// @vitest-environment node
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { RELEASE_FILE, type ProjectFile } from "@jams/engine/project";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import {
  plannedRelease,
  type PlannedRelease,
} from "../../../src/lib/engine/__tests__/release-fixture";
import type { UsageLine } from "../../../src/lib/engine/quota";
import { gamePagePath, gamePlayPath } from "../../../src/lib/engine/route-paths";
import { runCli } from "../commands";
import type { ToolContext } from "../context";
import type { HostedSite } from "../hosted";
import type { ProjectHandle } from "../projects";
import {
  channelPlayUrl,
  gamePageOf,
  gameReleaseCreate,
  gameReleaseList,
  gameReleasePromote,
  gameReleaseRollback,
  quotaWarnings,
  RELEASE_FILE_ATTEMPTS,
  type GameReleaseDeps,
  type ReleaseListEntry,
} from "../tools/game-release";

const SITE = "https://staging.example.test";
const TOKEN = "jat_releaseTestSecret";
const PROJECT = "fixture";
const MIB = 1_048_576;

const lineOf = (quota: UsageLine["quota"], used: number, max: number): UsageLine => {
  const ratio = used / max;
  return { quota, used, max, ratio, level: ratio >= 1 ? "full" : ratio >= 0.8 ? "warn" : "ok" };
};

type FakeOptions = {
  /** PUTs of these hashes fail with a dropped connection this many times first. */
  drop?: Map<string, number>;
  /** Release storage after the upload; default 124 MB. */
  storageAfter?: number;
  /** The begin answer's refusal, as the site sends it. */
  beginRefusal?: { status: number; body: Record<string, unknown> };
  releases?: ReleaseListEntry[];
};

type Fake = {
  fetch: typeof fetch;
  stored: Set<string>;
  requests: { method: string; path: string; auth: string | null; body?: unknown }[];
  puts: string[];
};

const err = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

/** The site's release routes over memory: begin dedupes by stored hash, PUT checks the hash is missing, commit checks every file arrived. */
function fakeSite(release: PlannedRelease, opts: FakeOptions = {}): Fake {
  const stored = new Set<string>();
  const uploads = new Map<string, Set<string>>();
  const drop = new Map(opts.drop);
  const requests: Fake["requests"] = [];
  const puts: string[] = [];
  let version = 6;
  const fake: Fake = {
    stored,
    requests,
    puts,
    fetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input : input.url,
      );
      const method = init.method ?? "GET";
      const auth = new Headers(init.headers).get("authorization");
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      requests.push({ method, path: url.pathname, auth, body });
      if (auth !== `Bearer ${TOKEN}`)
        return err(401, { code: "release-forbidden", message: "Authentication required." });
      const base = `/api/engine/projects/${PROJECT}/releases`;

      if (url.pathname === base && method === "POST") {
        if (opts.beginRefusal) return err(opts.beginRefusal.status, opts.beginRefusal.body);
        const missing = release.manifest.build.files
          .filter((f, i, all) => all.findIndex((g) => g.sha256 === f.sha256) === i)
          .filter((f) => !stored.has(f.sha256))
          .map(({ path, sha256, bytes }) => ({ path, sha256, bytes }));
        const uploadId = `up${uploads.size + 1}`;
        uploads.set(uploadId, new Set(missing.map((m) => m.sha256)));
        const before = opts.storageAfter ?? 124 * MIB;
        return Response.json({
          uploadId,
          releaseId: release.releaseId,
          version: null,
          missing,
          usage: {
            before: [lineOf("releaseStorageBytes", before - MIB, 512 * MIB)],
            after: [
              lineOf("assetBytes", 10 * MIB, 256 * MIB),
              lineOf("releaseStorageBytes", before, 512 * MIB),
              lineOf("releasesPerDay", 3, 20),
            ],
          },
        });
      }
      if (url.pathname === base && method === "GET") {
        return Response.json({ releases: opts.releases ?? defaultList(release.releaseId) });
      }
      const put = /^\/api\/engine\/releases\/uploads\/([^/]+)\/files\/([^/]+)$/.exec(url.pathname);
      if (put && method === "PUT") {
        const [, uploadId, hash] = put as unknown as [string, string, string];
        puts.push(hash);
        const left = drop.get(hash) ?? 0;
        if (left > 0) {
          drop.set(hash, left - 1);
          throw new TypeError("fetch failed: socket hang up");
        }
        if (!uploads.get(uploadId)?.has(hash))
          return err(409, { code: "schema", message: "That file isn't missing." });
        stored.add(hash);
        return new Response(null, { status: 204 });
      }
      if (url.pathname === `${base}/commit` && method === "POST") {
        const { uploadId } = body as { uploadId: string };
        const left = [...(uploads.get(uploadId) ?? [])].filter((h) => !stored.has(h));
        if (left.length > 0)
          return err(409, {
            code: "release-files-missing",
            message: `${left.length} files of this upload haven't arrived yet.`,
            hint: "Send every file the upload listed as missing, then commit again.",
          });
        version += 1;
        return Response.json(
          {
            releaseId: release.releaseId,
            version,
            created: true,
            playUrl: `${SITE}/games/${PROJECT}/play/${version}`,
          },
          { status: 201 },
        );
      }
      const move = /\/releases\/(?:(\d+)\/)?(promote|rollback)$/.exec(url.pathname);
      if (move && method === "POST") {
        const { channel } = body as { channel: string };
        if (channel === "production")
          return err(403, {
            code: "release-forbidden",
            message: "Production releases are moved by a person on the game's page.",
            hint: `${SITE}/games/${PROJECT}`,
          });
        return Response.json(
          move[2] === "promote" ? { from: 6, to: Number(move[1]) } : { from: 7, to: 6 },
        );
      }
      return err(404, { code: "not-found", message: "Not found." });
    }) as typeof fetch,
  };
  return fake;
}

const entry = (over: Partial<ReleaseListEntry> & { version: number }): ReleaseListEntry => ({
  id: String(over.version).repeat(64),
  createdAt: "2026-11-01T00:00:00.000Z",
  totalBytes: 38 * MIB,
  fileCount: 212,
  engineVersion: "0.14.1",
  target: "web",
  channels: [],
  jams: [],
  firstPromotedAt: null,
  collectedAt: null,
  hidden: null,
  audience: "publishers",
  removalAt: null,
  playUrl: `${SITE}/games/${PROJECT}/play/${over.version}`,
  ...over,
});

const defaultList = (id: string): ReleaseListEntry[] => [
  entry({ version: 7, id, channels: ["preview"] }),
  entry({ version: 6, channels: ["production"] }),
  entry({ version: 3, removalAt: "2026-11-30T00:00:00.000Z" }),
  entry({ version: 2, removalAt: "2026-11-26T00:00:00.000Z" }),
  entry({ version: 1, collectedAt: "2026-11-03T00:00:00.000Z" }),
];

const ctxFor = (fake: Fake, over: Partial<ToolContext> = {}): ToolContext => ({
  projects: [],
  loadRapier: () => Promise.reject(new Error("no physics here")),
  env: { JAMS_AGENT_TOKEN: TOKEN, JAMS_AGENT_SITE: SITE },
  fetch: fake.fetch,
  ...over,
});

const noWait: GameReleaseDeps = { retryDelayMs: () => 0 };

async function writeBuild(dir: string, release: PlannedRelease) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, RELEASE_FILE), release.text);
  for (const [path, bytes] of release.files) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), bytes);
  }
}

let root: string;
let release: PlannedRelease;
let build: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "jams-release-test-"));
  release = await plannedRelease({ projectId: PROJECT });
  build = join(root, "build");
  await writeBuild(build, release);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const fromBuild = { project: PROJECT, hosted: false, allowOverBudget: false };

describe("game release create", () => {
  it("uploads the missing files, commits and prints the release, its quotas and the next removal", async () => {
    const fake = fakeSite(release);
    const result = await gameReleaseCreate({ ...fromBuild, from: build }, ctxFor(fake), noWait);
    expect(result.exitCode).toBe(0);
    const unique = new Set(release.manifest.build.files.map((f) => f.sha256));
    expect(fake.stored).toEqual(unique);
    expect(fake.requests.every((r) => r.auth === `Bearer ${TOKEN}`)).toBe(true);
    expect(fake.requests[0]?.body).toEqual({ manifest: release.text, channel: "preview" });

    const lines = result.text.split("\n");
    expect(lines[0]).toMatch(
      new RegExp(
        `^Released ${PROJECT} v7 \\(${release.releaseId.slice(0, 6)}…\\) to preview: .+, \\d+ files, .+ new\\.$`,
      ),
    );
    expect(lines.slice(1)).toEqual([
      `  Play:     ${SITE}/games/${PROJECT}/play/7`,
      "  Storage:  124 MB of 512 MB release storage · 4 of 10 releases kept",
      "  Removal:  v2 on 26 Nov 2026 (not pinned)",
      `Promote it to production on the game's page: ${SITE}/games/${PROJECT}`,
    ]);
  });

  it("sends a dropped file again", async () => {
    const [victim] = release.manifest.build.files;
    const fake = fakeSite(release, { drop: new Map([[victim!.sha256, 1]]) });
    const result = await gameReleaseCreate({ ...fromBuild, from: build }, ctxFor(fake), noWait);
    expect(result.exitCode).toBe(0);
    expect(fake.puts.filter((h) => h === victim!.sha256)).toHaveLength(2);
    expect((result.data as { uploaded: { retries: number } }).uploaded.retries).toBe(1);
  });

  it("resumes after a file that kept dropping: the next run sends only what the site still lacks", async () => {
    const [victim] = release.manifest.build.files;
    const fake = fakeSite(release, {
      drop: new Map([[victim!.sha256, RELEASE_FILE_ATTEMPTS]]),
    });
    const failed = await gameReleaseCreate({ ...fromBuild, from: build }, ctxFor(fake), noWait);
    expect(failed.exitCode).toBe(1);
    expect(failed.text).toContain("socket hang up");
    expect(fake.requests.some((r) => r.path.endsWith("/commit"))).toBe(false);

    // The failed run stops starting files once one gives up, so how many others landed depends on timing.
    const lacking = [...new Set(release.manifest.build.files.map((f) => f.sha256))].filter(
      (hash) => !fake.stored.has(hash),
    );
    expect(lacking).toContain(victim!.sha256);
    const before = fake.puts.length;
    const resumed = await gameReleaseCreate({ ...fromBuild, from: build }, ctxFor(fake), noWait);
    expect(resumed.exitCode).toBe(0);
    expect(fake.puts.slice(before).sort()).toEqual([...lacking].sort());
    expect(resumed.data).toMatchObject({ uploaded: { files: lacking.length } });
  });

  it("prints an amber warning: line for each quota at or over 80%", async () => {
    const fake = fakeSite(release, { storageAfter: 440 * MIB });
    const result = await gameReleaseCreate({ ...fromBuild, from: build }, ctxFor(fake), noWait);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain("  Storage:  440 MB of 512 MB release storage");
    expect(result.text.split("\n").filter((l) => l.startsWith("warning:"))).toEqual([
      "warning: release storage is 85% full: 440 MB of 512 MB",
    ]);

    const full = await gameReleaseCreate(
      { ...fromBuild, from: build },
      ctxFor(fakeSite(release, { storageAfter: 512 * MIB })),
      noWait,
    );
    expect(full.text).toContain("warning: release storage is full: 512 MB of 512 MB");
  });

  it("names each quota in its warning as the site's usage rows do", () => {
    const line = (quota: UsageLine["quota"], used: number, max: number): UsageLine => ({
      quota,
      used,
      max,
      ratio: used / max,
      level: used >= max ? "full" : "warn",
    });
    expect(
      quotaWarnings([line("jamPins", 8, 8), line("assetBytes", 220 * MIB, 256 * MIB)]),
    ).toEqual([
      "warning: jam versions is full: 8 of 8",
      "warning: asset storage is 85% full: 220 MB of 256 MB",
    ]);
  });

  it("gives the same fields as JSON with --json", async () => {
    const fake = fakeSite(release, { storageAfter: 440 * MIB });
    const out = await runCli(
      ["game", "release", "create", PROJECT, "--from", build, "--json"],
      ctxFor(fake),
    );
    expect(out.exitCode).toBe(0);
    const data = JSON.parse(out.stdout) as Record<string, unknown>;
    expect(data).toMatchObject({
      ok: true,
      project: PROJECT,
      version: 7,
      releaseId: release.releaseId,
      shortId: release.releaseId.slice(0, 6),
      channel: "preview",
      files: release.manifest.build.files.length,
      playUrl: `${SITE}/games/${PROJECT}/play/7`,
      gamePage: `${SITE}/games/${PROJECT}`,
      kept: { count: 4, max: 10 },
      nextRemoval: { version: 2, at: "2026-11-26T00:00:00.000Z" },
      warnings: ["warning: release storage is 85% full: 440 MB of 512 MB"],
    });
    expect(data.newBytes).toBe((data.bytes as number) - release.text.length);
    expect((data.usage as { after: UsageLine[] }).after).toHaveLength(3);
  });

  it("prints a refusal's code, message and hint", async () => {
    const fake = fakeSite(release, {
      beginRefusal: {
        status: 413,
        body: {
          code: "quota-exceeded",
          limit: "releaseStorageBytes",
          used: 498 * MIB,
          max: 512 * MIB,
          message:
            "This release adds 30 MB, and the project's releases already use 498 MB of 512 MB.",
          hint: "Old releases are removed 14 days after they leave the 10 newest.",
        },
      },
    });
    const result = await gameReleaseCreate({ ...fromBuild, from: build }, ctxFor(fake), noWait);
    expect(result.exitCode).toBe(1);
    expect(result.text).toBe(
      [
        "error: quota-exceeded: This release adds 30 MB, and the project's releases already use 498 MB of 512 MB.",
        "  Old releases are removed 14 days after they leave the 10 newest.",
      ].join("\n"),
    );
    expect(result.data).toMatchObject({ code: "quota-exceeded", limit: "releaseStorageBytes" });
  });

  it("never sends a release to production, and names the game's page", async () => {
    const fake = fakeSite(release);
    const result = await gameReleaseCreate(
      { ...fromBuild, from: build, channel: "production" },
      ctxFor(fake),
    );
    expect(result.exitCode).toBe(2);
    expect(result.text).toContain(`${SITE}/games/${PROJECT}`);
    expect(fake.requests).toEqual([]);
  });

  it("asks for the site and the token when neither is set", async () => {
    const fake = fakeSite(release);
    const noSite = await gameReleaseCreate(
      { ...fromBuild, from: build },
      ctxFor(fake, { env: { JAMS_AGENT_TOKEN: TOKEN } }),
    );
    expect(noSite.exitCode).toBe(2);
    expect(noSite.text).toContain("JAMS_AGENT_SITE");
    const noToken = await gameReleaseCreate(
      { ...fromBuild, from: build },
      ctxFor(fake, { env: { JAMS_AGENT_SITE: SITE } }),
    );
    expect(noToken.exitCode).toBe(2);
    expect(noToken.text).toContain("JAMS_AGENT_TOKEN");
  });

  it("with --hosted, builds from a temporary copy the hosted project was pulled into", async () => {
    const projectDir = join(root, "games", "deck");
    await mkdir(join(projectDir, "scenes"), { recursive: true });
    await mkdir(join(projectDir, "node_modules"), { recursive: true });
    await writeFile(join(projectDir, "scenes", "hall.json"), "{}\n");
    const file = { kind: "project", v: 1, id: PROJECT, name: "Fixture", game: null } as ProjectFile;
    const local = { dir: projectDir, file, cacheDir: join(root, "cache") } as ProjectHandle;

    const seen: { pullOut?: string; pullUrl?: string; buildDir?: string; copied?: string[] } = {};
    const deps: GameReleaseDeps = {
      ...noWait,
      pull: async (input) => {
        seen.pullOut = input.out;
        seen.pullUrl = input.url;
        seen.copied = await readdir(input.out!);
        await writeFile(join(input.out!, "scenes", "hall.json"), '{"pulled":true}\n');
        return { exitCode: 0, data: { ok: true }, text: "" };
      },
      build: async (input, ctx) => {
        const [handle] = ctx.projects;
        seen.buildDir = handle!.dir;
        expect(await readFile(join(handle!.dir, "scenes", "hall.json"), "utf8")).toContain(
          "pulled",
        );
        await writeBuild(input.out!, release);
        return {
          result: { exitCode: 0, data: { ok: true }, text: "" },
          built: { project: handle!, out: input.out!, report: "", plan: {} as never, release: "" },
        };
      },
    };
    const fake = fakeSite(release);
    const result = await gameReleaseCreate(
      { project: PROJECT, hosted: true, allowOverBudget: false },
      ctxFor(fake, { projects: [local] }),
      deps,
    );
    expect(result.exitCode).toBe(0);
    expect(seen.pullUrl).toBe(SITE);
    expect(dirname(seen.pullOut!)).toBe(dirname(projectDir));
    expect(basename(seen.pullOut!)).toMatch(/^\.deck-release-/);
    expect(seen.copied).toEqual(["scenes"]);
    expect(seen.buildDir).toBe(seen.pullOut);
    await expect(stat(seen.pullOut!)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(projectDir, "scenes", "hall.json"), "utf8")).toBe("{}\n");
  });
});

describe("game release list", () => {
  it("lists the releases newest first with their channels and removal dates", async () => {
    const fake = fakeSite(release);
    const result = await gameReleaseList({ project: PROJECT }, ctxFor(fake));
    expect(result.exitCode).toBe(0);
    const lines = result.text.split("\n");
    expect(lines[0]).toBe(`${PROJECT}: 5 releases, 4 of 10 kept`);
    expect(lines[1]).toMatch(/^ {2}v7 .+ 38 MB {2}212 files {2}web {2}preview {2}kept$/);
    expect(lines[4]).toMatch(/removal 26 Nov 2026$/);
    expect(lines[5]).toMatch(/removed 3 Nov 2026$/);
  });
});

describe("game release promote and rollback", () => {
  it("move preview", async () => {
    const fake = fakeSite(release);
    const promoted = await gameReleasePromote(
      { project: PROJECT, version: "7", channel: "preview" },
      ctxFor(fake),
    );
    expect(promoted.exitCode).toBe(0);
    expect(promoted.text).toBe(
      [
        `${PROJECT}: preview now names v7 (was v6)`,
        `  Play:     ${SITE}/games/${PROJECT}/play/preview`,
      ].join("\n"),
    );
    expect(fake.requests.at(-1)).toMatchObject({
      method: "POST",
      path: `/api/engine/projects/${PROJECT}/releases/7/promote`,
      body: { channel: "preview" },
    });
    const rolled = await gameReleaseRollback(
      { project: PROJECT, channel: "preview" },
      ctxFor(fake),
    );
    expect(rolled.text).toContain("preview rolled back to v6 (was v7)");
    expect(fake.requests.at(-1)?.path).toBe(`/api/engine/projects/${PROJECT}/releases/rollback`);
  });

  it("print the site's production refusal and the game's page", async () => {
    const fake = fakeSite(release);
    for (const out of [
      await runCli(
        ["game", "release", "promote", PROJECT, "7", "--channel", "production"],
        ctxFor(fake),
      ),
      await runCli(
        ["game", "release", "rollback", PROJECT, "--channel", "production"],
        ctxFor(fake),
      ),
    ]) {
      expect(out.exitCode).toBe(1);
      expect(out.stderr).toBe(
        [
          "error: release-forbidden: Production releases are moved by a person on the game's page.",
          `  ${SITE}/games/${PROJECT}`,
          "",
        ].join("\n"),
      );
    }
  });

  it("need a channel and a version", async () => {
    const fake = fakeSite(release);
    expect(
      (await gameReleasePromote({ project: PROJECT, version: "7" }, ctxFor(fake))).exitCode,
    ).toBe(2);
    expect(
      (
        await gameReleasePromote(
          { project: PROJECT, version: "x", channel: "preview" },
          ctxFor(fake),
        )
      ).exitCode,
    ).toBe(2);
    expect(fake.requests).toEqual([]);
  });
});

describe("game links", () => {
  const site = { origin: SITE } as HostedSite;

  it("are the site's game page and channel play paths on the hosted origin", () => {
    const id = "my game/2";
    expect(gamePageOf(site, id)).toBe(`${SITE}${gamePagePath(id)}`);
    expect(gamePageOf(site, id)).toBe(`${SITE}/games/my%20game%2F2`);
    expect(channelPlayUrl(site, id, "preview")).toBe(`${SITE}${gamePlayPath(id)}/preview`);
    expect(channelPlayUrl(site, id, "preview")).toBe(`${SITE}/games/my%20game%2F2/play/preview`);
  });
});
