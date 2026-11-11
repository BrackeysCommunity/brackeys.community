// @vitest-environment node
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { inputScriptJsonSchema, sceneJsonSchema } from "@jams/engine/scene";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { ToolContext } from "../context";
import { GAME_PRESETS, gameNames, generatedJson, type GamePreset } from "../game-templates";
import { projectIdTaken } from "../game-templates/project";
import { discoverProjects, type ProjectHandle } from "../projects";
import { loadCompatRapier } from "../rapier-compat";
import { check } from "../tools/check";
import { GAME_NEW_STAGE, gameNew, gameOptionsFrom, planGame } from "../tools/game-new";
import { playtest } from "../tools/playtest";
import { validate } from "../tools/validate";

const run = promisify(execFile);
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/game-new/", import.meta.url));
/** Inside the repo, so the generated games' imports resolve; under node_modules, so git never sees it. */
const ROOT = join(GAME_NEW_STAGE, `test-${process.pid}-${Date.now()}`);
const GAMES = join(ROOT, "src", "games");
/** The goldens are planned for `src/games/demo`, where `game new demo` would write. */
const GOLDEN_DIR = join(REPO, "src", "games", "demo");
const SUBPROCESS_MS = 300_000;
const SCHEMA_FILES = ["scene.schema.json", "input-script.schema.json"];

const ID: Record<GamePreset, string> = { "top-down": "rover", grid: "crates", turns: "steps" };
const EMPTY = { projects: [], loadRapier: loadCompatRapier } satisfies ToolContext;

let projects: ProjectHandle[] = [];
let written: string[] = [];

const exists = (path: string) => existsSync(path);
const vp = (...args: string[]) => run("vp", args, { cwd: REPO, maxBuffer: 64 * 1024 * 1024 });

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split("\\").join("/"))
    .sort();
}

/** The longest id ID_PATTERN allows, starting with a digit: its names still fit the print width. */
const LONGEST = `9-${"long-".repeat(8)}name`;

beforeAll(async () => {
  await mkdir(GAMES, { recursive: true });
  const made = [
    ...GAME_PRESETS.map((preset) => ({ id: ID[preset], preset })),
    { id: LONGEST, preset: "turns" },
  ];
  for (const input of made) {
    const out = await gameNew({ ...input, dir: GAMES }, EMPTY);
    expect(out.exitCode, out.text).toBe(0);
    written.push(...(out.data as { files: string[] }).files);
  }
  // The repo's tsconfig doesn't reach under node_modules; this one does, for tsc and type-aware lint alike.
  const extend = relative(ROOT, join(REPO, "tsconfig.json")).split("\\").join("/");
  await writeFile(
    join(ROOT, "tsconfig.json"),
    `${JSON.stringify({
      extends: extend,
      compilerOptions: { types: ["vite/client", "node"] },
      include: ["src/**/*.ts"],
    })}\n`,
  );
  projects = await discoverProjects(ROOT);
}, 120_000);

afterAll(async () => {
  if (!process.env.KEEP_GAME_NEW) await rm(ROOT, { recursive: true, force: true });
});

describe("game new writes a project that passes the repo's checks", () => {
  it(
    "type-checks with tsc",
    async () => {
      const tsconfig = join(ROOT, "tsconfig.json");
      await expect(vp("exec", "tsc", "--noEmit", "-p", tsconfig)).resolves.toBeDefined();
    },
    SUBPROCESS_MS,
  );

  it(
    "lints clean",
    async () => {
      const ts = written.filter((f) => f.endsWith(".ts"));
      const { stdout } = await vp("lint", "--deny-warnings", ...ts);
      expect(stdout).toMatch(/0 warnings and 0 errors/);
    },
    SUBPROCESS_MS,
  );

  it(
    "is formatted as vp fmt writes it (scenes aside, which the repo's fmt leaves to formatScene)",
    async () => {
      const ignore = join(ROOT, "empty-ignore");
      await writeFile(ignore, "");
      const files = written.filter((f) => !f.split(/[\\/]/).includes("scenes"));
      await expect(
        vp("fmt", "--check", "--with-node-modules", `--ignore-path=${ignore}`, ...files),
      ).resolves.toBeDefined();
    },
    SUBPROCESS_MS,
  );

  for (const preset of GAME_PRESETS) {
    describe(preset, () => {
      const id = ID[preset];
      const ctx = (): ToolContext => ({ projects, project: id, loadRapier: loadCompatRapier });

      it("is discovered with its game and UI modules", () => {
        const project = projects.find((p) => p.file.id === id);
        expect(project?.game?.id).toBe(id);
        expect(project?.file.ui).toEqual({
          module: "./ui/index.ts",
          export: gameNames(id).hudExport,
        });
      });

      it("validates main with no errors or warnings", async () => {
        const out = await validate({ target: "main" }, ctx());
        expect(out.exitCode, out.text).toBe(0);
        const issues = (out.data as { issues: { severity: string }[] }).issues;
        expect(issues.filter((i) => i.severity !== "info")).toEqual([]);
      });

      it("plays scenes/main.script.json to won", async () => {
        const script = join(GAMES, id, "scenes", "main.script.json");
        const out = await playtest({ scene: "main", script }, ctx());
        expect(out.exitCode, out.text).toBe(0);
        expect((out.data as { outcome: { result: string } }).outcome.result).toBe("won");
      });

      it("passes every check in main.checks.json", async () => {
        const out = await check({ scene: "main" }, ctx());
        expect(out.exitCode, out.text).toBe(0);
      });

      it("writes the schemas its registry generates", async () => {
        const registry = projects.find((p) => p.file.id === id)!.registry;
        const read = (path: string) => readFile(join(GAMES, id, path), "utf8");
        expect(await read("scene.schema.json")).toBe(generatedJson(sceneJsonSchema(registry)));
        expect(await read("input-script.schema.json")).toBe(
          generatedJson(inputScriptJsonSchema(registry)),
        );
      });

      it("writes its preset's world and time in full", async () => {
        const index = await readFile(join(GAMES, id, "index.ts"), "utf8");
        const options = gameOptionsFrom(id, { preset });
        if (typeof options === "string") throw new Error(options);
        expect(index).toContain(`physics: "none",`);
        expect(index).toContain(`gravity: [0, 0],`);
        expect(index).toContain(`lengthUnit: ${options.lengthUnit},`);
        expect(index).toContain(`time: { kind: "${options.time.kind}", rate: 60 },`);
        if (preset !== "top-down")
          expect(index).toContain(`grid: { kind: "square", cell: [1, 1] },`);
      });
    });
  }
});

describe("the golden fixtures", () => {
  for (const preset of GAME_PRESETS) {
    it(`${preset}: game new demo writes them (UPDATE_FIXTURES=1 regenerates)`, async () => {
      const options = gameOptionsFrom("demo", { preset });
      if (typeof options === "string") throw new Error(options);
      const plan = await planGame(options, GOLDEN_DIR);
      expect(plan.issues.filter((i) => i.severity !== "info")).toEqual([]);
      const dir = join(FIXTURES, preset);
      // The schemas follow the engine; each preset's are held to their generators above.
      const golden = plan.files.filter((f) => !SCHEMA_FILES.includes(f.path));
      if (process.env.UPDATE_FIXTURES) {
        await rm(dir, { recursive: true, force: true });
        for (const f of golden) {
          const path = join(dir, `${f.path}.golden`);
          await mkdir(join(path, ".."), { recursive: true });
          await writeFile(path, f.text);
        }
      }
      expect(await filesUnder(dir)).toEqual(golden.map((f) => `${f.path}.golden`));
      for (const f of golden)
        expect(f.text, f.path).toBe(await readFile(join(dir, `${f.path}.golden`), "utf8"));
    }, 60_000);
  }
});

describe("game new's refusals and flags", () => {
  const dir = () => join(ROOT, "refusals");

  it("refuses an id a discovered project holds, writing nothing (project-id-taken)", async () => {
    const holder = { dir: "/elsewhere/taken", file: { id: "taken" } } as ProjectHandle;
    const out = await gameNew({ id: "taken", dir: dir() }, { ...EMPTY, projects: [holder] });
    expect(out.exitCode).toBe(1);
    const data = out.data as { written: boolean; issues: { code: string; path: string }[] };
    expect(data.written).toBe(false);
    expect(data.issues.map((i) => [i.code, i.path])).toEqual([["project-id-taken", "/id"]]);
    expect(exists(join(dir(), "taken"))).toBe(false);
  });

  it("refuses a directory that exists, writing nothing in it (project-id-taken)", async () => {
    const there = join(dir(), "there");
    await mkdir(there, { recursive: true });
    const out = await gameNew({ id: "there", dir: dir() }, EMPTY);
    expect(out.exitCode).toBe(1);
    expect((out.data as { issues: { code: string }[] }).issues[0]?.code).toBe("project-id-taken");
    expect(await readdir(there)).toEqual([]);
  });

  it("refuses an id outside ID_PATTERN (schema)", async () => {
    const out = await gameNew({ id: "Bad_Id", dir: dir() }, EMPTY);
    expect(out.exitCode).toBe(1);
    expect((out.data as { issues: { code: string }[] }).issues[0]?.code).toBe("schema");
    expect(exists(join(dir(), "Bad_Id"))).toBe(false);
  });

  it("--dry-run lists every file and writes none", async () => {
    const out = await gameNew({ id: "dry", preset: "turns", dir: dir(), dryRun: true }, EMPTY);
    expect(out.exitCode, out.text).toBe(0);
    const data = out.data as { files: string[]; written: boolean; urls: Record<string, string> };
    expect(data.written).toBe(false);
    expect(data.files.map((f) => relative(join(dir(), "dry"), f).split("\\").join("/"))).toEqual(
      written
        .filter((f) => f.includes(`${ID.turns}/`) || f.includes(`${ID.turns}\\`))
        .map((f) => relative(join(GAMES, ID.turns), f).split("\\").join("/")),
    );
    expect(exists(join(dir(), "dry"))).toBe(false);
    expect(data.urls).toEqual({ play: "/game/dev?game=dry", edit: "/game/dev?edit=1&project=dry" });
    expect(out.text).toContain("vp run scene playtest main --project dry --script ");
  });

  it("takes flags over the preset, and refuses ones the preset can't use", () => {
    const options = gameOptionsFrom("g", {
      preset: "grid",
      physics: "rapier",
      gravity: "0,9.8",
      time: "fixed",
      rate: "30",
      cell: "0.5",
      pxPerMetre: "64",
      name: "Grid Game",
    });
    expect(options).toEqual({
      id: "g",
      name: "Grid Game",
      preset: "grid",
      physics: "rapier",
      gravity: [0, 9.8],
      time: { kind: "fixed", rate: 30 },
      grid: { kind: "square", cell: 0.5 },
      lengthUnit: 64,
    });
    expect(gameOptionsFrom("g", { preset: "grid", time: "turns" })).toMatch(/--preset turns/);
    expect(gameOptionsFrom("g", { preset: "turns", grid: "hex" })).toMatch(/square grid/);
    expect(gameOptionsFrom("g", { cell: "1" })).toMatch(/needs a grid/);
    expect(gameOptionsFrom("g", { rate: "0" })).toMatch(/--rate/);
    expect(gameOptionsFrom("g", { preset: "side" })).toMatch(/--preset takes/);
  });

  it.each([
    ["top-down on a hex grid", { grid: "hex", cell: "0.5" }],
    ["top-down on Rapier with gravity", { physics: "rapier", gravity: "0,9.8" }],
    ["grid at 0.5 m cells and 48 px per metre", { preset: "grid", cell: "0.5", pxPerMetre: "48" }],
    ["turns on an event clock", { preset: "turns", time: "event" }],
  ])("plans %s with no error issues", async (_name, flags) => {
    const options = gameOptionsFrom("variant", flags);
    if (typeof options === "string") throw new Error(options);
    const plan = await planGame(options, join(dir(), "variant"));
    expect(plan.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("projectIdTaken points at the new project file's id", () => {
    const text = '{\n  "kind": "project",\n  "v": 1,\n  "id": "x"\n}\n';
    const issue = projectIdTaken("x", "/games/x", { projects: [], dirExists: true }, text);
    expect(issue).toMatchObject({ code: "project-id-taken", path: "/id", line: 4 });
  });
});
