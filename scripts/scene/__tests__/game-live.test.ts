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
  parseSceneVersion,
  RELEASE_FILE,
  sceneVersionId,
  sceneVersionOptions,
  sha256,
} from "@jams/engine/project";
import type { SceneDefinition } from "@jams/engine/scene";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { tacticsGame } from "../../../src/games/tactics";
import { runCli } from "../commands";
import type { ToolContext, ToolResult } from "../context";
import { openProject } from "../projects";
import { exportInputOf } from "../tools/game-build";
import { gameLiveBuild, gameLiveCheck } from "../tools/game-live";

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
