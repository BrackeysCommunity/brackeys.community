// @vitest-environment node
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { ContentStoreError, parseSidecar, sha256 } from "@jams/engine/project";
import { listenSceneCollab, readFileProject, type ListeningSceneCollab } from "@jams/engine/vite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { runCli } from "../commands";
import type { ToolContext } from "../context";
import { devContentStore, ProjectClientError, readLiveScene } from "../project-client";
import { loadCompatRapier } from "../rapier-compat";
import { tempProject } from "./fixtures";

const ENGINE_SCENES = fileURLToPath(new URL("../../../src/engine/scenes", import.meta.url));
const FIXTURES = fileURLToPath(
  new URL("../../../src/engine/project/__tests__/fixtures", import.meta.url),
);

/** A 1×1 PNG. */
const DOT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const RUBBER = { kind: "material", v: 1, description: "Bouncy." };

let root: string;
let deck: string;
let ctx: ToolContext;

type Data = Record<string, unknown>;

async function run(...argv: string[]) {
  const r = await runCli([...argv, "--json"], ctx);
  return { exitCode: r.exitCode, data: JSON.parse(r.stdout) as Data };
}

/** Every file under `dir` with its bytes, by relative path. */
async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out[relative(dir, path)] = (await readFile(path)).toString("base64");
  }
  return out;
}

const ids = (data: Data) => (data.assets as { id: string }[]).map((a) => a.id);

/** The kitchen sink's art the copied engine project already holds, by kind. */
const SINK_TEXTURES = ["backdrop", "crates-texture", "hero-texture"];
const SINK_ATLASES = ["crates", "hero"];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-assets-"));
  deck = join(root, "deck");
  await cp(ENGINE_SCENES, deck, { recursive: true });
  await writeFile(join(root, "dot.png"), DOT);
  await writeFile(join(root, "rubber.json"), JSON.stringify(RUBBER));
  ctx = { projects: [await tempProject(deck, { id: "deck" })], loadRapier: loadCompatRapier };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("assets on files", { timeout: 60_000 }, () => {
  it("list shows every live asset by path", async () => {
    const r = await run("assets", "list");
    expect(r.exitCode).toBe(0);
    expect(ids(r.data)).toEqual([
      "backdrop",
      "crates",
      "crates-texture",
      "hero",
      "hero-texture",
      "cards",
      "engine-yard-checks",
      "engine-yard",
      "game-settings",
      "grid-yard-checks",
      "grid-yard",
      "kitchen-sink-checks",
      "kitchen-sink",
      "bouncy",
      "doorway",
      "gate",
      "latch",
      "one-way-latch",
      "post",
      "room",
    ]);
    expect((await run("assets", "list", "--kind", "prefab")).data.assets).toHaveLength(6);
    expect((await run("assets", "list", "--trash")).data.assets).toEqual([]);
  });

  it("import copies a binary to its path, with its sidecar and registry entry", async () => {
    const r = await run("assets", "import", join(root, "dot.png"), "--path", "art/");
    expect(r.exitCode, JSON.stringify(r.data)).toBe(0);
    expect(r.data).toMatchObject({ written: true, created: ["dot"] });
    expect(await readFile(join(deck, "art/dot.png"))).toEqual(DOT);
    const sidecar = parseSidecar(await readFile(join(deck, "art/dot.png.asset.json"), "utf8"));
    expect(sidecar.ok && sidecar.sidecar).toMatchObject({
      id: "dot",
      sha256: await sha256(new Uint8Array(DOT)),
      bytes: DOT.byteLength,
      meta: { format: "png", width: 1, height: 1 },
    });
    const listed = await run("assets", "list", "--kind", "texture");
    expect(ids(listed.data).sort()).toEqual([...SINK_TEXTURES, "dot"].sort());
    expect(listed.data.assets).toContainEqual(
      expect.objectContaining({ id: "dot", path: "art/dot.png", bytes: DOT.byteLength }),
    );
  });

  it("import makes a doc kind's file a createAsset, in the kind's folder", async () => {
    const r = await run("assets", "import", join(root, "rubber.json"));
    expect(r.exitCode, JSON.stringify(r.data)).toBe(0);
    expect(JSON.parse(await readFile(join(deck, "materials/rubber.json"), "utf8"))).toMatchObject(
      RUBBER,
    );
    expect(ids((await run("assets", "list", "--kind", "material")).data)).toEqual([
      "bouncy",
      "rubber",
    ]);
  });

  it("import tells an Aseprite or TexturePacker JSON by its meta.app, with no --kind", async () => {
    const png = [
      "assets",
      "import",
      join(FIXTURES, "hero.png"),
      "--path",
      "imported/",
      "--id",
      "hero-art",
    ];
    expect((await run(...png)).exitCode).toBe(0);
    for (const [file, tool, id] of [
      ["hero.json", "aseprite", ["--id", "imported-hero"]],
      ["items.json", "texturepacker", []],
    ] as const) {
      const r = await run("assets", "import", join(FIXTURES, file), "--path", "imported/", ...id);
      expect(r.exitCode, `${file}: ${JSON.stringify(r.data)}`).toBe(0);
      const raw = await readFile(join(deck, `imported/${file}.asset.json`), "utf8");
      const sidecar = parseSidecar(raw);
      expect(sidecar.ok && sidecar.sidecar, file).toMatchObject({
        assetKind: "atlas",
        meta: { tool },
      });
    }
    const hero = parseSidecar(await readFile(join(deck, "imported/hero.json.asset.json"), "utf8"));
    expect(hero.ok && hero.sidecar.import).toEqual({ texture: "hero-art" });
    const listed = await run("assets", "list", "--kind", "atlas");
    expect(ids(listed.data)).toEqual([...SINK_ATLASES, "imported-hero", "items"]);
    expect(listed.data.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "imported-hero", path: "imported/hero.json" }),
        expect.objectContaining({ id: "items", path: "imported/items.json" }),
      ]),
    );

    await writeFile(join(root, "frames.json"), JSON.stringify({ frames: {}, meta: {} }));
    const unnamed = await run("assets", "import", join(root, "frames.json"), "--dry-run");
    expect(unnamed.exitCode).toBe(2);
    expect(String(unnamed.data.error)).toMatch(/no asset kind matches/);
  });

  it("rename, move and set-import edit the registry, the files and their sidecars", async () => {
    await run("assets", "import", join(root, "dot.png"), "--path", "art/");
    expect((await run("assets", "rename", "dot", "--name", "Dot")).exitCode).toBe(0);
    expect((await run("assets", "move", "dot", "--to", "sprites")).exitCode).toBe(0);
    const set = await run("assets", "set-import", "dot", "--set", "filter=nearest");
    expect(set.exitCode, JSON.stringify(set.data)).toBe(0);
    expect(await readFile(join(deck, "sprites/dot.png"))).toEqual(DOT);
    const sidecar = parseSidecar(await readFile(join(deck, "sprites/dot.png.asset.json"), "utf8"));
    expect(sidecar.ok && sidecar.sidecar).toMatchObject({
      name: "Dot",
      import: { filter: "nearest" },
    });
    expect((await tree(deck))["art/dot.png"]).toBeUndefined();
    const renamed = await run("assets", "rename", "post", "--file", "pillar.json");
    expect(renamed.exitCode, JSON.stringify(renamed.data)).toBe(0);
    expect(Object.keys(await tree(deck))).toContain("prefabs/pillar.json");
  });

  it("change-id rewrites every reference; delete refuses an asset in use unless forced; restore brings it back", async () => {
    const changed = await run("assets", "change-id", "post", "pillar");
    expect(changed.exitCode, JSON.stringify(changed.data)).toBe(0);
    expect(changed.data).toMatchObject({ written: true });
    const sink = JSON.parse(await readFile(join(deck, "kitchen-sink.json"), "utf8")) as {
      instances: { prefab: string }[];
    };
    expect(sink.instances.map((i) => i.prefab)).toEqual([
      "pillar",
      "pillar",
      "gate",
      "gate",
      "room",
      "doorway",
      "one-way-latch",
    ]);

    const refused = await run("assets", "delete", "pillar");
    expect(refused.exitCode).toBe(1);
    expect(refused.data).toMatchObject({ written: false, issue: { code: "asset-in-use" } });
    const forced = await run("assets", "delete", "pillar", "--force");
    expect(forced.exitCode).toBe(1);
    expect(forced.data).toMatchObject({
      written: true,
      issues: [{ code: "asset-missing" }, { code: "asset-missing" }],
    });
    expect(ids((await run("assets", "list", "--trash")).data)).toEqual(["pillar"]);
    const restored = await run("assets", "restore", "pillar");
    expect(restored.exitCode, JSON.stringify(restored.data)).toBe(0);
    expect(ids((await run("assets", "list", "--kind", "prefab")).data)).toContain("pillar");
  });

  it("apply takes a project op batch; a stale base exits 3 and the current one applies", async () => {
    const batch = (base: string) => ({
      v: 1,
      base,
      ops: [
        { op: "renameAsset", id: "gate", name: "The gate" },
        { op: "moveAsset", ids: ["gate"], to: "kit/" },
      ],
    });
    const ops = join(root, "ops.json");
    await writeFile(ops, JSON.stringify(batch("0".repeat(64))));
    const stale = await run("assets", "apply", "--ops", ops);
    expect(stale.exitCode).toBe(3);
    expect(stale.data).toMatchObject({ issue: { code: "stale-base" }, written: false });

    const { hash } = (await run("project", "snapshot")).data as { hash: string };
    await writeFile(ops, JSON.stringify(batch(hash)));
    const applied = await run("assets", "apply", "--ops", ops);
    expect(applied.exitCode, JSON.stringify(applied.data)).toBe(0);
    expect((await run("assets", "list")).data.assets).toContainEqual(
      expect.objectContaining({ id: "gate", name: "The gate", path: "kit/gate.json" }),
    );
    const now = (await run("project", "snapshot")).data.hash;
    expect(now).not.toBe(hash);
    expect((await run("assets", "rename", "gate", "--name", "x", "--base", hash)).exitCode).toBe(3);
    expect(
      (await run("assets", "rename", "gate", "--name", "x", "--base", String(now))).exitCode,
    ).toBe(0);
  });

  describe("scene commands find prefabs through the registry", () => {
    const validates = async (scene: string) => {
      const r = await run("validate", scene);
      expect(r.exitCode, JSON.stringify(r.data)).toBe(0);
      const listed = await run("list");
      expect(listed.data.scenes).toContainEqual(
        expect.objectContaining({
          name: scene,
          ok: true,
          issues: expect.objectContaining({ error: 0 }),
        }),
      );
      expect((await run("show", scene)).exitCode).toBe(0);
      const stepped = await run("step", scene, "--ticks", "5");
      expect(stepped.exitCode, JSON.stringify(stepped.data)).toBe(0);
    };

    it("after the scene moves to another folder", async () => {
      expect((await run("assets", "move", "kitchen-sink", "--to", "levels/")).exitCode).toBe(0);
      expect(Object.keys(await tree(deck))).toContain("levels/kitchen-sink.json");
      await validates("kitchen-sink");
      expect((await run("validate", join(deck, "levels/kitchen-sink.json"))).exitCode).toBe(0);
    });

    it("after a prefab's file is renamed away from its id", async () => {
      expect((await run("assets", "rename", "post", "--file", "pillar.json")).exitCode).toBe(0);
      await validates("kitchen-sink");

      const ops = join(root, "define.json");
      const bar = { id: "bar", type: "solid", shape: ["box", 0, -20, 8, 20] };
      await writeFile(
        ops,
        JSON.stringify({ ops: [{ op: "definePrefab", id: "post", prefab: { entities: [bar] } }] }),
      );
      const applied = await run("apply", "kitchen-sink", "--ops", ops);
      expect(applied.exitCode, JSON.stringify(applied.data)).toBe(0);
      expect(Object.keys(await tree(deck))).not.toContain("prefabs/post.json");
      const post = JSON.parse(await readFile(join(deck, "prefabs/pillar.json"), "utf8")) as Data;
      expect(post).toMatchObject({ id: "post", entities: [bar] });
    });

    it("after a prefab moves out of prefabs/, and apply writes it back to its own file", async () => {
      expect((await run("assets", "move", "gate", "--to", "kit/")).exitCode).toBe(0);
      await validates("kitchen-sink");

      const ops = join(root, "define.json");
      const bar = { id: "bar", type: "solid", shape: ["box", 0, -12, 60, 12] };
      await writeFile(
        ops,
        JSON.stringify({ ops: [{ op: "definePrefab", id: "gate", prefab: { entities: [bar] } }] }),
      );
      const applied = await run("apply", "kitchen-sink", "--ops", ops);
      expect(applied.exitCode, JSON.stringify(applied.data)).toBe(0);
      const files = Object.keys(await tree(deck));
      expect(files).toContain("kit/gate.json");
      expect(files).not.toContain("prefabs/gate.json");
      const gate = JSON.parse(await readFile(join(deck, "kit/gate.json"), "utf8")) as Data;
      expect(gate).toMatchObject({ id: "gate", entities: [bar] });
      expect(ids((await run("assets", "list", "--kind", "prefab")).data)).toEqual([
        "gate",
        "doorway",
        "latch",
        "one-way-latch",
        "post",
        "room",
      ]);
    });

    it("apply puts a new prefab in the prefab kind's folder near the scene", async () => {
      expect((await run("assets", "move", "kitchen-sink", "--to", "levels/")).exitCode).toBe(0);
      const ops = join(root, "define.json");
      const peg = { id: "peg", type: "solid", shape: ["box", 0, -5, 5, 5] };
      await writeFile(
        ops,
        JSON.stringify({ ops: [{ op: "definePrefab", id: "peg", prefab: { entities: [peg] } }] }),
      );
      const applied = await run("apply", "kitchen-sink", "--ops", ops);
      expect(applied.exitCode, JSON.stringify(applied.data)).toBe(0);
      expect(Object.keys(await tree(deck))).toContain("levels/prefabs/peg.json");
      expect(ids((await run("assets", "list", "--kind", "prefab")).data)).toContain("peg");
    });
  });

  describe("scene apply follows the project's asset rules", () => {
    const peg = { id: "peg", type: "solid", shape: ["box", 0, -5, 5, 5] };
    const applyTo = async (scene: string, ops: unknown[], ...flags: string[]) => {
      const file = join(root, "scene-ops.json");
      await writeFile(file, JSON.stringify({ ops }));
      return run("apply", scene, "--ops", file, ...flags);
    };
    const applyOps = (ops: unknown[], ...flags: string[]) => applyTo("kitchen-sink", ops, ...flags);
    const hashOf = async (scene: string) => (await run("show", scene)).data.sceneHash as string;

    const nudge = { op: "move", refs: ["~solid:0"], by: [1, 0] };

    /**
     * A refusal reports the unchanged file's hash: the corrected batch applies, and a batch with a
     * `~` ref (which checks `--base`) is current against that hash and stale against the one it
     * leaves behind.
     */
    const retriesOn = async (scene: string, refused: Data, ops: unknown[]) => {
      const hash = refused.sceneHash as string;
      const fixed = await applyTo(scene, ops, "--dry-run", "--base", hash);
      expect(fixed.exitCode, JSON.stringify(fixed.data)).toBe(0);
      const bulk = await applyTo(scene, [nudge], "--dry-run", "--base", hash);
      expect(bulk.exitCode, JSON.stringify(bulk.data)).toBe(0);
      const after = bulk.data.sceneHash as string;
      expect(after).not.toBe(hash);
      const stale = await applyTo(scene, [nudge], "--dry-run", "--base", after);
      expect(stale.exitCode, JSON.stringify(stale.data)).toBe(3);
      expect(stale.data).toMatchObject({ written: false, issue: { code: "stale-base" } });
    };

    it("refuses a prefab id another asset holds and writes nothing", async () => {
      const before = await tree(deck);
      const hash = await hashOf("kitchen-sink");
      const ops = [{ op: "definePrefab", id: "bouncy", prefab: { entities: [peg] } }];
      for (const flags of [["--dry-run"], []]) {
        const r = await applyOps(ops, ...flags);
        expect(r.exitCode, JSON.stringify(r.data)).toBe(1);
        expect(r.data).toMatchObject({ written: false, issue: { code: "asset-id-taken" } });
        expect(r.data.sceneHash).toBe(hash);
        await retriesOn("kitchen-sink", r.data, [
          { op: "definePrefab", id: "peg", prefab: { entities: [peg] } },
        ]);
      }
      expect(await tree(deck)).toEqual(before);
    });

    it("refuses removing a prefab another scene still uses, and writes nothing", async () => {
      const placed = await applyTo("engine-yard", [
        { op: "instantiate", instance: { id: "gate-9", prefab: "gate", at: [400, 400] } },
      ]);
      expect(placed.exitCode, JSON.stringify(placed.data)).toBe(0);
      const before = await tree(deck);
      const hash = await hashOf("engine-yard");
      const ops = [
        { op: "remove", refs: ["gate-9"] },
        { op: "definePrefab", id: "gate", prefab: null },
      ];
      for (const flags of [["--dry-run"], []]) {
        const r = await applyTo("engine-yard", ops, ...flags);
        expect(r.exitCode, JSON.stringify(r.data)).toBe(1);
        expect(r.data).toMatchObject({
          ok: false,
          failedAt: 1,
          written: false,
          sceneHash: hash,
          issue: { code: "asset-in-use", entityIds: ["gate"] },
        });
        const referrers = (r.data.issue as { detail: { referrers: { id: string }[] } }).detail
          .referrers;
        expect(new Set(referrers.map((x) => x.id))).toEqual(new Set(["kitchen-sink"]));
        expect(referrers).toContainEqual({
          id: "kitchen-sink",
          pointer: "/instances/@gate-1/prefab",
        });
        await retriesOn("engine-yard", r.data, ops.slice(0, 1));
      }
      expect(await tree(deck)).toEqual(before);
      expect(ids((await run("assets", "list", "--kind", "prefab")).data)).toContain("gate");
      expect((await run("assets", "list", "--trash")).data.assets).toEqual([]);

      const kept = await applyTo("engine-yard", [...ops.slice(0, 1), nudge], "--base", hash);
      expect(kept.exitCode, JSON.stringify(kept.data)).toBe(0);
    });

    it("removes a prefab along with the scene's last instances of it", async () => {
      const r = await applyOps([
        { op: "remove", refs: ["post-1", "post-2"] },
        { op: "definePrefab", id: "post", prefab: null },
      ]);
      expect(r.exitCode, JSON.stringify(r.data)).toBe(0);
      expect(Object.keys(await tree(deck))).not.toContain("prefabs/post.json");
      expect(ids((await run("assets", "list", "--trash")).data)).toEqual(["post"]);
    });

    it("refuses removing a prefab while the scene keeps an instance of it", async () => {
      const before = await tree(deck);
      const r = await applyOps([
        { op: "remove", refs: ["post-1"] },
        { op: "definePrefab", id: "post", prefab: null },
      ]);
      expect(r.exitCode, JSON.stringify(r.data)).toBe(1);
      expect(r.data).toMatchObject({ written: false });
      expect(JSON.stringify(r.data)).toContain("post-2");
      expect(await tree(deck)).toEqual(before);
    });

    it("refuses a new prefab whose file another kind's asset holds", async () => {
      await writeFile(join(root, "peg.json"), JSON.stringify(RUBBER));
      const imported = await run(
        "assets",
        "import",
        join(root, "peg.json"),
        "--path",
        "prefabs/",
        "--id",
        "rubber-peg",
      );
      expect(imported.exitCode, JSON.stringify(imported.data)).toBe(0);
      const before = await tree(deck);
      const r = await applyOps([{ op: "definePrefab", id: "peg", prefab: { entities: [peg] } }]);
      expect(r.exitCode, JSON.stringify(r.data)).toBe(1);
      expect(r.data).toMatchObject({ written: false, issue: { code: "path-taken" } });
      expect(await tree(deck)).toEqual(before);
      expect(JSON.parse(await readFile(join(deck, "prefabs/peg.json"), "utf8"))).toMatchObject(
        RUBBER,
      );
    });

    it("refuses a new prefab whose path differs only in case from another asset's", async () => {
      await writeFile(join(root, "Peg.json"), JSON.stringify(RUBBER));
      const imported = await run(
        "assets",
        "import",
        join(root, "Peg.json"),
        "--path",
        "prefabs/",
        "--id",
        "rubber-peg",
      );
      expect(imported.exitCode, JSON.stringify(imported.data)).toBe(0);
      expect(Object.keys(await tree(deck))).toContain("prefabs/Peg.json");
      const before = await tree(deck);
      const hash = await hashOf("kitchen-sink");
      const ops = [
        { op: "setScene", set: { name: "Kitchen sink" } },
        { op: "definePrefab", id: "peg", prefab: { entities: [peg] } },
      ];
      for (const flags of [["--dry-run"], []]) {
        const r = await applyOps(ops, ...flags);
        expect(r.exitCode, JSON.stringify(r.data)).toBe(1);
        expect(r.data).toMatchObject({
          ok: false,
          failedAt: 1,
          written: false,
          sceneHash: hash,
          issue: { code: "path-taken", entityIds: ["peg", "rubber-peg"] },
        });
        await retriesOn("kitchen-sink", r.data, ops.slice(0, 1));
      }
      expect(await tree(deck)).toEqual(before);
      expect(ids((await run("assets", "list", "--kind", "prefab")).data)).not.toContain("peg");
    });

    it("refuses a new prefab whose path a file outside the registry holds", async () => {
      await writeFile(join(deck, "prefabs/peg.json"), "{ not json");
      const before = await tree(deck);
      const hash = await hashOf("kitchen-sink");
      const ops = [{ op: "definePrefab", id: "peg", prefab: { entities: [peg] } }];
      for (const flags of [["--dry-run"], []]) {
        const r = await applyOps(ops, ...flags);
        expect(r.exitCode, JSON.stringify(r.data)).toBe(1);
        expect(r.data).toMatchObject({
          ok: false,
          failedAt: 0,
          written: false,
          sceneHash: hash,
          issue: { code: "path-taken", entityIds: ["peg"], got: "prefabs/peg.json" },
        });
        await retriesOn("kitchen-sink", r.data, [
          { op: "definePrefab", id: "plug", prefab: { entities: [peg] } },
        ]);
      }
      expect(await tree(deck)).toEqual(before);
      expect(ids((await run("assets", "list", "--kind", "prefab")).data)).not.toContain("peg");
    });

    it("sends a deleted prefab to the trash, and restore brings back its file and entry", async () => {
      const made = await applyOps([{ op: "definePrefab", id: "peg", prefab: { entities: [peg] } }]);
      expect(made.exitCode, JSON.stringify(made.data)).toBe(0);
      const text = await readFile(join(deck, "prefabs/peg.json"), "utf8");

      const dropped = await applyOps([{ op: "definePrefab", id: "peg", prefab: null }]);
      expect(dropped.exitCode, JSON.stringify(dropped.data)).toBe(0);
      expect(Object.keys(await tree(deck))).not.toContain("prefabs/peg.json");
      expect(ids((await run("assets", "list", "--trash")).data)).toEqual(["peg"]);
      expect(ids((await run("assets", "list", "--kind", "prefab")).data)).not.toContain("peg");

      const restored = await run("assets", "restore", "peg");
      expect(restored.exitCode, JSON.stringify(restored.data)).toBe(0);
      expect(await readFile(join(deck, "prefabs/peg.json"), "utf8")).toBe(text);
      expect(ids((await run("assets", "list", "--kind", "prefab")).data)).toContain("peg");
      expect((await run("assets", "list", "--trash")).data.assets).toEqual([]);
    });
  });

  it("--dry-run reports what every writer would do and writes nothing", async () => {
    await run("assets", "import", join(root, "dot.png"), "--path", "art/");
    const before = await tree(root);
    const ops = join(root, "ops.json");
    await writeFile(
      ops,
      JSON.stringify({ v: 1, ops: [{ op: "renameAsset", id: "gate", name: "G" }] }),
    );
    const after = { ...before, [relative(root, ops)]: (await readFile(ops)).toString("base64") };
    await writeFile(join(root, "big.png"), Buffer.concat([DOT]));
    after["big.png"] = (await readFile(join(root, "big.png"))).toString("base64");
    for (const argv of [
      ["assets", "import", join(root, "rubber.json")],
      ["assets", "rename", "gate", "--name", "Gate"],
      ["assets", "move", "gate", "post", "--to", "kit/"],
      ["assets", "delete", "dot"],
      ["assets", "change-id", "post", "pillar"],
      ["assets", "set-import", "dot", "--set", '{"filter":"nearest"}'],
      ["assets", "apply", "--ops", ops],
    ]) {
      const r = await run(...argv, "--dry-run");
      expect(r.exitCode, `${argv.join(" ")}: ${JSON.stringify(r.data)}`).toBe(0);
      expect(r.data).toMatchObject({ dryRun: true, written: false });
    }
    const imported = await run("assets", "import", join(root, "big.png"), "--dry-run");
    expect(imported.data).toMatchObject({ created: ["big"], written: false });
    expect(await tree(root)).toEqual(after);
  });

  it("an id two projects hold needs --project, which exits 2 when it names no project", async () => {
    const other = join(root, "other");
    await cp(join(deck, "prefabs"), join(other, "prefabs"), { recursive: true });
    ctx = { ...ctx, projects: [...ctx.projects, await tempProject(other, { id: "other" })] };
    const ambiguous = await run("assets", "rename", "post", "--name", "Post");
    expect(ambiguous.exitCode).toBe(2);
    expect(String(ambiguous.data.error)).toMatch(/more than one project: deck, other/);
    const picked = await run("assets", "rename", "post", "--name", "Post", "--project", "other");
    expect(picked.exitCode, JSON.stringify(picked.data)).toBe(0);
    expect(picked.data).toMatchObject({ project: "other" });
    expect((await run("assets", "list", "--project", "nope")).exitCode).toBe(2);
    expect((await run("assets", "import", join(root, "dot.png"))).exitCode).toBe(2);
  });

  it("exits 2 on usage and 1 on a missing asset or file", async () => {
    expect((await run("assets", "move", "gate")).exitCode).toBe(2);
    expect((await run("assets", "rename", "gate")).exitCode).toBe(2);
    expect((await run("assets", "set-import", "gate", "--set", "oops")).exitCode).toBe(2);
    expect((await run("assets", "rename", "gate", "--name", "x", "--url", "ws://x")).exitCode).toBe(
      2,
    );
    expect((await run("assets", "rename", "nope", "--name", "x")).exitCode).toBe(1);
    expect((await run("assets", "import", join(root, "missing.png"))).exitCode).toBe(1);
    expect((await run("assets", "restore", "gate")).exitCode).toBe(1);
  });

  it("info prints a texture's size and an atlas frame's size and pivot", async () => {
    const art = ["--path", "art/"];
    expect(
      (await run("assets", "import", join(FIXTURES, "items.png"), ...art, "--id", "items-art"))
        .exitCode,
    ).toBe(0);
    expect((await run("assets", "import", join(FIXTURES, "items.json"), ...art)).exitCode).toBe(0);

    const texture = await run("assets", "info", "items-art");
    expect(texture.exitCode, JSON.stringify(texture.data)).toBe(0);
    expect(texture.data).toMatchObject({
      project: "deck",
      path: "art/items.png",
      info: { id: "items-art", kind: "texture", size: [16, 16] },
    });

    const frame = await run("assets", "info", "items", "--frame", "gem.png");
    expect(frame.exitCode, JSON.stringify(frame.data)).toBe(0);
    expect(frame.data).toMatchObject({
      frame: "gem.png",
      info: {
        kind: "atlas",
        size: [8, 8],
        pivot: [0.5, 1],
        frames: ["coin.png", "gem.png", "panel.png"],
        texture: "items-art",
      },
    });
    const text = await runCli(["assets", "info", "items", "--frame", "gem.png"], ctx);
    expect(text.stdout).toContain("frame gem.png: 8×8, pivot 0.5,1");
    expect(text.stdout).toContain("texture items-art");

    const unknown = await run("assets", "info", "items", "--frame", "gem.pn");
    expect(unknown.exitCode).toBe(1);
    expect(String(unknown.data.error)).toMatch(/no frame "gem.pn"; did you mean "gem.png"\?/);
    const missing = await run("assets", "info", "item");
    expect(missing.exitCode).toBe(1);
    expect(String(missing.data.error)).toMatch(/Did you mean "items"\?/);
    expect((await run("assets", "info")).exitCode).toBe(2);
  });
});

describe("assets --live", { timeout: 60_000 }, () => {
  let server: ListeningSceneCollab;

  async function until(check: () => Promise<boolean>, what: string, ms = 5_000) {
    const end = Date.now() + ms;
    while (!(await check())) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  beforeEach(async () => {
    server = await listenSceneCollab({
      projects: [await readFileProject(deck, { cacheDir: join(root, "server-cache") })],
      debounceMs: 50,
      warn: () => undefined,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  const live = (...argv: string[]) => run(...argv, "--live", "--url", server.url);

  it("lists, renames and changes ids on the server's docs as the agent", async () => {
    const listed = await live("assets", "list");
    expect(listed.exitCode, JSON.stringify(listed.data)).toBe(0);
    expect(listed.data).toMatchObject({ live: true });
    expect(ids(listed.data)).toContain("kitchen-sink");

    const renamed = await live("assets", "rename", "gate", "--name", "Gate", "--agent", "claude");
    expect(renamed.exitCode, JSON.stringify(renamed.data)).toBe(0);
    expect(renamed.data).toMatchObject({ live: true, written: true, actor: { agentId: "claude" } });

    const changed = await live("assets", "change-id", "post", "pillar");
    expect(changed.exitCode, JSON.stringify(changed.data)).toBe(0);
    const { text } = await readLiveScene({
      projects: ctx.projects,
      url: server.url,
      scene: "kitchen-sink",
    });
    expect(text).toContain('"prefab": "pillar"');
    expect((await live("assets", "list")).data.assets).toContainEqual(
      expect.objectContaining({ id: "gate", name: "Gate" }),
    );
    await until(
      async () =>
        (await readFile(join(deck, "kitchen-sink.json"), "utf8")).includes('"prefab": "pillar"'),
      "the server to write the scene back",
    );
  });

  it("imports a binary: the bytes upload to the server's store, then importAsset names them", async () => {
    const dry = await live(
      "assets",
      "import",
      join(root, "dot.png"),
      "--path",
      "art/",
      "--dry-run",
    );
    expect(dry.exitCode, JSON.stringify(dry.data)).toBe(0);
    expect(dry.data).toMatchObject({ dryRun: true, written: false, created: ["dot"] });
    expect(ids((await live("assets", "list")).data)).not.toContain("dot");

    const r = await live("assets", "import", join(root, "dot.png"), "--path", "art/");
    expect(r.exitCode, JSON.stringify(r.data)).toBe(0);
    const hash = await sha256(new Uint8Array(DOT));
    const textures = (await live("assets", "list", "--kind", "texture")).data;
    expect(ids(textures).sort()).toEqual([...SINK_TEXTURES, "dot"].sort());
    expect(textures.assets).toContainEqual(
      expect.objectContaining({ id: "dot", path: "art/dot.png", sha256: hash }),
    );
    const blob = await fetch(new URL(`/__project/deck/blob/${hash}`, server.httpUrl));
    expect(Buffer.from(await blob.arrayBuffer())).toEqual(DOT);
  });

  it("imports an atlas export told by its meta.app, with no --kind", async () => {
    for (const [file, id] of [
      ["hero.json", ["--id", "imported-hero"]],
      ["items.json", []],
    ] as const) {
      const r = await live("assets", "import", join(FIXTURES, file), "--path", "imported/", ...id);
      expect(r.exitCode, `${file}: ${JSON.stringify(r.data)}`).toBe(0);
    }
    const atlases = (await live("assets", "list", "--kind", "atlas")).data;
    expect(ids(atlases)).toEqual([...SINK_ATLASES, "imported-hero", "items"]);
    expect(atlases.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "imported-hero", path: "imported/hero.json" }),
        expect.objectContaining({ id: "items", path: "imported/items.json" }),
      ]),
    );
    await until(async () => {
      const raw = await readFile(join(deck, "imported/items.json.asset.json"), "utf8").catch(
        () => "",
      );
      const sidecar = parseSidecar(raw);
      return sidecar.ok && sidecar.sidecar.assetKind === "atlas";
    }, "the server to write the atlas's sidecar");
  });

  it("fails fast with no server, and refuses --base on a live batch", async () => {
    const down = await run(
      "assets",
      "rename",
      "gate",
      "--name",
      "x",
      "--live",
      "--url",
      "ws://127.0.0.1:9/__scene-collab",
    );
    expect(down.exitCode).toBe(1);
    expect(String(down.data.error)).toMatch(/Can't reach/);
    expect(
      (await live("assets", "rename", "gate", "--name", "x", "--base", "0".repeat(64))).exitCode,
    ).toBe(2);
  });

  it("refuses bytes that hash otherwise than --expect with the hash-mismatch issue", async () => {
    const store = devContentStore(server.url, "deck");
    const err = await store.put(new Uint8Array(DOT), "0".repeat(64)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContentStoreError);
    expect((err as ContentStoreError).issue.code).toBe("hash-mismatch");
    const hash = await sha256(new Uint8Array(DOT));
    expect(await store.put(new Uint8Array(DOT), hash)).toBe(hash);
  });

  it("refuses an over-limit upload with asset-too-large and an empty one, as the site does", async () => {
    const store = devContentStore(server.url, "deck");
    const huge = await store.put(new Uint8Array(16 * 1024 * 1024 + 1)).catch((e: unknown) => e);
    expect(huge).toBeInstanceOf(ContentStoreError);
    expect((huge as ContentStoreError).issue.code).toBe("asset-too-large");
    const empty = await store.put(new Uint8Array(0)).catch((e: unknown) => e);
    expect(empty).toBeInstanceOf(ProjectClientError);
    expect((empty as Error).message).toMatch(/400: The upload is empty/);
  });

  it("refuses a plain-http site URL off this machine with the https rule", async () => {
    const r = await run("assets", "list", "--live", "--url", "http://example.test");
    expect(r.exitCode).toBe(2);
    expect(String(r.data.error)).toMatch(/must be https:\/\/ \(http:\/\/ only on localhost\)/);
  });
});
