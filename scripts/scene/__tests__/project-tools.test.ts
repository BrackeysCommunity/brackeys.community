// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseProjectSnapshot,
  sha256,
  type ProjectSnapshot,
  type ProjectTreeNode,
} from "@jams/engine/project";
import type { SceneIssue } from "@jams/engine/scene";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { platformerGame } from "../../../src/games/platformer";
import { toMcpResult } from "../mcp-tools";
import { discoverProjects, type ProjectHandle } from "../projects";
import { projectRefs } from "../tools/project-refs";
import { codeModules, loadProject, projectShow } from "../tools/project-show";
import { projectSnapshot } from "../tools/project-snapshot";
import { projectTree } from "../tools/project-tree";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

type Data = Record<string, unknown>;
const data = (r: { data: unknown }) => r.data as Data;

/** Every node of a tree, depth first. */
function flatten(nodes: readonly ProjectTreeNode[]): ProjectTreeNode[] {
  return nodes.flatMap((n) => (n.type === "folder" ? [n, ...flatten(n.children)] : [n]));
}
const pathOf = (n: ProjectTreeNode) => (n.type === "asset" ? n.entry.path : n.path);

describe("project tools over the two homes", { timeout: 60_000 }, () => {
  let ctx: { projects: ProjectHandle[] };
  beforeAll(async () => {
    ctx = { projects: await discoverProjects(ROOT) };
  });

  it("show summarises each home: assets by kind, code, problems and usage", async () => {
    const engine = await projectShow({ project: "engine" }, ctx);
    expect(engine.exitCode).toBe(0);
    const files = [
      "kitchen-sink.json",
      "kitchen-sink.checks.json",
      "engine-yard.json",
      "engine-yard.checks.json",
      "grid-yard.json",
      "grid-yard.checks.json",
      "prefabs/doorway.json",
      "prefabs/gate.json",
      "prefabs/latch.json",
      "prefabs/one-way-latch.json",
      "prefabs/post.json",
      "prefabs/room.json",
      "data/cards.json",
      "materials/bouncy.json",
      "game-settings.json",
      "input-map.json",
    ];
    const art = [
      "art/backdrop.png",
      "art/crates.json",
      "art/crates.png",
      "art/hero.json",
      "art/hero.png",
    ];
    const size = async (list: string[]) => {
      let bytes = 0;
      for (const f of list) bytes += (await readFile(join(ROOT, "src/engine/scenes", f))).length;
      return bytes;
    };
    expect(data(engine)).toMatchObject({
      ok: true,
      project: "engine",
      name: "Engine",
      game: null,
      dir: join(ROOT, "src/engine/scenes"),
      assets: 21,
      counts: {
        atlas: 2,
        checks: 3,
        "data-table": 1,
        "game-settings": 1,
        "input-map": 1,
        material: 1,
        prefab: 6,
        scene: 3,
        texture: 3,
      },
      deleted: 0,
      code: 0,
      problems: [],
      issues: [],
      usage: {
        docs: 16,
        docBytes: await size(files),
        blobs: 5,
        blobBytes: await size(art),
        trashBytes: 0,
      },
    });
    expect(engine.text).toContain("problems: none");

    const platformer = await projectShow({ project: "platformer" }, ctx);
    expect(platformer.exitCode).toBe(0);
    expect(data(platformer)).toMatchObject({
      project: "platformer",
      game: "platformer",
      counts: { scene: 1 },
      problems: [],
      issues: [],
    });
    expect(data(platformer).code).toBeGreaterThan(0);
    expect(platformer.text.split("\n")[0]).toMatch(/^platformer {2}Platformer {2}game platformer/);
  });

  it("tree lists folders, assets and the platformer's code modules", async () => {
    const engine = await projectTree({ project: "engine" }, ctx);
    expect(engine.exitCode).toBe(0);
    const tree = data(engine).tree as ProjectTreeNode[];
    expect(tree[0]).toMatchObject({ type: "folder", path: "art" });
    expect(flatten(tree).map(pathOf)).toEqual([
      "art",
      "art/backdrop.png",
      "art/crates.json",
      "art/crates.png",
      "art/hero.json",
      "art/hero.png",
      "data",
      "data/cards.json",
      "materials",
      "materials/bouncy.json",
      "prefabs",
      "prefabs/doorway.json",
      "prefabs/gate.json",
      "prefabs/latch.json",
      "prefabs/one-way-latch.json",
      "prefabs/post.json",
      "prefabs/room.json",
      "engine-yard.checks.json",
      "engine-yard.json",
      "game-settings.json",
      "grid-yard.checks.json",
      "grid-yard.json",
      "input-map.json",
      "kitchen-sink.checks.json",
      "kitchen-sink.json",
    ]);
    expect(engine.text).toContain("  prefabs/\n    doorway.json  prefab doorway");

    const platformer = await projectTree({ project: "platformer" }, ctx);
    const nodes = flatten(data(platformer).tree as ProjectTreeNode[]);
    const scene = nodes.find((n) => n.type === "asset");
    expect(scene).toMatchObject({ entry: { id: "test-yard", path: "scenes/test-yard.json" } });
    const code = nodes.filter((n) => n.type === "code");
    expect(code.length).toBeGreaterThan(0);
    expect(code.every((n) => n.path.endsWith(".ts") && !n.path.includes("__tests__"))).toBe(true);
    const index = code.find((n) => n.path === "index.ts");
    expect(index?.type === "code" && index.info.registers.types).toEqual(
      platformerGame.types.map((t) => t.type).sort(),
    );
    expect(platformer.text).toMatch(/\n {2}index\.ts {2}code {2}\(types: /);
  });

  it("refs reports what an asset names and who names it", async () => {
    const sink = await projectRefs({ id: "kitchen-sink" }, ctx);
    expect(sink.exitCode).toBe(0);
    expect(data(sink)).toMatchObject({
      project: "engine",
      asset: { id: "kitchen-sink", kind: "scene", path: "kitchen-sink.json", deleted: false },
      referrers: [
        { id: "kitchen-sink-checks", kind: "checks", pointer: "/checks/@fades/script/scene" },
        { id: "kitchen-sink-checks", kind: "checks", pointer: "/checks/@settles/script/scene" },
      ],
      dangling: [],
    });
    const targets = data(sink).targets as { id: string; target: { path: string } | null }[];
    const art = ["backdrop", "crates", "hero"];
    expect(new Set(targets.map((t) => t.id))).toEqual(
      new Set(["post", "gate", "room", "doorway", "one-way-latch", "bouncy", "cards", ...art]),
    );
    expect(targets.find((t) => t.id === "bouncy")?.target?.path).toBe("materials/bouncy.json");
    expect(targets.find((t) => t.id === "cards")?.target?.path).toBe("data/cards.json");
    for (const id of art)
      expect(targets.find((t) => t.id === id)?.target?.path, id).toMatch(/^art\//);
    expect(
      targets
        .filter((t) => !["bouncy", "cards", ...art].includes(t.id))
        .every((t) => t.target?.path.startsWith("prefabs/")),
    ).toBe(true);

    const post = await projectRefs({ id: "post" }, ctx);
    expect((data(post).referrers as { id: string }[]).map((r) => r.id)).toEqual([
      "kitchen-sink",
      "kitchen-sink",
    ]);
    expect(post.text).toContain("named by:\n  kitchen-sink (scene) at /instances/@post-");

    for (const project of ["engine", "platformer"]) {
      const dangling = await projectRefs({ project }, ctx);
      expect(dangling.exitCode).toBe(0);
      expect(data(dangling).dangling).toEqual([]);
    }
  });

  it("refs fails on an unknown id with a guess, and refuses an unknown --project", async () => {
    const miss = await projectRefs({ id: "kitchen-snk" }, ctx);
    expect(miss.exitCode).toBe(1);
    expect(data(miss).error).toMatch(/Did you mean "kitchen-sink"\?/);
    const bad = await projectRefs({ id: "post", project: "nope" }, ctx);
    expect(bad.exitCode).toBe(2);
    const elsewhere = await projectRefs({ id: "post", project: "platformer" }, ctx);
    expect(elsewhere.exitCode).toBe(1);
  });

  it("snapshot pins each doc by the hash of its canonical text, reproducibly", async () => {
    const first = await projectSnapshot({ project: "engine" }, ctx);
    const second = await projectSnapshot({ project: "engine" }, ctx);
    expect(first.exitCode).toBe(0);
    expect(first.text).toMatch(/^[0-9a-f]{64}$/);
    expect(second.text).toBe(first.text);
    const snap = data(first).snapshot as ProjectSnapshot;
    expect(snap.hash).toBe(first.text);
    const blobs = ["backdrop", "crates", "crates-texture", "hero", "hero-texture"];
    expect(Object.keys(snap.assets).sort()).toEqual(
      [
        "bouncy",
        "cards",
        "doorway",
        "engine-yard",
        "engine-yard-checks",
        "game-settings",
        "gate",
        "grid-yard",
        "grid-yard-checks",
        "input-map",
        "kitchen-sink",
        "kitchen-sink-checks",
        "latch",
        "one-way-latch",
        "post",
        "room",
        ...blobs,
      ].sort(),
    );
    const loaded = await loadProject(ctx.projects.find((p) => p.file.id === "engine")!);
    for (const [id, asset] of Object.entries(snap.assets)) {
      if (blobs.includes(id))
        expect(asset.sha256, id).toBe(
          await sha256(await readFile(join(ROOT, "src/engine/scenes", asset.path))),
        );
      else expect(asset.sha256, id).toBe(await sha256(loaded.texts.get(id)!));
    }
    for (const id of ["kitchen-sink", "engine-yard", "grid-yard"])
      expect(snap.assets[id]!.sha256).toBe(
        await sha256(await readFile(join(ROOT, "src/engine/scenes", `${id}.json`), "utf8")),
      );

    const printed = await projectSnapshot({ project: "platformer", out: "-" }, ctx);
    const parsed = await parseProjectSnapshot(printed.text);
    expect(parsed.ok && parsed.snapshot.project).toBe("platformer");
    expect(parsed.ok && Object.keys(parsed.snapshot.assets)).toEqual(["test-yard"]);
  });

  it("refuses a missing or unknown project with exit 2, naming the projects", async () => {
    for (const run of [
      () => projectShow({}, ctx),
      () => projectTree({}, ctx),
      () => projectRefs({}, ctx),
      () => projectSnapshot({}, ctx),
    ]) {
      const result = await run();
      expect(result.exitCode).toBe(2);
      expect(result.text).toContain("(projects: engine, platformer)");
    }
    const typo = await projectShow({ project: "platformr" }, ctx);
    expect(typo.exitCode).toBe(2);
    expect(typo.text).toContain('did you mean "platformer"?');
  });

  it("gives results the MCP server can return as they are", async () => {
    const ok = toMcpResult(await projectShow({ project: "engine" }, ctx));
    expect(ok.isError).toBe(false);
    expect(ok.structuredContent).toMatchObject({ project: "engine", exitCode: 0 });
    const refused = toMcpResult(await projectTree({ project: "nope" }, ctx));
    expect(refused.isError).toBe(true);
  });
});

describe("project tools over a temp project", { timeout: 60_000 }, () => {
  let root: string;
  let ctx: { projects: ProjectHandle[] };

  const put = async (path: string, text: string) => {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  };
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

  const projectFile = (id: string, game: boolean) =>
    json({
      kind: "project",
      v: 1,
      id,
      name: `Project ${id}`,
      game: game ? { module: "./game.mjs", export: "deckGame" } : null,
      assets: ["assets/**"],
      code: ["**/*.mjs", "**/*.ts", "!**/__tests__/**"],
    });

  const gameModule = `
export const deckGame = {
  id: "deck",
  types: [],
  actions: [],
  tables: { card: { description: "A card.", row: {} } },
  assetKinds: [
    {
      kind: "deck/notes",
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

  const arena = {
    v: 4,
    name: "arena",
    game: "deck",
    bounds: [0, 0, 200, 100],
    entities: [
      { id: "floor", type: "solid", shape: ["box", 100, 90, 100, 10], material: "rubber" },
    ],
  };
  const checks = {
    v: 1,
    checks: [
      { id: "valid", kind: "valid" },
      {
        id: "runs",
        kind: "reaches",
        script: { v: 1, scene: "arena", steps: [{ wait: 1 }] },
        result: "script-end",
      },
      {
        id: "stale",
        kind: "reaches",
        script: { v: 1, scene: "arenna", steps: [{ wait: 1 }] },
        result: "script-end",
      },
    ],
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "jams-project-tools-"));
    await put("src/deck/jams.project.json", projectFile("deck", true));
    await put("src/deck/game.mjs", gameModule);
    await put("src/deck/lib/helper.ts", "export const helper = 1;\n");
    await put("src/deck/lib/__tests__/helper.test.ts", "export {};\n");
    await put("src/deck/node_modules/pkg/index.ts", "export {};\n");
    await put(
      "src/deck/assets/materials/rubber.json",
      json({
        kind: "material",
        v: 1,
        description: "Bouncy rubber.",
        physics: { friction: 0.4, restitution: 0.9 },
      }),
    );
    await put("src/deck/assets/levels/arena.json", json(arena));
    await put("src/deck/assets/levels/arena.checks.json", json(checks));
    await put(
      "src/deck/assets/cards.json",
      json({ kind: "data-table", v: 1, table: "card", rows: [{ id: "fireball" }, { id: "heal" }] }),
    );
    await put("src/deck/assets/readme.txt", "not an asset\n");
    await put("src/other/jams.project.json", projectFile("other", false));
    await put("src/other/assets/arena.json", json({ ...arena, game: undefined, entities: [] }));
    ctx = { projects: await discoverProjects(root) };
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("show reads every doc kind, with project materials overlaid", async () => {
    const shown = await projectShow({ project: "deck" }, ctx);
    expect(shown.exitCode).toBe(0);
    expect(data(shown)).toMatchObject({
      project: "deck",
      name: "Project deck",
      game: "deck",
      assets: 4,
      counts: { checks: 1, "data-table": 1, material: 1, scene: 1 },
      code: 2,
      problems: [],
      issues: [],
      usage: { docs: 4, blobs: 0 },
    });
  });

  it("tree lists code modules under the code globs, the game module with what it registers", async () => {
    const deck = ctx.projects.find((p) => p.file.id === "deck")!;
    expect(await codeModules(deck)).toEqual({
      "game.mjs": { registers: { kinds: ["deck/notes"], tables: ["card"] } },
      "lib/helper.ts": { registers: {} },
    });
    const tree = await projectTree({ project: "deck" }, ctx);
    expect(flatten(data(tree).tree as ProjectTreeNode[]).map(pathOf)).toEqual([
      "assets",
      "assets/levels",
      "assets/levels/arena.checks.json",
      "assets/levels/arena.json",
      "assets/materials",
      "assets/materials/rubber.json",
      "assets/cards.json",
      "lib",
      "lib/helper.ts",
      "game.mjs",
    ]);
    expect(tree.text).toContain("game.mjs  code  (kinds: deck/notes; tables: card)");
  });

  it("refs follows material fields and scripts' scenes, and reports dangling ones", async () => {
    const rubber = await projectRefs({ id: "rubber" }, ctx);
    expect(rubber.exitCode).toBe(0);
    expect(data(rubber).referrers).toEqual([
      { id: "arena", kind: "scene", pointer: "/entities/@floor/material" },
    ]);

    const ambiguous = await projectRefs({ id: "arena" }, ctx);
    expect(ambiguous.exitCode).toBe(2);
    expect(ambiguous.text).toContain("pass --project");

    const level = await projectRefs({ id: "arena", project: "deck" }, ctx);
    expect(level.exitCode).toBe(0);
    expect(data(level)).toMatchObject({
      targets: [
        {
          id: "rubber",
          kinds: ["material"],
          target: { kind: "material", path: "assets/materials/rubber.json" },
        },
      ],
      referrers: [{ id: "arena-checks", kind: "checks", pointer: "/checks/@runs/script/scene" }],
    });

    const all = await projectRefs({ project: "deck" }, ctx);
    expect(all.exitCode).toBe(1);
    const dangling = data(all).dangling as SceneIssue[];
    expect(dangling).toHaveLength(1);
    expect(dangling[0]).toMatchObject({
      code: "asset-missing",
      entityIds: ["arena-checks"],
      path: "/checks/@stale/script/scene",
      got: "arenna",
    });
    expect(dangling[0]!.message).toContain('did you mean "arena"?');

    const missing = await projectRefs({ id: "arenna" }, ctx);
    expect(missing.exitCode).toBe(1);
    expect(data(missing)).toMatchObject({
      project: "deck",
      asset: null,
      referrers: [{ id: "arena-checks" }],
    });
    expect(missing.text.split("\n")[0]).toBe("arenna  (no asset; named by references)");

    const checksRefs = await projectRefs({ id: "arena-checks" }, ctx);
    expect(checksRefs.exitCode).toBe(1);
    expect((data(checksRefs).targets as { target: unknown }[]).map((t) => t.target)).toEqual([
      { id: "arena", kind: "scene", path: "assets/levels/arena.json" },
      null,
    ]);
  });

  it("snapshot writes the JSON, and fails when a doc has no canonical text", async () => {
    const out = join(root, "out/deck.snapshot.json");
    const written = await projectSnapshot({ project: "deck", out }, ctx);
    expect(written.exitCode).toBe(0);
    expect(data(written)).toMatchObject({ project: "deck", assets: 4, out });
    const parsed = await parseProjectSnapshot(await readFile(out, "utf8"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.snapshot.hash).toBe(data(written).hash);
    expect(Object.keys(parsed.snapshot.assets).sort()).toEqual([
      "arena",
      "arena-checks",
      "cards",
      "rubber",
    ]);
    expect((await projectSnapshot({ project: "deck" }, ctx)).text).toBe(parsed.snapshot.hash);

    await put("src/deck/assets/materials/broken.json", json({ kind: "material", v: 1 }));
    try {
      const shown = await projectShow({ project: "deck" }, ctx);
      expect(data(shown).problems).toMatchObject([{ path: "assets/materials/broken.json" }]);
      const refused = await projectSnapshot({ project: "deck", out }, ctx);
      expect(refused.exitCode).toBe(1);
      expect(data(refused)).toMatchObject({ unparsed: ["broken"] });
      expect(refused.text).toContain("assets/materials/broken.json");
      expect((await parseProjectSnapshot(await readFile(out, "utf8"))).ok).toBe(true);
    } finally {
      await rm(join(root, "src/deck/assets/materials/broken.json"));
    }
  });
});
