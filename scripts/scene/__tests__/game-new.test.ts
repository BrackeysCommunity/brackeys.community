// @vitest-environment node
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { PlayerInputSystem } from "@jams/engine/game";
import { runPlaytest } from "@jams/engine/headless";
import { sceneListFlow } from "@jams/engine/project";
import { inputScriptJsonSchema, parseSceneOrThrow, sceneJsonSchema } from "@jams/engine/scene";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { ToolContext } from "../context";
import { GAME_PRESETS, gameNames, generatedJson, type GamePreset } from "../game-templates";
import { projectIdTaken } from "../game-templates/project";
import { discoverProjects, type ProjectHandle } from "../projects";
import { loadCompatRapier } from "../rapier-compat";
import { check } from "../tools/check";
import { GAME_NEW_STAGE, gameNew, gameOptionsFrom, planGame } from "../tools/game-new";
import { playtest } from "../tools/playtest";
import { projectShow } from "../tools/project-show";
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

const ID: Record<GamePreset, string> = {
  "top-down": "rover",
  "side-view": "leaper",
  grid: "crates",
  turns: "steps",
};
/** The behaviors each behavior preset's hero carries in place of movement code. */
const HERO_BEHAVIORS: Partial<Record<GamePreset, string[]>> = {
  "top-down": ["camera-target", "character-top-down", "collider", "player-input"],
  "side-view": ["camera-target", "character-side-view", "collider", "player-input"],
};
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
      expect(ts.length).toBeGreaterThanOrEqual(GAME_PRESETS.length * 9);
      await expect(vp("lint", "--deny-warnings", ...ts)).resolves.toBeDefined();
    },
    SUBPROCESS_MS,
  );

  it(
    "lint reads files where game new stages them (a planted warning fails it)",
    async () => {
      const source = written.find((f) => f.endsWith("index.ts"))!;
      const canary = join(source, "..", "lint-canary.ts");
      await writeFile(canary, `${await readFile(source, "utf8")}\ndebugger;\n`);
      try {
        const err = await vp("lint", "--deny-warnings", canary).then(
          () => null,
          (e: { stdout?: string; stderr?: string }) => e,
        );
        expect(err, "lint passed a file with a planted debugger statement").not.toBeNull();
        expect(`${err?.stdout ?? ""}${err?.stderr ?? ""}`).toContain("lint-canary.ts");
      } finally {
        await rm(canary, { force: true });
      }
    },
    SUBPROCESS_MS,
  );

  it(
    "is formatted as vp fmt writes it (scenes and the scene list aside, whose layout the engine's formatters own)",
    async () => {
      const ignore = join(ROOT, "empty-ignore");
      await writeFile(ignore, "");
      const files = written.filter((f) => {
        const parts = f.split(/[\\/]/);
        return !parts.includes("scenes") && parts.at(-1) !== "scene-list.json";
      });
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

      it("ships a scene list starting at main, which the project judges clean", async () => {
        const text = await readFile(join(GAMES, id, "scene-list.json"), "utf8");
        expect(sceneListFlow(JSON.parse(text))).toEqual({
          start: "main",
          scenes: [{ scene: "main" }],
        });
        const out = await projectShow({ project: id }, { projects });
        expect(out.exitCode, out.text).toBe(0);
        const data = out.data as {
          counts: Record<string, number>;
          problems: unknown[];
          issues: { severity: string }[];
        };
        expect(data.counts["scene-list"]).toBe(1);
        expect(data.problems).toEqual([]);
        expect(data.issues.filter((i) => i.severity !== "info")).toEqual([]);
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
        expect(index).toContain(`physics: "${options.physics}",`);
        expect(index).toContain(`gravity: [${options.gravity.join(", ")}],`);
        expect(index).toContain(`lengthUnit: ${options.lengthUnit},`);
        expect(index).toContain(`time: { kind: "${options.time.kind}", rate: 60 },`);
        if (options.grid) expect(index).toContain(`grid: { kind: "square", cell: [1, 1] },`);
      });

      const behaviors = HERO_BEHAVIORS[preset];
      if (behaviors)
        it("builds its hero from standard behaviors, and its script walks it to a near", async () => {
          const read = (path: string) => readFile(join(GAMES, id, path), "utf8");
          const scene = JSON.parse(await read("scenes/main.json")) as {
            entities: { id: string; behaviors?: Record<string, unknown> }[];
          };
          const hero = scene.entities.find((e) => e.id === "hero");
          expect(Object.keys(hero?.behaviors ?? {}).sort()).toEqual(behaviors);
          const code = await Promise.all(["runtime.ts", "types.ts", "index.ts"].map(read));
          for (const text of code)
            expect(text).not.toMatch(/createMotionBody|Controller|HERO_SIZE/);
          // The win is the goal's script, not a check in the runtime.
          const goal = scene.entities.find((e) => e.id === "goal");
          expect(Object.keys(goal?.behaviors ?? {})).toEqual([`${id}/goal`]);
          expect(await read("goal.ts")).toMatch(/class Goal extends Script\(/);
          expect(code[0]).not.toMatch(/SENSOR_ENTER/);
          expect(code[2]).toContain("behaviors: [Goal],");
          const script = JSON.parse(await read("scenes/main.script.json")) as {
            steps: { until?: { near?: { id: string } } }[];
          };
          expect(script.steps.some((step) => step.until?.near?.id === "hero")).toBe(true);
          const checks = JSON.parse(await read("scenes/main.checks.json")) as {
            checks: { kind: string; expect?: { near?: unknown } }[];
          };
          expect(checks.checks.find((c) => c.kind === "reaches")?.expect?.near).toBeDefined();
        });

      if (behaviors)
        it("freezes its hero at the win: its seat is gone and held input no longer moves it", async () => {
          const project = projects.find((p) => p.file.id === id)!;
          const { game, registry } = project;
          const read = async (path: string) =>
            JSON.parse(await readFile(join(GAMES, id, path), "utf8")) as Record<string, unknown>;
          const scene = parseSceneOrThrow(await read("scenes/main.json"), registry);
          const script = (await read("scenes/main.script.json")) as { steps: unknown[] };
          const rapier = await loadCompatRapier();
          let seat: number | null | undefined;
          let saved: unknown;
          const won = runPlaytest({
            rapier,
            game,
            scene,
            script: script as never,
            onEnd: (runtime) => {
              seat = runtime.ctx.behavior<PlayerInputSystem>("player-input")?.seatOf("hero");
              const goal = runtime.ctx.entity("goal")?.getBehavior(`${id}/goal`);
              saved = (goal as { save?(): unknown } | undefined)?.save?.();
            },
          });
          if (won.blocked) throw new Error(JSON.stringify(won));
          expect(won.outcome.result).toBe("won");
          expect(seat).toBeNull();
          // The goal's script keeps in a world save that it fired.
          expect(saved).toBe(true);

          // Past the win, with no verdict to end the run, the hero rests however long move is held.
          const endless = { ...game!, play: { ...game!.play, outcome: undefined } };
          const restAfter = (ticks: number) => {
            const run = runPlaytest({
              rapier,
              game: endless as never,
              scene,
              script: {
                ...script,
                steps: [...script.steps, { set: { move: [-1, 0] }, for: ticks }],
              } as never,
            });
            if (run.blocked) throw new Error(JSON.stringify(run));
            const final = run.final as { at: { x: number; y: number }; reached: boolean };
            expect(final.reached).toBe(true);
            return final.at;
          };
          expect(restAfter(30)).toEqual(restAfter(60));
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
    ["side-view on the geometry backend", { preset: "side-view", physics: "none" }],
    ["side-view on an event clock", { preset: "side-view", time: "event" }],
  ])("plans %s with no error issues", async (_name, flags) => {
    const options = gameOptionsFrom("variant", flags);
    if (typeof options === "string") throw new Error(options);
    const plan = await planGame(options, join(dir(), "variant"));
    expect(plan.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("plays a side-view hero to its goal on the geometry backend too", async () => {
    const out = await gameNew(
      { id: "flat-leaper", preset: "side-view", physics: "none", dir: dir() },
      EMPTY,
    );
    expect(out.exitCode, out.text).toBe(0);
    const found = await discoverProjects(dir(), ["flat-leaper/jams.project.json"]);
    const ctx: ToolContext = {
      projects: found,
      project: "flat-leaper",
      loadRapier: loadCompatRapier,
    };
    const played = await check({ scene: "main" }, ctx);
    expect(played.exitCode, played.text).toBe(0);
    expect(played.text).toContain("expect holds (near)");
  });

  it("projectIdTaken points at the new project file's id", () => {
    const text = '{\n  "kind": "project",\n  "v": 1,\n  "id": "x"\n}\n';
    const issue = projectIdTaken("x", "/games/x", { projects: [], dirExists: true }, text);
    expect(issue).toMatchObject({ code: "project-id-taken", path: "/id", line: 4 });
  });
});
