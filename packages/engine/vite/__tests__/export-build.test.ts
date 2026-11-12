// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import type { ExportInput, ExportPlan } from "../../export/plan";
import { createRegistry, withProject } from "../../game/define";
import { memoryContentStore, type ContentStore } from "../../project/content-store";
import { sha256 } from "../../project/hash";
import { checkReleaseManifest, parseReleaseManifest, RELEASE_FILE } from "../../project/release";
import { heldProject, type HeldFile } from "../../project/runtime-view";
import type { AssetSidecar } from "../../project/sidecar";
import { jsonValues, snapshotProject } from "../../project/snapshot";
import type { ProjectFile, Sha256 } from "../../project/types";
import {
  createExportBuild,
  EXPORT_ENTRY_ID,
  exportEntrySource,
  machineDirs,
  packageOfModule,
  thirdPartyOf,
  type ExportBuildOptions,
} from "../export-build";

const ROOT = "/work/games/demo";
const MODULES: ExportBuildOptions["modules"] = {
  game: { path: `${ROOT}/index.ts`, export: "demoGame" },
  ui: { path: `${ROOT}/ui/index.ts`, export: "mountDemoHud" },
};

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

const scene = (name: string, physics: "none" | "rapier") => ({
  v: 4,
  name,
  bounds: [0, 0, 6.4, 3.84],
  settings: { physics },
  assets: ["tiles"],
  entities: [{ id: "start", type: "marker", at: [1, 1], tags: ["spawn"] }],
});

async function demoInput(physics: "none" | "rapier", store: ContentStore): Promise<ExportInput> {
  const hash = await store.put(PNG);
  const sidecar: AssetSidecar = {
    kind: "asset-sidecar",
    v: 1,
    key: "key-tiles",
    id: "tiles",
    sha256: hash,
    bytes: PNG.length,
    meta: { format: "png", width: 2, height: 2 },
    licence: { spdx: "CC0-1.0", author: "Test authors" },
  };
  const docs: Record<string, unknown> = {
    "scene-list.json": { kind: "scene-list", v: 1, start: "yard", scenes: [{ scene: "yard" }] },
    "game-settings.json": { kind: "game-settings", v: 2, engine: {}, game: {} },
    "yard.json": scene("yard", physics),
  };
  const held: HeldFile[] = [{ path: "art/tiles.png", sidecar }];
  const byPath = new Map<string, string>();
  for (const [path, json] of Object.entries(docs)) {
    byPath.set(path, `${JSON.stringify(json, null, 2)}\n`);
    held.push({ path, json });
  }
  const project: ProjectFile = { kind: "project", v: 1, id: "demo", name: "Demo", game: null };
  const { view, kinds } = heldProject(held, createRegistry(testGame), {
    projectId: project.id,
    name: project.name,
  });
  const texts = new Map<string, string>();
  for (const entry of view.byId.values()) {
    const text = byPath.get(entry.path);
    if (entry.sha256 === undefined && text !== undefined) texts.set(entry.id, text);
  }
  return {
    project,
    view,
    texts,
    kinds,
    registry: withProject(createRegistry(testGame), view, jsonValues(texts)),
    game: testGame,
    engine: {},
    target: "web",
    snapshot: await snapshotProject(view, texts, view.state.build),
  };
}

let modulesDir: string;

beforeAll(() => {
  modulesDir = join(mkdtempSync(join(tmpdir(), "export-build-")), "node_modules");
  const pkg = (name: string, json: object, notice?: [string, string]) => {
    const dir = join(modulesDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name, ...json }));
    if (notice) writeFileSync(join(dir, notice[0]), notice[1]);
  };
  pkg("zod", { version: "4.0.0", license: "MIT" }, ["LICENSE.md", "MIT License\r\nzod"]);
  pkg("@dimforge/rapier2d", { version: "0.19.3", license: "Apache-2.0" }, ["LICENSE", "Apache"]);
  pkg("@dimforge/rapier2d-compat", { version: "0.19.3", license: "Apache-2.0" });
  pkg("no-licence", { version: "1.0.0" });
});

afterAll(() => {
  rmSync(join(modulesDir, ".."), { recursive: true, force: true });
});

type Emitted = { fileName: string; source: string | Uint8Array };

/** What Rolldown hands `generateBundle` for the demo: an entry, the game chunk and, with Rapier, its chunk and wasm. */
function fakeBundle(rapier: "standard" | "compat" | null): Record<string, unknown> {
  const chunk = (fileName: string, code: string, modules: string[], isEntry = false) => ({
    type: "chunk",
    fileName,
    name: fileName,
    code,
    isEntry,
    facadeModuleId: isEntry ? `\0${EXPORT_ENTRY_ID}` : null,
    modules: Object.fromEntries(modules.map((id) => [id, { renderedLength: 100 }])),
  });
  const bundle: Record<string, unknown> = {
    "code/main-aaaa.js": chunk(
      "code/main-aaaa.js",
      `import "./game-bbbb.js";\nconsole.log("main");\n`,
      [`\0${EXPORT_ENTRY_ID}`, `${modulesDir}/zod/index.js`, `${modulesDir}/no-licence/x.js?v=1`],
      true,
    ),
    "code/game-bbbb.js": chunk("code/game-bbbb.js", `export const game = 1;\n`, [
      `${ROOT}/index.ts`,
    ]),
    "code/main-cccc.css": { type: "asset", fileName: "code/main-cccc.css", source: "body{}" },
  };
  if (rapier) {
    const pkg = rapier === "standard" ? "rapier2d" : "rapier2d-compat";
    bundle["code/rapier-dddd.js"] = chunk("code/rapier-dddd.js", `export const r = 2;\n`, [
      `${modulesDir}/@dimforge/${pkg}/rapier.mjs`,
    ]);
  }
  if (rapier === "standard")
    bundle["code/rapier_wasm2d_bg-eeee.wasm"] = {
      type: "asset",
      fileName: "code/rapier_wasm2d_bg-eeee.wasm",
      source: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
    };
  return bundle;
}

async function runBuild(
  physics: "none" | "rapier",
  rapier: "standard" | "compat" = "standard",
  bundle = fakeBundle(physics === "rapier" ? rapier : null),
  output: Record<string, unknown> = { sourcemap: false },
) {
  const store = memoryContentStore();
  const input = await demoInput(physics, store);
  const plans: ExportPlan[] = [];
  const plugin = createExportBuild({
    input,
    modules: MODULES,
    content: store,
    rapier,
    onPlan: (plan) => plans.push(plan),
  });
  plugin.configResolved({ root: ROOT });
  await plugin.buildStart();
  const resolved = plugin.resolveId(EXPORT_ENTRY_ID);
  const entry = resolved === null ? null : plugin.load(resolved);
  const emitted: Emitted[] = [];
  await plugin.generateBundle.handler.call(
    { emitFile: (f) => emitted.push({ fileName: f.fileName, source: f.source }) },
    output,
    bundle,
  );
  return { plugin, entry, emitted, plans, bundle, store };
}

const bytesOf = (source: string | Uint8Array) =>
  typeof source === "string" ? new TextEncoder().encode(source) : source;

describe("createExportBuild", () => {
  it("requires the output an export needs: the virtual entry, hashed code/ names, no sourcemaps", () => {
    const plugin = createExportBuild({
      input: {} as ExportInput,
      modules: MODULES,
      content: memoryContentStore(),
      rapier: "standard",
    });
    const config = plugin.config();
    expect(config.publicDir).toBe(false);
    expect(config.build.sourcemap).toBe(false);
    expect(config.build.modulePreload).toBe(false);
    expect(config.build.rolldownOptions.input).toEqual({ main: EXPORT_ENTRY_ID });
    expect(config.build.rolldownOptions.output).toEqual({
      entryFileNames: "code/[name]-[hash].js",
      chunkFileNames: "code/[name]-[hash].js",
      assetFileNames: "code/[name]-[hash][extname]",
      sourcemap: false,
    });
    expect(plugin.resolveId("./other.ts")).toBeNull();
    expect(plugin.load("/work/other.ts")).toBeNull();
  });

  it("hashes chunks after every other plugin's generateBundle, as Vite writes them", () => {
    const plugin = createExportBuild({
      input: {} as ExportInput,
      modules: MODULES,
      content: memoryContentStore(),
      rapier: "standard",
    });
    expect(plugin.generateBundle.order).toBe("post");
    expect(Object.keys(plugin.generateBundle).sort()).toEqual(["handler", "order"]);
  });

  it("emits every planned file and release.json, and the plan holds together with the built files", async () => {
    const { emitted, plans, bundle, store } = await runBuild("none");
    expect(plans).toHaveLength(1);
    const plan = plans[0]!;
    expect(plan.issues.filter((i) => i.severity === "error")).toEqual([]);

    const notBuilt = plan.files.filter((f) => f.source.kind !== "built").map((f) => f.path);
    expect(emitted.map((e) => e.fileName).sort()).toEqual([...notBuilt, RELEASE_FILE].sort());
    for (const f of plan.files.filter((p) => p.source.kind === "built"))
      expect(Object.keys(bundle), f.path).toContain(f.path);

    const byName = new Map(emitted.map((e) => [e.fileName, e.source]));
    for (const f of plan.files) {
      if (f.source.kind === "blob")
        expect(bytesOf(byName.get(f.path)!)).toEqual(await store.get(f.source.sha256));
      if (f.source.kind === "text") expect(byName.get(f.path)).toBe(f.source.text);
    }
    expect(plan.files.some((f) => f.source.kind === "blob")).toBe(true);
    expect(byName.has("index.html")).toBe(true);
    expect(byName.has("credits.html")).toBe(true);
    expect(String(byName.get("index.html"))).toContain(`src="code/main-aaaa.js"`);
    expect(String(byName.get("index.html"))).toContain(`href="code/main-cccc.css"`);

    const parsed = parseReleaseManifest(String(byName.get(RELEASE_FILE)));
    expect(parsed.ok).toBe(true);
    const files = new Map<string, Sha256>();
    for (const [path, source] of byName)
      if (path !== RELEASE_FILE) files.set(path, await sha256(source));
    for (const out of Object.values(bundle) as {
      fileName: string;
      code?: string;
      source?: string | Uint8Array;
    }[])
      files.set(out.fileName, await sha256(out.code ?? out.source!));
    expect(await checkReleaseManifest(plan.manifest, files)).toEqual([]);
  });

  it("builds a physics-free entry with no Rapier import, and ships no Rapier", async () => {
    const { entry, plans } = await runBuild("none");
    expect(entry).toContain(`import { bootStandalone } from "@jams/engine/standalone";`);
    expect(entry).toContain(`import { demoGame as game } from "${ROOT}/index.ts";`);
    expect(entry).toContain(`import { mountDemoHud as ui } from "${ROOT}/ui/index.ts";`);
    expect(entry).not.toMatch(/rapier/i);
    expect(plans[0]!.manifest.build.rapier).toBeNull();
    expect(plans[0]!.manifest.build.files.some((f) => f.role === "wasm")).toBe(false);
  });

  it("imports the standard Rapier lazily for a Rapier plan and records its wasm", async () => {
    const { entry, plans } = await runBuild("rapier", "standard");
    expect(entry).toContain(`rapier: () => import("@dimforge/rapier2d")`);
    const m = plans[0]!.manifest;
    expect(m.build.rapier).toEqual({
      package: "@dimforge/rapier2d",
      version: "0.19.3",
      file: "code/rapier_wasm2d_bg-eeee.wasm",
      bytes: 8,
    });
    expect(m.build.files.find((f) => f.path === m.build.rapier!.file)?.role).toBe("wasm");
    expect(plans[0]!.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("imports -compat and runs its init() when asked, with no wasm file", async () => {
    const { entry, plans } = await runBuild("rapier", "compat");
    expect(entry).toContain(`await import("@dimforge/rapier2d-compat")`);
    expect(entry).toContain(`await rapier.init();`);
    expect(entry).not.toContain(`import("@dimforge/rapier2d")`);
    expect(plans[0]!.manifest.build.rapier).toEqual({
      package: "@dimforge/rapier2d-compat",
      version: "0.19.3",
      file: null,
      bytes: 100,
    });
  });

  it("credits every package the module ids reach, with its licence and notice", async () => {
    const { plans } = await runBuild("rapier", "standard");
    expect(plans[0]!.manifest.credits.code).toEqual([
      { package: "@dimforge/rapier2d", version: "0.19.3", licence: "Apache-2.0", notice: "Apache" },
      { package: "no-licence", version: "1.0.0", licence: "NOASSERTION", notice: null },
      { package: "zod", version: "4.0.0", licence: "MIT", notice: "MIT License\nzod" },
    ]);
  });

  it("refuses sourcemaps, absolute paths in code and bundler files it can't place", async () => {
    await expect(
      runBuild("none").then(async ({ plugin }) =>
        plugin.generateBundle.handler.call(
          { emitFile: () => {} },
          { sourcemap: true },
          fakeBundle(null),
        ),
      ),
    ).rejects.toThrow(/sourcemaps/);

    const leaky = fakeBundle(null);
    (leaky["code/game-bbbb.js"] as { code: string }).code = `//#region ${ROOT}/index.ts\n`;
    await expect(runBuild("none", "standard", leaky)).rejects.toThrow(/absolute path/);

    const image = fakeBundle(null);
    image["code/logo-ffff.png"] = { type: "asset", fileName: "code/logo-ffff.png", source: "x" };
    await expect(runBuild("none", "standard", image)).rejects.toThrow(/logo-ffff\.png/);
  });

  it("refuses code or styles naming the output directory or any module's directory", async () => {
    const dep = fakeBundle(null);
    (dep["code/main-aaaa.js"] as { code: string }).code +=
      `const f = "${modulesDir}/zod/index.js";\n`;
    await expect(runBuild("none", "standard", dep)).rejects.toThrow(
      `code/main-aaaa.js contains ${modulesDir}/zod`,
    );

    const css = fakeBundle(null);
    (css["code/main-cccc.css"] as { source: string }).source = `body{background:url(/out/x/a.png)}`;
    await expect(
      runBuild("none", "standard", css, { sourcemap: false, dir: "/out/x" }),
    ).rejects.toThrow(/main-cccc\.css contains \/out\/x/);
    await expect(
      runBuild("none", "standard", fakeBundle(null), { sourcemap: false, dir: "/out/x" }),
    ).resolves.toBeDefined();
  });

  it("refuses a Rapier plan whose bundle holds no Rapier", async () => {
    await expect(runBuild("rapier", "standard", fakeBundle(null))).rejects.toThrow(/no @dimforge/);
  });
});

describe("the entry and the package reader", () => {
  it("imports a default export by name and leaves the UI out when there is none", () => {
    const text = exportEntrySource(
      { game: { path: "/g/index.ts", export: "default" }, ui: null },
      null,
    );
    expect(text).toContain(`import { default as game } from "/g/index.ts";`);
    expect(text).not.toContain("ui");
    expect(() =>
      exportEntrySource({ game: { path: "g/index.ts", export: "game" }, ui: null }, null),
    ).toThrow(/absolute/);
  });

  it("keeps the outermost machine directories, skipping virtual ids and roots too short to name a machine", () => {
    expect(
      machineDirs(
        ["/work/games/demo/", "/work"],
        [
          "/work/games/demo/ui/index.ts",
          "/work/engine/a/b.ts?v=1",
          "/work/engine/c.ts",
          "\0virtual:jams-export/main",
          "rolldown:runtime",
          "/index.ts",
        ],
      ),
    ).toEqual(["/work/engine", "/work/games/demo"]);
  });

  it("finds the package of a module id, scoped or not, through nested node_modules", () => {
    expect(packageOfModule("/r/node_modules/.bun/x/node_modules/@a/b/dist/i.js?q")).toEqual({
      dir: "/r/node_modules/.bun/x/node_modules/@a/b",
      name: "@a/b",
    });
    expect(packageOfModule("\0/r/node_modules/zod/v4/index.js")?.name).toBe("zod");
    expect(packageOfModule("\0vite/preload-helper")).toBeNull();
    expect(thirdPartyOf([`${modulesDir}/zod/a.js`, `${modulesDir}/zod/b.js`])).toHaveLength(1);
  });
});
