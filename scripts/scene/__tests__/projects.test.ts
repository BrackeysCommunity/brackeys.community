// @vitest-environment node
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createRegistry, ENGINE_REGISTRY_ID } from "@jams/engine/game";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { platformerGame } from "../../../src/games/platformer";
import { runCli } from "../commands";
import type { ToolContext } from "../context";
import {
  ambiguousIds,
  discoverProjects,
  locateInProjects,
  openProject,
  ProjectDiscoveryError,
  projectById,
  projectRuntime,
  type ProjectHandle,
} from "../projects";
import { loadCompatRapier } from "../rapier-compat";
import { CARD_SPEED, CARD_TABLE, cardGame } from "./card-game";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe("discoverProjects over the repo", () => {
  it("finds the two homes: the engine's scenes and the platformer", async () => {
    const projects = await discoverProjects(ROOT);
    expect(projects.map((p) => p.file.id)).toEqual(["engine", "platformer"]);

    const [engine, platformer] = projects as [ProjectHandle, ProjectHandle];
    expect(engine.dir).toBe(join(ROOT, "src/engine/scenes"));
    expect(engine.file.game).toBeNull();
    expect(engine.game).toBeNull();
    expect(engine.registry.id).toBe(ENGINE_REGISTRY_ID);
    expect(engine.registry.game).toBeNull();

    expect(platformer.dir).toBe(join(ROOT, "src/games/platformer"));
    expect(platformer.file.game).toEqual({ module: "./index.ts", export: "platformerGame" });
    expect(platformer.game).toBe(platformerGame);
    expect(platformer.registry.id).toBe("platformer");
    expect(platformer.registry.game).toBe(platformerGame);
    for (const def of platformerGame.assetKinds ?? [])
      expect(platformer.kinds.get(def.kind)).toBe(def);
  });

  it("gives each project a cache under the root's dev cache", async () => {
    const projects = await discoverProjects(ROOT);
    expect(projects.map((p) => p.cacheDir)).toEqual([
      join(ROOT, "node_modules/.cache/jams-engine/engine"),
      join(ROOT, "node_modules/.cache/jams-engine/platformer"),
    ]);
  });

  it("finds nothing for globs that match no project file", async () => {
    expect(await discoverProjects(ROOT, ["scripts/**/jams.project.json"])).toEqual([]);
  });
});

describe("projectRuntime", () => {
  it("reads the engine project's settings and card table under the game a run plays", async () => {
    const engine = projectById(await discoverProjects(ROOT), "engine")!;
    const played = await projectRuntime(engine, createRegistry(cardGame));
    expect(played.settings).toEqual({ avatarSpeed: CARD_SPEED });
    expect(played.table(CARD_TABLE)).toEqual([
      { id: "fireball", cost: 3, damage: 5 },
      { id: "heal", cost: 2, damage: 0 },
    ]);
    expect(Object.isFrozen(played.table(CARD_TABLE)[0])).toBe(true);

    const bare = await projectRuntime(engine, engine.registry);
    expect(bare.settings).toEqual({});
    expect(bare.table(CARD_TABLE)).toEqual([]);
  });
});

describe("discoverProjects over a temp tree", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "jams-projects-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const put = async (path: string, text: string) => {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  };

  const projectFile = (id: string, game: { module: string; export: string } | null = null) =>
    `${JSON.stringify({ kind: "project", v: 1, id, name: id, game, assets: ["scenes/**"] })}\n`;

  const gameModule = (id: string, name: string) => `
export const ${name} = {
  id: ${JSON.stringify(id)},
  types: [],
  actions: [],
  assetKinds: [
    {
      kind: ${JSON.stringify(`${id}/notes`)},
      storage: "code",
      title: "Notes",
      description: "Plain notes.",
      match: { suffixes: [".notes"] },
    },
  ],
  createRuntime() {
    return {};
  },
};
`;

  const twoProjects = async () => {
    await put("src/games/alpha/jams.project.json", projectFile("alpha", game("alphaGame")));
    await put("src/games/alpha/game.mjs", gameModule("alpha", "alphaGame"));
    await put("src/games/alpha/scenes/shared.json", "{}");
    await put("src/games/alpha/scenes/only-alpha.json", "{}");
    await put("src/tools/beta/jams.project.json", projectFile("beta"));
    await put("src/tools/beta/scenes/shared.json", "{}");
  };
  const game = (name: string) => ({ module: "./game.mjs", export: name });

  it("finds two projects, imports the game and builds both registries", async () => {
    await twoProjects();
    const projects = await discoverProjects(root);
    expect(projects.map((p) => [p.file.id, p.dir])).toEqual([
      ["alpha", join(root, "src/games/alpha")],
      ["beta", join(root, "src/tools/beta")],
    ]);
    const [alpha, beta] = projects as [ProjectHandle, ProjectHandle];
    expect(alpha.game?.id).toBe("alpha");
    expect(alpha.registry.id).toBe("alpha");
    expect(alpha.kinds.get("alpha/notes")?.storage).toBe("code");
    expect(alpha.kinds.detect("scenes/readme.notes")?.kind).toBe("alpha/notes");
    expect(beta.game).toBeNull();
    expect(beta.registry.id).toBe(ENGINE_REGISTRY_ID);
    expect(beta.kinds.get("alpha/notes")).toBeUndefined();
  });

  it("takes globs, and never searches node_modules, dist, __tests__ or dot directories", async () => {
    await twoProjects();
    await put("src/x/node_modules/pkg/jams.project.json", projectFile("nm"));
    await put("src/x/dist/jams.project.json", projectFile("built"));
    await put("src/x/__tests__/fixture/jams.project.json", projectFile("fixture"));
    await put("src/.hidden/jams.project.json", projectFile("hidden"));
    await put("elsewhere/gamma/jams.project.json", projectFile("gamma"));

    expect((await discoverProjects(root)).map((p) => p.file.id)).toEqual(["alpha", "beta"]);
    expect((await discoverProjects(root, ["elsewhere/**/jams.project.json"])).length).toBe(1);
    expect(
      (await discoverProjects(root, ["src/games/*/jams.project.json", "**/jams.project.json"])).map(
        (p) => p.file.id,
      ),
    ).toEqual(["alpha", "beta", "gamma"]);
  });

  it("loads game modules through importModule when given one", async () => {
    await put("src/games/alpha/jams.project.json", projectFile("alpha", game("alphaGame")));
    const seen: string[] = [];
    const [alpha] = await discoverProjects(root, undefined, {
      importModule: async (path) => {
        seen.push(path);
        return { alphaGame: { id: "alpha", types: [], actions: [], createRuntime: () => ({}) } };
      },
    });
    expect(seen).toEqual([join(root, "src/games/alpha/game.mjs")]);
    expect(alpha?.registry.id).toBe("alpha");
  });

  it("refuses every bad project at once, naming each file", async () => {
    await put("src/a/jams.project.json", '{ "kind": "project", "v": 1, "id": "Bad Id" }');
    await put("src/b/jams.project.json", projectFile("bee", game("missing")));
    await put("src/b/game.mjs", gameModule("bee", "beeGame"));
    await put("src/c/jams.project.json", projectFile("sea", game("seaGame")));
    await put("src/d/jams.project.json", projectFile("dee", game("notAGame")));
    await put("src/d/game.mjs", "export const notAGame = 42;\n");
    await put("src/e/jams.project.json", projectFile("eee", game("eeeGame")));
    await put(
      "src/e/game.mjs",
      gameModule("eee", "eeeGame").replace('"eee/notes"', '"other/notes"'),
    );

    const error = await discoverProjects(root).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProjectDiscoveryError);
    const problems = (error as ProjectDiscoveryError).problems;
    expect(problems.map((p) => p.file)).toEqual([
      join("src/a/jams.project.json"),
      join("src/b/jams.project.json"),
      join("src/c/jams.project.json"),
      join("src/d/jams.project.json"),
      join("src/e/jams.project.json"),
    ]);
    expect(problems[0]?.issues?.some((i) => i.code === "bad-id")).toBe(true);
    expect(problems[1]?.message).toMatch(/no export "missing"/);
    expect(problems[2]?.message).toMatch(/doesn't load/);
    expect(problems[3]?.message).toMatch(/isn't a game definition/);
    expect(problems[4]?.message).toMatch(/must be named "eee\/<name>"/);
    expect((error as Error).message).toContain("src/c/jams.project.json");
  });

  it("overlays each project's material assets onto its registry, read from the adapter's scan", async () => {
    await put("src/tools/beta/jams.project.json", projectFile("beta"));
    await put(
      "src/tools/beta/scenes/rubber.json",
      JSON.stringify({
        kind: "material",
        v: 1,
        description: "Bouncy.",
        physics: { friction: 0.2, restitution: 0.9 },
      }),
    );
    await put("src/tools/beta/scenes/broken.json", '{ "kind": "material", "v": 1 }');
    const [beta] = await discoverProjects(root, undefined, {
      cacheDirOf: (id) => join(root, ".cache", id),
    });
    expect(beta?.registry.materialNames).toContain("rubber");
    expect(beta?.registry.materialNames).not.toContain("broken");
    expect(beta?.cacheDir).toBe(join(root, ".cache", "beta"));

    const opened = await openProject(join(root, "src/tools/beta"), {
      cacheDir: join(root, ".cache", "opened"),
    });
    expect(opened.registry.materialNames).toContain("rubber");
    expect(opened.game).toBeNull();
  });

  it("the CLI refuses a scene two projects hold (exit 2) until --project picks one", async () => {
    const scene = JSON.stringify({ v: 2, name: "shared", bounds: [0, 0, 100, 100] });
    await put("src/games/alpha/jams.project.json", projectFile("alpha"));
    await put("src/games/alpha/scenes/shared.json", scene);
    await put("src/tools/beta/jams.project.json", projectFile("beta"));
    await put("src/tools/beta/scenes/shared.json", scene);
    const ctx: ToolContext = {
      projects: await discoverProjects(root, undefined, {
        cacheDirOf: (id) => join(root, ".cache", id),
      }),
      loadRapier: loadCompatRapier,
    };
    const clash = await runCli(["validate", "shared"], ctx);
    expect(clash.exitCode).toBe(2);
    expect(clash.stderr).toMatch(/more than one project: alpha, beta; pass --project/);
    expect((await runCli(["validate", "shared", "--project", "beta"], ctx)).exitCode).toBe(0);
    expect((await runCli(["fmt", "shared", "--check"], ctx)).exitCode).toBe(2);
    expect((await runCli(["list", "--project", "gamma"], ctx)).exitCode).toBe(2);
    const listed = JSON.parse((await runCli(["list", "--json"], ctx)).stdout) as {
      clashes: Record<string, string[]>;
    };
    expect(listed.clashes).toEqual({ shared: ["alpha", "beta"] });
  });

  it("refuses a project id two project files claim", async () => {
    await put("src/one/jams.project.json", projectFile("same"));
    await put("src/two/jams.project.json", projectFile("same"));
    const error = (await discoverProjects(root).catch((e: unknown) => e)) as ProjectDiscoveryError;
    expect(error).toBeInstanceOf(ProjectDiscoveryError);
    expect(error.problems.map((p) => p.file)).toEqual([
      join("src/one/jams.project.json"),
      join("src/two/jams.project.json"),
    ]);
    expect(error.problems[0]?.message).toMatch(/project id "same" is also claimed/);
  });

  describe("ambiguity", () => {
    const holdsScene = (name: string) => (p: ProjectHandle) =>
      exists(join(p.dir, "scenes", `${name}.json`));

    it("an id one project holds resolves to it", async () => {
      await twoProjects();
      const projects = await discoverProjects(root);
      const found = await locateInProjects(projects, "only-alpha", holdsScene("only-alpha"));
      expect(found.ok && found.project.file.id).toBe("alpha");
    });

    it("an id two projects hold is ambiguous (exit 2) unless --project names one", async () => {
      await twoProjects();
      const projects = await discoverProjects(root);
      const clash = await locateInProjects(projects, "shared", holdsScene("shared"));
      expect(clash).toMatchObject({ ok: false, reason: "ambiguous", exitCode: 2 });
      expect(!clash.ok && clash.reason === "ambiguous" && clash.projects).toEqual([
        "alpha",
        "beta",
      ]);
      expect(!clash.ok && clash.message).toMatch(/--project/);

      const picked = await locateInProjects(projects, "shared", holdsScene("shared"), "beta");
      expect(picked.ok && picked.project.file.id).toBe("beta");
    });

    it("--project naming no project is a usage error; an id nobody holds is a failure", async () => {
      await twoProjects();
      const projects = await discoverProjects(root);
      expect(
        await locateInProjects(projects, "shared", holdsScene("shared"), "gamma"),
      ).toMatchObject({
        ok: false,
        reason: "unknown-project",
        exitCode: 2,
        known: ["alpha", "beta"],
      });
      expect(await locateInProjects(projects, "nope", holdsScene("nope"))).toMatchObject({
        ok: false,
        reason: "not-found",
        exitCode: 1,
      });
      expect(
        await locateInProjects(projects, "only-alpha", holdsScene("only-alpha"), "beta"),
      ).toMatchObject({ ok: false, reason: "not-found" });
    });

    it("ambiguousIds lists every id held by more than one project", async () => {
      await twoProjects();
      const projects = await discoverProjects(root);
      const ids: Record<string, string[]> = {
        alpha: ["shared", "only-alpha", "shared"],
        beta: ["shared"],
      };
      expect(ambiguousIds(projects, (p) => ids[p.file.id] ?? [])).toEqual(
        new Map([["shared", ["alpha", "beta"]]]),
      );
      expect(projectById(projects, "beta")?.dir).toBe(join(root, "src/tools/beta"));
      expect(projectById(projects, "gamma")).toBeUndefined();
    });
  });
});
