// @vitest-environment node
import { cp, glob, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkItchLayout, formatBytes, zipFiles } from "@jams/engine/export";
import {
  checkReleaseManifest,
  parseReleaseManifest,
  PROJECT_FILE,
  projectGlobs,
  RELEASE_FILE,
  sha256,
  type ReleaseManifest,
  type Sha256,
} from "@jams/engine/project";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { ReportedChunk } from "../../engine-bundle-report";
import { runCli } from "../commands";
import type { ToolContext } from "../context";
import { REPO_ROOT } from "../default-context";
import { ENGINE_PACKAGE_DIR, ensurePackedEngine } from "../engine-dist";
import { DEFAULT_PROJECT_GLOBS, discoverProjects, type ProjectHandle } from "../projects";
import { loadCompatRapier } from "../rapier-compat";
import { bundleReportDir, gameBuild, type GameBuildInput } from "../tools/game-build";
import { gameExport } from "../tools/game-export";
import { filesUnder, gameManifest, replayRelease } from "../tools/game-manifest";
import { GAME_NEW_STAGE } from "../tools/game-new";
import { hostedSite } from "./fixtures/hosted-site";

vi.mock("@/db", () => ({ db: {} }));

/** A Vite build of a whole game: well past the default timeout, bounded by the build itself. */
const BUILD_MS = 300_000;
/** Packing the engine first (`ensurePackedEngine`, bounded by its own pack timeout), then discovering projects. */
const PACK_MS = 720_000;
const ROOT = join(GAME_NEW_STAGE, `game-build-${process.pid}-${Date.now()}`);
const BUILDS = join(ROOT, "builds");
/** Builds of copies, kept out of `BUILDS` so `replay --releases` finds only the repo's own. */
const ASIDE = join(ROOT, "aside");
const out = (id: string, target: string) => join(BUILDS, id, target);
const TACTICS_RECORDING = join(
  REPO_ROOT,
  "src/games/tactics/__tests__/fixtures/level-1.recording.json",
);

let ctx: ToolContext;

type Built = {
  exitCode: number;
  manifest: ReleaseManifest;
  release: string;
  dir: string;
  text: string;
  data: Record<string, unknown>;
};
const built: Partial<Record<"tactics" | "platformer", Built>> = {};

/** Builds `input.id` with `with` as its context, into `input.out`; the exit code is the caller's to check. */
async function buildWith(with_: ToolContext, input: GameBuildInput & { out: string }) {
  const result = await gameBuild(input, with_);
  const parsed = parseReleaseManifest(await readFile(join(input.out, RELEASE_FILE), "utf8"));
  if (!parsed.ok) throw new Error(`${result.text}\n${JSON.stringify(parsed.issues)}`);
  const data = result.data as Record<string, unknown> & { release: string };
  return {
    exitCode: result.exitCode,
    manifest: parsed.manifest,
    release: data.release,
    dir: input.out,
    text: result.text,
    data,
  } satisfies Built;
}

async function buildInto(
  id: "tactics" | "platformer",
  opts: { rapier?: "compat"; dir?: string } = {},
): Promise<Built> {
  const dir = opts.dir ?? out(id, "web");
  const b = await buildWith(ctx, {
    id,
    target: "web",
    out: dir,
    allowOverBudget: false,
    ...(opts.rapier ? { rapier: opts.rapier } : {}),
  });
  expect(b.exitCode, b.text).toBe(0);
  return b;
}

/** A project directory under the stage (so its imports resolve): its project file's code copied from `from`. */
async function copyCode(from: string, to: string) {
  const file = JSON.parse(await readFile(join(from, PROJECT_FILE), "utf8"));
  const { code } = projectGlobs(file);
  const exclude = code.filter((g) => g.startsWith("!")).map((g) => g.slice(1));
  for (const pattern of code.filter((g) => !g.startsWith("!")))
    for await (const path of glob(pattern, { cwd: from, exclude }) as AsyncIterable<string>) {
      await mkdir(dirname(join(to, path)), { recursive: true });
      await cp(join(from, path), join(to, path));
    }
}

/** The one project found in `dir`, with its own cache. */
async function projectAt(dir: string): Promise<ProjectHandle> {
  const [project] = await discoverProjects(dir, [PROJECT_FILE], {
    cacheDirOf: (id) => join(dir, "..", `.cache-${id}`),
  });
  if (!project) throw new Error(`no project in ${dir}`);
  return project;
}

async function hashedFiles(dir: string): Promise<Map<string, Sha256>> {
  const files = new Map<string, Sha256>();
  for (const path of await filesUnder(dir))
    if (path !== RELEASE_FILE)
      files.set(path, await sha256(new Uint8Array(await readFile(join(dir, path)))));
  return files;
}

/** Every file under `dir`, `release.json` included, by its hash. */
async function everyFile(dir: string): Promise<Record<string, Sha256>> {
  const files: Record<string, Sha256> = {};
  for (const path of await filesUnder(dir))
    files[path] = await sha256(new Uint8Array(await readFile(join(dir, path))));
  return files;
}

/** A new directory outside the stage, so a second build's path shares nothing with the first's. */
const elsewhere = async (name: string) => {
  const dir = await mkdtemp(join(tmpdir(), `game-build-${name}-`));
  elsewhereDirs.push(dir);
  return dir;
};
const elsewhereDirs: string[] = [];

async function bundleReport(dir: string): Promise<ReportedChunk[]> {
  const text = await readFile(join(bundleReportDir(dir), "client.json"), "utf8");
  return (JSON.parse(text) as { chunks: ReportedChunk[] }).chunks;
}

const holdsRapier = (chunk: ReportedChunk) =>
  Object.keys(chunk.modules).some((id) => id.includes("/@dimforge/rapier2d"));

beforeAll(async () => {
  const unpacked = await ensurePackedEngine();
  if (unpacked) throw new Error(unpacked);
  await mkdir(BUILDS, { recursive: true });
  const projects = await discoverProjects(REPO_ROOT, DEFAULT_PROJECT_GLOBS, {
    cacheDirOf: (id) => join(ROOT, "cache", id),
  });
  ctx = { projects, loadRapier: loadCompatRapier, rapierFlavour: "rapier2d-compat" };
}, PACK_MS);

afterAll(async () => {
  if (process.env.KEEP_GAME_BUILD) return;
  await rm(ROOT, { recursive: true, force: true });
  for (const dir of elsewhereDirs) await rm(dir, { recursive: true, force: true });
});

describe("game build", () => {
  it(
    "builds tactics: the manifest holds together with its files, and no Rapier ships",
    async () => {
      const t = (built.tactics = await buildInto("tactics"));
      const files = await hashedFiles(t.dir);
      expect(t.manifest.budget.measured.wasmBytes).toBe(0);
      expect(t.text).toContain("\n  wasm: 0 B (no listed scene uses Rapier)\n");
      expect(t.text.match(/\bwasm: /g)).toHaveLength(1);
      expect(t.data.wasm).toEqual({
        bytes: 0,
        package: null,
        version: null,
        inlined: false,
        scenes: [],
      });
      expect(await checkReleaseManifest(t.manifest, files)).toEqual([]);
      expect([...files.keys()].sort()).toEqual(t.manifest.build.files.map((f) => f.path).sort());

      expect(t.manifest.build.rapier).toBeNull();
      expect(t.manifest.flow.scenes.every((s) => s.physics === "none")).toBe(true);
      expect([...files.keys()].filter((p) => p.endsWith(".wasm"))).toEqual([]);
      const entry = await readFile(join(t.dir, t.manifest.build.entry), "utf8");
      expect(entry).not.toMatch(/import\([^)]*rapier/i);
      expect((await bundleReport(t.dir)).filter(holdsRapier)).toEqual([]);
      expect(await readFile(join(t.dir, "index.html"), "utf8")).toContain(t.manifest.build.entry);
    },
    BUILD_MS,
  );

  it(
    "builds the platformer: the wasm ships as its own file, behind a dynamic import from the entry",
    async () => {
      const p = (built.platformer = await buildInto("platformer"));
      const files = await hashedFiles(p.dir);
      expect(await checkReleaseManifest(p.manifest, files)).toEqual([]);

      const wasm = p.manifest.build.files.filter((f) => f.role === "wasm");
      expect(wasm).toHaveLength(1);
      expect(p.manifest.build.rapier).toMatchObject({
        package: "@dimforge/rapier2d",
        file: wasm[0]!.path,
        bytes: wasm[0]!.bytes,
      });
      const chunks = await bundleReport(p.dir);
      const entry = chunks.find((c) => c.isEntry);
      expect(entry?.fileName).toBe(p.manifest.build.entry);
      expect(holdsRapier(entry!)).toBe(false);
      const lazy = chunks.filter((c) => entry!.dynamicImports.includes(c.fileName));
      expect(lazy.some(holdsRapier)).toBe(true);

      const { size } = await stat(join(p.dir, wasm[0]!.path));
      expect(p.manifest.budget.measured.wasmBytes).toBe(size);
      const rapierScenes = p.manifest.flow.scenes
        .filter((s) => s.physics === "rapier")
        .map((s) => s.id);
      expect(rapierScenes.length).toBeGreaterThan(0);
      const { version } = p.manifest.build.rapier!;
      expect(p.text).toContain(
        `\n  wasm: ${formatBytes(size)} (@dimforge/rapier2d ${version}, scenes: ${rapierScenes.join(", ")})\n`,
      );
      expect(p.data.wasm).toEqual({
        bytes: size,
        package: "@dimforge/rapier2d",
        version,
        inlined: false,
        scenes: rapierScenes,
      });
    },
    BUILD_MS,
  );

  it("refuses a target with no row before writing anything", async () => {
    const dir = out("tactics", "desktop");
    const result = await gameBuild(
      { id: "tactics", target: "desktop", out: dir, allowOverBudget: false },
      ctx,
    );
    expect(result.exitCode).toBe(1);
    expect(result.text).toContain("export-target-unsupported");
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to empty a directory that isn't an earlier build", async () => {
    const dir = join(ROOT, "not-a-build");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "keep.txt"), "mine\n");
    const result = await gameBuild({ id: "tactics", out: dir, allowOverBudget: false }, ctx);
    expect(result.exitCode).toBe(1);
    expect(await readFile(join(dir, "keep.txt"), "utf8")).toBe("mine\n");
  });

  it("names the projects for an unknown id", async () => {
    const result = await gameBuild({ id: "tactic", allowOverBudget: false }, ctx);
    expect(result.exitCode).toBe(2);
    expect(result.text).toContain('did you mean "tactics"');
  });
});

describe("a second build of the same snapshot", () => {
  it.each(["tactics", "platformer"] as const)(
    "%s built again into another temp dir is byte-identical, file by file and release.json included",
    async (id) => {
      const first = built[id]!;
      const again = await buildInto(id, { dir: join(await elsewhere(id), "out") });
      expect(again.release).toBe(first.release);
      expect(await readFile(join(again.dir, RELEASE_FILE), "utf8")).toBe(
        await readFile(join(first.dir, RELEASE_FILE), "utf8"),
      );
      expect(await everyFile(again.dir)).toEqual(await everyFile(first.dir));
    },
    BUILD_MS,
  );
});

/** The packed entries no export may load. */
const DEV_ENTRIES = ["editor", "editor-ui", "debug", "vite"];

/** `dist/<file>`'s own relative imports, static and dynamic. */
async function distImports(dist: string, file: string): Promise<string[]> {
  const text = await readFile(join(dist, file), "utf8");
  const specs = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']\.\/([^"']+\.mjs)["']/g)];
  return specs.map((m) => m[1]!);
}

/** Every `dist/` file reachable from `entries`, the entries included. */
async function distClosure(dist: string, entries: string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...(await distImports(dist, file)));
  }
  return seen;
}

/** The packed files only the dev entries reach: each entry file and the chunks no other entry imports. */
async function devOnlyDistFiles(): Promise<string[]> {
  const dist = join(ENGINE_PACKAGE_DIR, "dist");
  const pkg = JSON.parse(await readFile(join(ENGINE_PACKAGE_DIR, "package.json"), "utf8")) as {
    exports: Record<string, string | { import?: string }>;
  };
  const entries = Object.entries(pkg.exports).flatMap(([key, target]) => {
    const file = typeof target === "string" ? null : target.import;
    return file?.startsWith("./dist/")
      ? [{ key: key.slice(2) || "index", file: file.slice(7) }]
      : [];
  });
  const dev = await distClosure(
    dist,
    entries.filter((e) => DEV_ENTRIES.includes(e.key)).map((e) => e.file),
  );
  const shipped = await distClosure(
    dist,
    entries.filter((e) => !DEV_ENTRIES.includes(e.key)).map((e) => e.file),
  );
  return [...dev].filter((f) => !shipped.has(f)).sort();
}

describe("the export resolves the packaged engine", () => {
  it.each(["tactics", "platformer"] as const)(
    "%s bundles @jams/engine from node_modules/@jams/engine/dist, never packages/engine source or a dev entry",
    async (id) => {
      const modules = (await bundleReport(built[id]!.dir)).flatMap((c) => Object.keys(c.modules));
      const packed = modules.filter((m) => m.includes("/node_modules/@jams/engine/dist/"));
      expect(packed.length).toBeGreaterThan(0);
      expect(modules.filter((m) => m.includes("/packages/engine/"))).toEqual([]);

      const devOnly = await devOnlyDistFiles();
      expect(devOnly).toEqual(expect.arrayContaining(DEV_ENTRIES.map((e) => `${e}.mjs`)));
      expect(packed.filter((m) => devOnly.some((f) => m.endsWith(`/dist/${f}`)))).toEqual([]);
    },
  );
});

describe("Rapier and the budget", () => {
  it(
    "--rapier compat ships -compat with its wasm inlined: no .wasm file, and more code",
    async () => {
      const standard = built.platformer!;
      const c = await buildInto("platformer", {
        rapier: "compat",
        dir: join(ASIDE, "platformer", "web-compat"),
      });
      const files = await hashedFiles(c.dir);
      expect(await checkReleaseManifest(c.manifest, files)).toEqual([]);
      expect([...files.keys()].filter((p) => p.endsWith(".wasm"))).toEqual([]);
      expect(c.manifest.build.files.filter((f) => f.role === "wasm")).toEqual([]);
      expect(c.manifest.build.rapier).toMatchObject({
        package: "@dimforge/rapier2d-compat",
        file: null,
      });
      expect(c.manifest.budget.measured.wasmBytes).toBe(0);
      expect(c.manifest.budget.measured.codeBytes).toBeGreaterThan(
        standard.manifest.budget.measured.codeBytes,
      );
      expect(c.text).toMatch(
        /\n {2}wasm: 0 B \(@dimforge\/rapier2d-compat \S+ inlined in the code/,
      );
      expect(c.data.wasm).toMatchObject({ bytes: 0, inlined: true });
    },
    BUILD_MS,
  );

  it(
    "a project over its export.budget writes the build and fails, unless --allow-over-budget",
    async () => {
      const dir = join(ROOT, "over-budget", "tactics");
      const tactics = join(REPO_ROOT, "src", "games", "tactics");
      await cp(tactics, dir, {
        recursive: true,
        filter: (src) => !src.split(/[\\/]/).includes("__tests__"),
      });
      const file = JSON.parse(await readFile(join(dir, PROJECT_FILE), "utf8"));
      await writeFile(
        join(dir, PROJECT_FILE),
        `${JSON.stringify({ ...file, export: { ...file.export, budget: { totalBytes: 1 } } })}\n`,
      );
      const over: ToolContext = { ...ctx, projects: [await projectAt(dir)] };

      const refused = await buildWith(over, {
        id: "tactics",
        out: join(ASIDE, "over-budget", "refused"),
        allowOverBudget: false,
      });
      expect(refused.exitCode, refused.text).toBe(1);
      const issues = refused.data.issues as { code: string; detail?: { budget?: string } }[];
      const budget = issues.filter((i) => i.code === "export-over-budget");
      expect(budget.map((i) => i.detail?.budget)).toEqual(["totalBytes"]);
      expect(refused.text).toContain("export-over-budget");
      expect(refused.text).toContain("--allow-over-budget accepts it");
      expect(refused.manifest.budget).toMatchObject({
        limits: { totalBytes: 1 },
        over: ["totalBytes"],
      });
      expect(refused.data).toMatchObject({ ok: false, overBudget: true });

      const allowed = await buildWith(over, {
        id: "tactics",
        out: join(ASIDE, "over-budget", "allowed"),
        allowOverBudget: true,
      });
      expect(allowed.exitCode, allowed.text).toBe(0);
      expect(allowed.data).toMatchObject({ ok: true, overBudget: true });
      expect(allowed.release).toBe(refused.release);
    },
    2 * BUILD_MS,
  );
});

describe("hosted to git: pushed, pulled and built", () => {
  const SITE = "https://staging.example.test";
  const TOKEN = "jat_gameBuildTestSecret";
  let site: ToolContext;
  let checkout: string | undefined;
  const hosted = hostedSite({
    token: TOKEN,
    reserved: { tactics: "Tactics" },
    handle: (id) => site.projects.find((p) => p.file.id === id)!,
  });

  afterAll(async () => {
    if (checkout) await rm(checkout, { recursive: true, force: true });
  });

  it(
    "tactics pushed to the hosted harness, pulled to a temp dir with its code from git, builds the same release.json byte for byte",
    async () => {
      const repo = built.tactics!;
      site = { ...ctx, fetch: hosted.fetch, env: {} };
      const tactics = site.projects.find((p) => p.file.id === "tactics")!;
      const cli = async (...argv: string[]) => {
        const r = await runCli([...argv, "--url", SITE, "--token", TOKEN, "--json"], site);
        expect(r.exitCode, `${argv.join(" ")}\n${r.stdout}\n${r.stderr}`).toBe(0);
        return JSON.parse(r.stdout) as Record<string, unknown>;
      };
      expect(await cli("project", "push", tactics.dir, "--create")).toMatchObject({
        ok: true,
        project: "tactics",
      });
      expect(hosted.projects.get("tactics")?.game).toBe("tactics");

      // A checkout of its own, as a person pulls one: outside this repo, its packages beside it.
      checkout = await mkdtemp(join(tmpdir(), "game-build-pulled-"));
      await symlink(join(REPO_ROOT, "node_modules"), join(checkout, "node_modules"), "dir");
      const dir = join(checkout, "tactics");
      const pulled = await cli("project", "pull", "tactics", "--out", dir);
      expect(pulled).toMatchObject({ written: true, skipped: [] });
      await expect(stat(join(dir, "index.ts"))).rejects.toMatchObject({ code: "ENOENT" });
      await copyCode(tactics.dir, dir);

      const b = await buildWith(
        { ...ctx, projects: [await projectAt(dir)] },
        {
          id: "tactics",
          target: "web",
          out: join(ASIDE, "pulled", "web"),
          allowOverBudget: false,
        },
      );
      expect(b.exitCode, b.text).toBe(0);
      expect(b.release).toBe(repo.release);
      expect(await readFile(join(b.dir, RELEASE_FILE), "utf8")).toBe(
        await readFile(join(repo.dir, RELEASE_FILE), "utf8"),
      );
      expect(await hashedFiles(b.dir)).toEqual(await hashedFiles(repo.dir));
    },
    BUILD_MS,
  );
});

describe("game manifest", () => {
  it("checks both builds with their files, and a lone release.json without", async () => {
    for (const b of [built.tactics!, built.platformer!]) {
      const withFiles = await gameManifest({ path: b.dir }, ctx);
      expect(withFiles.exitCode, withFiles.text).toBe(0);
      expect(withFiles.data).toMatchObject({ ok: true, release: b.release, filesChecked: true });
      expect((withFiles.data as { unlisted: string[] }).unlisted).toEqual([]);
      const alone = await gameManifest({ path: join(b.dir, RELEASE_FILE) }, ctx);
      expect(alone.exitCode, alone.text).toBe(0);
      expect(alone.data).toMatchObject({ filesChecked: false });
    }
    const checked = await gameManifest({ path: built.tactics!.dir }, ctx);
    expect(checked.text).toContain("\n  wasm: 0 B (no listed scene uses Rapier)\n");
    expect(checked.text).not.toContain("physics none");
    expect((checked.data as { wasm: unknown }).wasm).toEqual(built.tactics!.data.wasm);
  });

  it("fails a build whose file changed after it was written", async () => {
    const t = built.tactics!;
    const copy = join(ROOT, "tampered");
    await cp(t.dir, copy, { recursive: true });
    const data = t.manifest.build.files.find((f) => f.role === "data")!;
    await writeFile(join(copy, data.path), "{}\n");
    const result = await gameManifest({ path: copy }, ctx);
    expect(result.exitCode).toBe(1);
    expect(result.text).toContain("hash-mismatch");
  });
});

describe("game export --zip", () => {
  const zip = join(ROOT, "tactics-itch.zip");

  it(
    "writes tactics' itch zip, which fits itch.io's layout",
    async () => {
      const dir = out("tactics", "itch");
      const result = await gameExport({ id: "tactics", zip: true, out: zip, buildOut: dir }, ctx);
      expect(result.exitCode, result.text).toBe(0);
      expect(result.data).toMatchObject({ buildTarget: "itch", layoutChecked: true, zip });

      const files = await Promise.all(
        (await filesUnder(dir)).map(async (path) => ({
          path,
          bytes: new Uint8Array(await readFile(join(dir, path))),
        })),
      );
      expect(checkItchLayout(files.map((f) => ({ path: f.path, bytes: f.bytes.length })))).toEqual(
        [],
      );
      const written = new Uint8Array(await readFile(zip));
      expect(written).toEqual(zipFiles(files));
      expect(files.map((f) => f.path)).not.toContain("sw.js");
    },
    BUILD_MS,
  );

  it(
    "a second export of tactics, built and zipped elsewhere, is the same zip byte for byte",
    async () => {
      const dir = await elsewhere("zip");
      const again = join(dir, "again.zip");
      const result = await gameExport(
        { id: "tactics", zip: true, out: again, buildOut: join(dir, "out") },
        ctx,
      );
      expect(result.exitCode, result.text).toBe(0);
      expect(await everyFile(join(dir, "out"))).toEqual(await everyFile(out("tactics", "itch")));
      const [first, second] = await Promise.all([readFile(zip), readFile(again)]);
      expect(second.length).toBe(first.length);
      expect(second.equals(first)).toBe(true);
    },
    BUILD_MS,
  );

  it("asks for --zip", async () => {
    expect((await gameExport({ id: "tactics", zip: false }, ctx)).exitCode).toBe(2);
  });
});

describe("replay --releases", () => {
  const recordingWith = async (patch: Record<string, unknown>) => {
    const recording = { ...JSON.parse(await readFile(TACTICS_RECORDING, "utf8")), ...patch };
    const file = join(ROOT, `run-${Object.keys(patch).join("-") || "plain"}.json`);
    await writeFile(file, `${JSON.stringify(recording)}\n`);
    return file;
  };
  const replayOf = (run: string) =>
    replayRelease({ scene: "level-1", run, releases: BUILDS }, { ...ctx, project: "tactics" });

  it("finds the build a run names by its release id", async () => {
    const t = built.tactics!;
    const result = await replayOf(await recordingWith({ release: t.release }));
    expect(result.exitCode, result.text).toBe(0);
    expect(result.data).toMatchObject({
      release: { id: t.release, dir: t.dir, matchedBy: "release" },
    });
    expect(result.text).toContain(`release ${t.release}`);
  });

  it("falls back to the build with the run's snapshot and engine", async () => {
    const t = built.tactics!;
    const run = await recordingWith({
      project: { id: "tactics", snapshot: t.manifest.project.snapshot },
      engine: { version: t.manifest.engine.version, physics: null },
    });
    const result = await replayOf(run);
    expect((result.data as { release: { matchedBy: string } | null }).release).toMatchObject({
      matchedBy: "snapshot",
    });
  });

  it("says when no build matches", async () => {
    const result = await replayOf(TACTICS_RECORDING);
    expect(result.exitCode, result.text).toBe(0);
    expect(result.data).toMatchObject({ release: null });
    expect(result.text).toContain("release none of the");
  });
});
