// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { inflateSync } from "node:zlib";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { planContent } from "../export/content";
import { renderCredits } from "../export/credits";
import { renderIndexHtml } from "../export/html";
import { defaultIconPng, iconFile, planIcons } from "../export/icons";
import { ITCH_LIMITS } from "../export/itch";
import { finishExport, type BuiltCode, type ExportInput, type ExportPlan } from "../export/plan";
import { renderServiceWorker, serviceWorkerCacheName } from "../export/service-worker";
import { renderWebManifest } from "../export/web-manifest";
import { defineEntityType, defineGame } from "../game/define";
import { assetField, pointField } from "../game/fields";
import { stableJson } from "../project/canonical";
import { sha256 } from "../project/hash";
import { parseProjectFile } from "../project/project-file";
import {
  ENGINE_FORMATS,
  formatReleaseManifest,
  RELEASE_FILE,
  releaseSnapshot,
  type ReleaseManifest,
} from "../project/release";
import type { HeldFile } from "../project/runtime-view";
import type { AssetSidecar } from "../project/sidecar";
import { snapshotProject } from "../project/snapshot";
import type { ProjectFile } from "../project/types";
import {
  CC0,
  FREE_PROJECT,
  heldInput,
  png,
  physicsFreeFiles,
  scene,
  type HeldFiles,
} from "./fixtures/held-project";
import { testGame } from "./fixtures/test-game";

const engineDir = fileURLToPath(new URL("../scenes/", import.meta.url));

const SIDECAR = ".asset.json";

/** Every file under `dir` as a host holds it: docs by their JSON, binaries by their sidecars. */
function readHeld(dir: string): HeldFiles {
  const files: HeldFile[] = [];
  const texts = new Map<string, string>();
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const path = relative(dir, full).split("\\").join("/");
      if (path.endsWith(SIDECAR) || path === "jams.project.json") continue;
      let sidecar: AssetSidecar | null = null;
      try {
        sidecar = JSON.parse(readFileSync(full + SIDECAR, "utf8")) as AssetSidecar;
      } catch {
        sidecar = null;
      }
      if (!path.endsWith(".json")) {
        files.push({ path, sidecar });
        continue;
      }
      const text = readFileSync(full, "utf8");
      texts.set(path, text);
      files.push({ path, json: JSON.parse(text), sidecar });
    }
  };
  walk(dir);
  return { files, texts };
}

const ENGINE_PROJECT: ProjectFile = {
  kind: "project",
  v: 1,
  id: "engine",
  name: "Engine",
  game: null,
};

const builtCode = (rapier: BuiltCode["rapier"] = null): BuiltCode => ({
  files: [
    { path: "code/main-abc123.js", sha256: "d".repeat(64), bytes: 1000, role: "code" },
    { path: "code/main-abc123.css", sha256: "e".repeat(64), bytes: 100, role: "style" },
    ...(rapier?.file
      ? [{ path: rapier.file, sha256: "f".repeat(64), bytes: rapier.bytes, role: "wasm" as const }]
      : []),
  ],
  entry: "code/main-abc123.js",
  rapier,
  thirdParty: [
    { package: "zod", version: "4.0.0", licence: "MIT", notice: "MIT License" },
    { package: "pixi.js", version: "8.0.0", licence: "MIT", notice: null },
  ],
});

describe("the content plan over the engine project", () => {
  let input: ExportInput;
  beforeAll(async () => {
    input = await heldInput(ENGINE_PROJECT, readHeld(engineDir), testGame);
  });

  it("ships the listed scenes in list order, the sublevel marked, each with its physics", async () => {
    const plan = await planContent(input);
    expect(plan.start).toBe("engine-yard");
    expect(plan.scenes.map((s) => s.id)).toEqual([
      "engine-yard",
      "kitchen-sink",
      "grid-yard",
      "grid-annex",
    ]);
    expect(plan.scenes.find((s) => s.id === "grid-annex")?.sublevel).toBe(true);
    expect(plan.scenes.find((s) => s.id === "grid-yard")?.physics).toBe("none");
    expect(plan.scenes.find((s) => s.id === "kitchen-sink")?.physics).toBe("rapier");
    expect(plan.needsRapier).toBe(true);
  });

  it("ships every prefab a scene expands, its bundle's blobs and the runtime docs, never checks or saves", async () => {
    const plan = await planContent(input);
    const kinds = new Set(Object.values(plan.assets).map((a) => a.kind));
    expect(kinds).not.toContain("checks");
    expect(kinds).not.toContain("save");
    expect(kinds).not.toContain("input-script");
    for (const kind of ["game-settings", "input-map", "scene-list", "data-table"])
      expect(kinds, kind).toContain(kind);
    const sink = plan.scenes.find((s) => s.id === "kitchen-sink")!;
    expect(sink.prefabs.length).toBeGreaterThan(0);
    expect(sink.prefabs).toEqual([...sink.prefabs].sort());
    for (const s of plan.scenes) {
      for (const id of [...s.prefabs, ...s.bundle.entries])
        expect(plan.assets[id], `${s.id} → ${id}`).toBeDefined();
      const bytes = s.bundle.entries.reduce((n, id) => n + plan.assets[id]!.bytes, 0);
      expect(s.bundle.bytes).toBe(bytes);
    }
    expect(sink.bundle.entries.length).toBeGreaterThan(0);
    expect(Object.keys(plan.assets)).toEqual(Object.keys(plan.assets).sort());
  });

  it("plans the engine project with no error, and a release that holds together", async () => {
    const plan = await planContent(input);
    expect(plan.issues.filter((i) => i.severity === "error")).toEqual([]);
    const rapier = {
      package: "@dimforge/rapier2d" as const,
      version: "0.19.3",
      file: "code/rapier-0a1b2c.wasm",
      bytes: 1_400_000,
    };
    const built = await finishExport(plan, builtCode(rapier), input);
    expect(built.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(built.manifest.budget.measured.wasmBytes).toBe(rapier.bytes);
  });

  it("names each shipped file by content", async () => {
    const plan = await planContent(input);
    for (const [id, a] of Object.entries(plan.assets)) {
      if (a.storage === "doc") {
        expect(a.file, id).toBe(`data/${a.sha256}.json`);
        expect(a.sha256).toBe(await sha256(input.texts.get(id)!));
      } else expect(a.file, id).toMatch(new RegExp(`^assets/${a.sha256}\\.(png|json)$`));
    }
  });

  it("groups the engine's licensed art by identical licence", async () => {
    const plan = await planContent(input);
    const credited = plan.credits.assets.flatMap((c) => c.assets);
    const blobs = Object.values(plan.assets).filter((a) => a.storage === "blob").length;
    expect(credited.length + plan.credits.missing.length).toBe(blobs);
    for (const c of plan.credits.assets) expect(c.assets).toEqual([...c.assets].sort());
  });
});

describe("the content plan over a physics-free project", () => {
  let input: ExportInput;
  beforeAll(async () => {
    input = await heldInput(FREE_PROJECT, physicsFreeFiles(), testGame);
  });

  it("ships listed scenes and what they reach; unlisted scenes, checks, scripts and unused art stay out", async () => {
    const plan = await planContent(input);
    expect(Object.keys(plan.assets)).toEqual([
      "game-settings",
      "hall",
      "rocks",
      "scene-list",
      "tiles",
      "yard",
    ]);
    expect(plan.scenes.map((s) => [s.id, s.title ?? null])).toEqual([
      ["yard", "Yard"],
      ["hall", null],
    ]);
    expect(plan.scenes.find((s) => s.id === "hall")?.bundle).toEqual({
      entries: ["rocks", "tiles"],
      bytes: 500,
    });
  });

  it("needs no Rapier when no listed scene resolves to it", async () => {
    const plan = await planContent(input);
    expect(plan.scenes.map((s) => s.physics)).toEqual(["none", "none"]);
    expect(plan.needsRapier).toBe(false);
  });

  it("warns scene-unlisted, through the scene list's rule, for a sublevel a check names outside the list", async () => {
    const plan = await planContent(input);
    const unlisted = plan.issues.filter((i) => i.code === "scene-unlisted");
    expect(unlisted).toHaveLength(1);
    expect(unlisted[0]).toMatchObject({
      severity: "warn",
      got: "cellar",
      path: "/checks/0/expect/scene",
    });
    expect(unlisted[0]!.line).toBeTypeOf("number");
  });

  it("warns scene-unlisted for an entity field of a listed scene naming an unlisted scene, which doesn't ship", async () => {
    const DOOR = defineEntityType({
      type: "door",
      description: "A door to another scene.",
      base: "marker",
      fields: (env) => ({
        at: pointField("Where it stands."),
        to: assetField(env, "scene", "The scene it leads to."),
      }),
    });
    const doorGame = defineGame({ ...testGame, types: [...testGame.types, DOOR] });
    const held = physicsFreeFiles();
    const hall = {
      ...scene("hall", ["rocks", "tiles"]),
      game: testGame.id,
      entities: [
        { id: "start", type: "marker", at: [1, 1], tags: ["spawn"] },
        { id: "trapdoor", type: "door", at: [2, 1], to: "attic" },
      ],
    };
    held.texts.set("hall.json", `${JSON.stringify(hall, null, 2)}\n`);
    held.files = held.files.map((f) => (f.path === "hall.json" ? { path: f.path, json: hall } : f));
    const plan = await planContent(await heldInput(FREE_PROJECT, held, doorGame));
    const unlisted = plan.issues.filter((i) => i.code === "scene-unlisted" && i.got === "attic");
    expect(unlisted).toHaveLength(1);
    expect(unlisted[0]).toMatchObject({ severity: "warn", entityIds: ["hall", "attic"] });
    expect(unlisted[0]!.path).toContain("trapdoor");
    expect(unlisted[0]!.message).toContain("isn't in the scene list");
    expect(plan.assets.attic).toBeUndefined();
    expect(plan.assets.unused).toBeUndefined();
    expect(plan.issues.filter((i) => i.code === "asset-missing")).toEqual([]);
  });

  it("raises licence-missing once per shipped asset without a licence", async () => {
    const plan = await planContent(input);
    const missing = plan.issues.filter((i) => i.code === "licence-missing");
    expect(missing.map((i) => i.entityIds)).toEqual([["rocks"]]);
    expect(plan.credits).toEqual({
      assets: [{ assets: ["tiles"], spdx: "CC0-1.0", author: "Test authors" }],
      missing: ["rocks"],
    });
  });

  it("plans the PWA from the project's export block, and none for a target without one", async () => {
    const plan = await planContent(input);
    expect(plan.pwa).toEqual({
      name: "Free",
      shortName: "Free",
      display: "fullscreen",
      orientation: "any",
      themeColor: "#000000",
      background: "#000000",
      icons: [
        { file: "icons/icon-192.png", size: 192 },
        { file: "icons/icon-512.png", size: 512 },
      ],
    });
    const tuned = await planContent({
      ...input,
      project: {
        ...FREE_PROJECT,
        export: { shortName: "F", themeColor: "#112233", display: "standalone" },
      },
      engine: { resolution: { virtual: { width: 640, height: 360 }, fit: "letterbox" } },
    });
    expect(tuned.pwa).toMatchObject({
      shortName: "F",
      themeColor: "#112233",
      display: "standalone",
      orientation: "landscape",
    });
    expect((await planContent({ ...input, target: "itch" })).pwa).toBeNull();
    const off = { ...FREE_PROJECT, export: { pwa: false } };
    expect((await planContent({ ...input, project: off })).pwa).toBeNull();
  });

  it("plans the platformer's PWA from the export block its project file names", async () => {
    const parsed = parseProjectFile(
      readFileSync(join(process.cwd(), "src/games/platformer/jams.project.json"), "utf8"),
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.file.export).toEqual({
      shortName: "Platformer",
      themeColor: "#1a1a2e",
      background: "#1a1a2e",
      display: "fullscreen",
      rapier: "standard",
    });
    const plan = await planContent({ ...input, project: parsed.file });
    expect(plan.pwa).toMatchObject({
      name: "Platformer",
      shortName: "Platformer",
      display: "fullscreen",
      themeColor: "#1a1a2e",
      background: "#1a1a2e",
    });
  });

  it("refuses a target this engine has no row for", async () => {
    const plan = await planContent({ ...input, target: "desktop" });
    expect(plan.issues.filter((i) => i.code === "export-target-unsupported")).toHaveLength(1);
    expect(plan.pwa).toBeNull();
  });

  it("takes the time model from the game and the project's tick rate", async () => {
    const plan = await planContent({ ...input, engine: { tickRate: 30 } });
    expect(plan.time).toEqual({
      kind: testGame.time?.kind ?? "fixed",
      rate: 30,
      catchUp: testGame.time?.catchUp ?? null,
      wakeOnPointerMove: testGame.time?.wakeOnPointerMove ?? false,
    });
  });

  it("gives the same plan for the same input", async () => {
    const a = await planContent(input);
    const b = await planContent(await heldInput(FREE_PROJECT, physicsFreeFiles(), testGame));
    expect(stableJson(b)).toBe(stableJson(a));
  });
});

describe("icons", () => {
  it("falls back to the default, with export-asset-missing at warn, for an icon that isn't a PNG of its size", async () => {
    const input = await heldInput(
      { ...FREE_PROJECT, export: { icons: { "192": "tiles" } } },
      physicsFreeFiles(),
      testGame,
    );
    const { icons, issues } = planIcons(input);
    expect(icons.map((i) => [i.file, i.source.kind])).toEqual([
      ["icons/icon-192.png", "default"],
      ["icons/icon-512.png", "default"],
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "export-asset-missing",
      severity: "warn",
      path: "/export/icons/192",
    });
    expect(issues[0]!.message).toContain("icons/icon-192.png falls back to the default");
  });

  it("ships a texture of exactly the size as the icon", async () => {
    const held = physicsFreeFiles();
    held.files.push({ path: "art/icon.png", sidecar: png("icon", "9".repeat(64), 900, 512) });
    const input = await heldInput(
      { ...FREE_PROJECT, export: { icons: { "512": "icon" } } },
      held,
      testGame,
    );
    const { icons, issues } = planIcons(input);
    expect(issues).toEqual([]);
    expect(icons[1]).toEqual({
      size: 512,
      file: iconFile(512),
      source: { kind: "asset", id: "icon", sha256: "9".repeat(64), bytes: 900 },
    });
  });

  it("ships a named icon as an asset of the release: pinned by its snapshot, credited, written once", async () => {
    const held = physicsFreeFiles();
    held.files.push({ path: "art/icon.png", sidecar: png("icon", "9".repeat(64), 900, 512, CC0) });
    const input = await heldInput(
      { ...FREE_PROJECT, export: { icons: { "512": "icon" } } },
      held,
      testGame,
    );
    const content = await planContent(input);
    expect(content.assets.icon).toMatchObject({
      sha256: "9".repeat(64),
      file: iconFile(512),
      licence: CC0,
    });
    expect(content.credits.assets.find((c) => c.assets.includes("icon"))).toBeDefined();
    const plan = await finishExport(content, builtCode(), input);
    expect(plan.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(releaseSnapshot(plan.manifest).assets.icon?.sha256).toBe("9".repeat(64));
    expect(plan.files.filter((f) => f.path === iconFile(512))).toEqual([
      { path: iconFile(512), role: "icon", source: { kind: "blob", sha256: "9".repeat(64) } },
    ]);
    expect(plan.files.some((f) => f.path.startsWith(`assets/${"9".repeat(64)}`))).toBe(false);
  });

  it("draws the defaults as valid palette PNGs, byte for byte the same every time", async () => {
    for (const size of [192, 512] as const) {
      const bytes = defaultIconPng(size);
      expect(defaultIconPng(size)).toEqual(bytes);
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const view = new DataView(bytes.buffer, bytes.byteOffset);
      expect([view.getUint32(16), view.getUint32(20), bytes[24], bytes[25]]).toEqual([
        size,
        size,
        8,
        3,
      ]);
      const chunks = new Map<string, Uint8Array>();
      for (let at = 8; at < bytes.length; ) {
        const length = view.getUint32(at);
        const type = new TextDecoder().decode(bytes.subarray(at + 4, at + 8));
        chunks.set(type, bytes.subarray(at + 8, at + 8 + length));
        at += 12 + length;
      }
      expect([...chunks.keys()]).toEqual(["IHDR", "PLTE", "IDAT", "IEND"]);
      const raw = inflateSync(chunks.get("IDAT")!);
      expect(raw.length).toBe(size * (size + 1));
      const used = new Set<number>();
      for (let y = 0; y < size; y++) {
        expect(raw[y * (size + 1)]).toBe(0);
        for (let x = 1; x <= size; x++) used.add(raw[y * (size + 1) + x]!);
      }
      expect([...used].sort((a, b) => a - b)).toEqual([0, 1]);
      expect(bytes.length).toBeLessThan(size * 40);
    }
    expect(await sha256(defaultIconPng(192))).toBe(DEFAULT_192_SHA);
    expect(await sha256(defaultIconPng(512))).toBe(DEFAULT_512_SHA);
  });
});

const DEFAULT_192_SHA = "c6fb27dec63e07b0d35265d3a0a8515a4efdcac5923b89fcbee214541fa506ee";
const DEFAULT_512_SHA = "c81a988cf3330850c57e52de4cc64f3c6855af499c3eaa30fd31bbfa51e58c8c";

describe("finishExport", () => {
  let input: ExportInput;
  beforeAll(async () => {
    input = await heldInput(FREE_PROJECT, physicsFreeFiles(), testGame);
  });

  it("joins the content and the code into a manifest that holds together", async () => {
    const content = await planContent(input);
    const plan = await finishExport(content, builtCode(), input);
    expect(plan.issues.filter((i) => i.severity === "error")).toEqual([]);
    const m = plan.manifest;
    expect(m.build.rapier).toBeNull();
    expect(m.build.target).toBe("web");
    expect(m.flow.start).toBe("yard");
    expect(m.game).toEqual({ id: testGame.id, configHash: null, saveVersion: null });
    expect(m.engine.formats).toEqual(ENGINE_FORMATS);
    expect(m.credits.code.map((c) => c.package)).toEqual(["pixi.js", "zod"]);
    expect(m.budget.over).toEqual([]);
    expect(m.budget.measured.wasmBytes).toBe(0);
    const paths = m.build.files.map((f) => f.path);
    expect(paths).toEqual([...paths].sort());
    expect(plan.files.map((f) => f.path)).toEqual(paths);
    for (const shell of ["index.html", "credits.html", "sw.js", "app.webmanifest"])
      expect(paths).toContain(shell);
    expect(paths).toContain("icons/icon-192.png");
    expect(paths).toContain("assets/" + "a".repeat(64) + ".png");
    expect(paths.filter((p) => p.startsWith("data/"))).toHaveLength(4);
    expect(m.build.files.find((f) => f.path === "sw.js")?.role).toBe("worker");
    const icon = plan.files.find((f) => f.path === "icons/icon-512.png")!;
    expect(icon.source.kind).toBe("bytes");
    expect(plan.issues.map((i) => i.code).sort()).toEqual(["licence-missing", "scene-unlisted"]);
  });

  it("pins exactly what ships in the manifest's snapshot", async () => {
    const content = await planContent(input);
    const { manifest } = await finishExport(content, builtCode(), input);
    expect(manifest.project.snapshot).not.toBe(input.snapshot.hash);
    const shipped = Object.keys(input.snapshot.assets).filter((id) => id in manifest.assets);
    const pinned = await snapshotProject(
      {
        ...input.view,
        byId: new Map([...input.view.byId].filter(([id]) => shipped.includes(id))),
      },
      input.texts,
      input.view.state.build,
    );
    expect(manifest.project.snapshot).toBe(pinned.hash);
    const fromRelease = releaseSnapshot(manifest);
    for (const id of shipped) expect(fromRelease.assets[id], id).toEqual(pinned.assets[id]);
  });

  it("refuses a shipped blob whose entry records no size, rather than shipping it as 0 bytes", async () => {
    const byId = new Map(input.view.byId);
    const { bytes: _, ...sizeless } = byId.get("rocks")!;
    byId.set("rocks", sizeless);
    const hosted = { ...input, view: { ...input.view, byId } };
    const content = await planContent(hosted);
    expect(content.assets.rocks).toBeUndefined();
    const missing = content.issues.filter((i) => i.code === "asset-missing");
    expect(missing).toEqual([
      expect.objectContaining({
        severity: "error",
        entityIds: ["rocks"],
        got: "rocks",
        message: expect.stringContaining("records no size") as string,
      }),
    ]);
  });

  it("plans no service worker or web manifest with the PWA off", async () => {
    const off = { ...input, project: { ...FREE_PROJECT, export: { pwa: false } } };
    const plan = await finishExport(await planContent(off), builtCode(), off);
    const paths = plan.manifest.build.files.map((f) => f.path);
    expect(paths).not.toContain("sw.js");
    expect(paths).not.toContain("app.webmanifest");
    expect(paths).toContain("icons/icon-192.png");
    expect(plan.manifest.pwa).toBeNull();
    expect(plan.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("measures the budget against the project's override and the caller's", async () => {
    const content = await planContent(input);
    const tight = {
      ...input,
      project: { ...FREE_PROJECT, export: { budget: { codeBytes: 500 } } },
    };
    const over = await finishExport(content, builtCode(), tight);
    expect(over.manifest.budget.limits.codeBytes).toBe(500);
    expect(over.manifest.budget.over).toEqual(["codeBytes"]);
    expect(over.issues.filter((i) => i.code === "export-over-budget")).toHaveLength(1);
    const raised = await finishExport(content, builtCode(), tight, { codeBytes: 5000 });
    expect(raised.manifest.budget.over).toEqual([]);
  });

  it("gives a byte-identical manifest for the same input", async () => {
    const a = await finishExport(await planContent(input), builtCode(), input);
    const again = await heldInput(FREE_PROJECT, physicsFreeFiles(), testGame);
    const b = await finishExport(await planContent(again), builtCode(), again);
    expect(formatReleaseManifest(b.manifest)).toBe(formatReleaseManifest(a.manifest));
    expect(stableJson(b.files.map((f) => [f.path, f.role]))).toBe(
      stableJson(a.files.map((f) => [f.path, f.role])),
    );
  });
});

/** The text a plan writes at `path`. */
const textOf = (plan: ExportPlan, path: string): string => {
  const file = plan.files.find((f) => f.path === path);
  if (file?.source.kind !== "text") throw new Error(`${path} isn't a planned text`);
  return file.source.text;
};

/** Every `href`/`src` attribute value in `html`. */
const urlsIn = (html: string): string[] =>
  [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((match) => match[1]!);

/** Runs `sw.js` against fake `caches` and `fetch` at `scope`, as a browser would. */
function serviceWorkerHarness(text: string, scope: string) {
  const stores = new Map<string, Map<string, string>>();
  const served = new Map<string, string>();
  const net = { online: true, requests: [] as string[] };
  const handlers = new Map<string, (event: unknown) => void>();
  const store = (name: string) => {
    let s = stores.get(name);
    if (!s) stores.set(name, (s = new Map()));
    return s;
  };
  const fakeFetch = async (request: Request | string) => {
    const url = typeof request === "string" ? request : request.url;
    net.requests.push(url);
    if (!net.online) throw new TypeError("offline");
    const body = served.get(url.split("?")[0]!);
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
  };
  const cacheOf = (name: string) => ({
    async addAll(requests: Request[]) {
      for (const request of requests) {
        const response = await fakeFetch(request);
        if (!response.ok) throw new TypeError(`${request.url} ${response.status}`);
        store(name).set(request.url, await response.text());
      }
    },
    async match(key: string) {
      const body = stores.get(name)?.get(key);
      return body === undefined ? undefined : new Response(body);
    },
    async put(key: string, response: Response) {
      store(name).set(key, await response.text());
    },
  });
  const caches = {
    open: async (name: string) => cacheOf(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  let claimed = false;
  const self = {
    location: { href: new URL("sw.js", scope).href },
    clients: { claim: async () => void (claimed = true) },
    addEventListener: (type: string, handler: (event: unknown) => void) =>
      handlers.set(type, handler),
  };
  runInNewContext(text, {
    self,
    caches,
    fetch: fakeFetch,
    Request,
    Response,
    URL,
    Map,
    Set,
    Promise,
  });
  const lifecycle = async (type: "install" | "activate") => {
    let done: Promise<unknown> = Promise.resolve();
    handlers.get(type)!({ waitUntil: (p: Promise<unknown>) => void (done = p) });
    await done;
  };
  /** The response the worker answers `url` with, or null when it leaves it to the network. */
  const request = async (url: string, method = "GET"): Promise<string | null> => {
    let answer = null as Promise<Response> | null;
    handlers.get("fetch")!({
      request: new Request(url, { method }),
      respondWith: (p: Promise<Response>) => void (answer = p),
    });
    if (answer === null) return null;
    const response = await answer;
    return response.type === "error" ? "(error)" : await response.text();
  };
  return { stores, served, net, lifecycle, request, claimed: () => claimed };
}

describe("the shell renderers", () => {
  let input: ExportInput;
  let plan: ExportPlan;
  let m: ReleaseManifest;
  beforeAll(async () => {
    input = await heldInput(FREE_PROJECT, physicsFreeFiles(), testGame);
    plan = await finishExport(await planContent(input), builtCode(), input);
    m = plan.manifest;
  });

  it("writes the page the plan ships from the final manifest", () => {
    const styles = ["code/main-abc123.css"];
    expect(textOf(plan, "index.html")).toBe(renderIndexHtml(m, { styles }));
    expect(textOf(plan, "credits.html")).toBe(renderCredits(m));
    expect(textOf(plan, "sw.js")).toBe(renderServiceWorker(m));
    expect(textOf(plan, "app.webmanifest")).toBe(renderWebManifest(m));
  });

  it("renders index.html with one module script, no inline script and no absolute URL", () => {
    const html = renderIndexHtml(m, { styles: ["code/main-abc123.css"] });
    expect(html).toMatch(/^<!doctype html>\n<html lang="en">/);
    expect(html).toContain("<title>Free</title>");
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('<div id="game"></div>');
    expect(html).toContain('<meta name="theme-color" content="#000000">');
    expect(html).toContain('<link rel="manifest" href="app.webmanifest">');
    expect(html).toContain('<link rel="stylesheet" href="code/main-abc123.css">');
    expect(html).toMatch(/<noscript>Free needs JavaScript to run\.<\/noscript>/);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]![1]).toBe(' type="module" src="code/main-abc123.js"');
    expect(scripts[0]![2]).toBe("");
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).not.toMatch(/<style|\sstyle=/i);
    const urls = urlsIn(html);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url, url).not.toMatch(/^(?:[a-z][a-z0-9+.-]*:|\/)/i);
      expect(m.build.files.map((f) => f.path)).toContain(url);
    }
  });

  it("leaves the web manifest and theme colour out of a build that isn't a PWA", async () => {
    const itch = { ...input, target: "itch" as const };
    const built = await finishExport(await planContent(itch), builtCode(), itch);
    const html = textOf(built, "index.html");
    expect(html).not.toContain('rel="manifest"');
    expect(html).not.toContain("theme-color");
    expect(html).toContain(
      '<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">',
    );
    expect(() => renderWebManifest(built.manifest)).toThrow(/no pwa/);
  });

  it("counts release.json in the itch layout check, as the zip holds it", async () => {
    const itch = { ...input, target: "itch" as const };
    const content = await planContent(itch);
    const first = await finishExport(content, builtCode(), itch);
    const base = builtCode();
    const pad = ITCH_LIMITS.maxFiles - first.manifest.build.files.length;
    const padded: BuiltCode = {
      ...base,
      files: [
        ...base.files,
        ...Array.from({ length: pad }, (_, i) => ({
          path: `code/pad-${String(i).padStart(4, "0")}.js`,
          sha256: "1".repeat(64),
          bytes: 10,
          role: "code" as const,
        })),
      ],
    };
    const built = await finishExport(content, padded, itch);
    expect(built.manifest.build.files).toHaveLength(ITCH_LIMITS.maxFiles);
    const layout = built.issues.filter((i) => i.code === "export-itch-layout");
    expect(layout).toHaveLength(1);
    expect(layout[0]!.got).toBe(String(ITCH_LIMITS.maxFiles + 1));
    expect(built.files.some((f) => f.path === RELEASE_FILE)).toBe(false);
  });

  it("ends the credits page with a link that opens the game", () => {
    expect(renderCredits(m)).toContain('<p><a href="index.html">Play the game</a></p>');
  });

  it("escapes the project's name everywhere it is printed", () => {
    const named = { ...m, project: { ...m.project, name: `<b>"Q&A"</b>` } };
    const escaped = "&lt;b&gt;&quot;Q&amp;A&quot;&lt;/b&gt;";
    expect(renderIndexHtml(named, { styles: [] })).toContain(`<title>${escaped}</title>`);
    expect(renderCredits(named)).toContain(`<h1>${escaped}: credits</h1>`);
    expect(renderCredits(named)).not.toContain("<b>");
  });

  it("renders the web manifest with relative URLs and both icons", () => {
    const doc = JSON.parse(renderWebManifest(m)) as Record<string, unknown>;
    expect(doc).toEqual({
      id: "./",
      name: "Free",
      short_name: "Free",
      start_url: "./",
      scope: "./",
      display: "fullscreen",
      orientation: "any",
      theme_color: "#000000",
      background_color: "#000000",
      icons: [
        { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      ],
    });
  });

  it("gives Chromium what it installs from: a name, a start URL in scope, an app display, 192 and 512 icons", () => {
    const doc = JSON.parse(renderWebManifest(m)) as {
      name: string;
      short_name: string;
      start_url: string;
      scope: string;
      display: string;
      icons: { src: string; sizes: string; type: string }[];
    };
    expect(doc.name.length).toBeGreaterThan(0);
    expect(doc.short_name.length).toBeGreaterThan(0);
    const page = "https://games.test/free/";
    expect(new URL(doc.start_url, page).href.startsWith(new URL(doc.scope, page).href)).toBe(true);
    expect(["fullscreen", "standalone", "minimal-ui"]).toContain(doc.display);
    expect(doc.icons.map((i) => i.sizes)).toEqual(["192x192", "512x512"]);
    const files = new Set(m.build.files.map((f) => f.path));
    for (const icon of doc.icons) {
      expect(icon.type).toBe("image/png");
      expect(files.has(icon.src), icon.src).toBe(true);
    }
    expect(files.has("app.webmanifest")).toBe(true);
    expect(files.has("sw.js")).toBe(true);
  });

  it("names a new cache for a new build or new content, and none another project would delete", () => {
    const rebuilt = { ...m, build: { ...m.build, hash: "9".repeat(64) } };
    const edited = { ...m, project: { ...m.project, snapshot: "8".repeat(64) } };
    const names = [m, rebuilt, edited].map(serviceWorkerCacheName);
    expect(new Set(names).size).toBe(3);
    for (const name of names) expect(name).toMatch(/^jams-free-[0-9a-f]{12}-[0-9a-f]{12}$/);
    const other = { ...m, project: { ...m.project, id: "free-x" } };
    expect(serviceWorkerCacheName(other).startsWith("jams-free-")).toBe(true);
    expect(serviceWorkerCacheName(other).slice("jams-free-".length)).not.toMatch(
      /^[0-9a-f]{12}-[0-9a-f]{12}$/,
    );
  });

  it("names the worker's cache by the build and the snapshot", () => {
    expect(serviceWorkerCacheName(m)).toBe(
      `jams-free-${m.build.hash.slice(0, 12)}-${m.project.snapshot.slice(0, 12)}`,
    );
    expect(renderServiceWorker(m)).toContain(JSON.stringify(serviceWorkerCacheName(m)));
  });

  it("precaches every build file and release.json, and deletes only this project's other caches", async () => {
    const scope = "https://games.test/free/";
    const sw = serviceWorkerHarness(renderServiceWorker(m), scope);
    const paths = [...m.build.files.map((f) => f.path), "release.json"].sort();
    for (const path of paths) sw.served.set(scope + path, `body of ${path}`);
    sw.stores.set("jams-free-000000000000-111111111111", new Map());
    sw.stores.set("jams-other-aaaaaaaaaaaa-bbbbbbbbbbbb", new Map());
    sw.stores.set("jams-free-x-aaaaaaaaaaaa-bbbbbbbbbbbb", new Map());
    sw.stores.set("unrelated", new Map());
    await sw.lifecycle("install");
    const own = sw.stores.get(serviceWorkerCacheName(m))!;
    expect([...own.keys()]).toEqual(paths.map((p) => scope + p));
    await sw.lifecycle("activate");
    expect([...sw.stores.keys()].sort()).toEqual(
      [
        serviceWorkerCacheName(m),
        "jams-free-x-aaaaaaaaaaaa-bbbbbbbbbbbb",
        "jams-other-aaaaaaaaaaaa-bbbbbbbbbbbb",
        "unrelated",
      ].sort(),
    );
    expect(sw.claimed()).toBe(true);
  });

  it("serves hashed files cache first and the shell network first, from the cache when offline", async () => {
    const scope = "https://games.test/free/";
    const sw = serviceWorkerHarness(renderServiceWorker(m), scope);
    for (const path of [...m.build.files.map((f) => f.path), "release.json"])
      sw.served.set(scope + path, `v1 ${path}`);
    await sw.lifecycle("install");
    for (const path of [...m.build.files.map((f) => f.path), "release.json"])
      sw.served.set(scope + path, `v2 ${path}`);
    sw.served.set(scope, "v2 index.html");

    sw.net.requests.length = 0;
    expect(await sw.request(scope + "code/main-abc123.js")).toBe("v1 code/main-abc123.js");
    expect(await sw.request(scope + "icons/icon-192.png")).toBe("v1 icons/icon-192.png");
    expect(sw.net.requests).toEqual([]);
    for (const shell of ["index.html", "credits.html", "sw.js", "app.webmanifest", "release.json"])
      expect(await sw.request(scope + shell), shell).toBe(`v2 ${shell}`);
    expect(await sw.request(scope + "?renderer=webgl")).toBe("v2 index.html");

    sw.net.online = false;
    expect(await sw.request(scope + "release.json")).toBe("v1 release.json");
    expect(await sw.request(scope + "index.html?renderer=webgl")).toBe("v1 index.html");
    expect(await sw.request(scope)).toBe("v1 index.html");
    expect(await sw.request(scope + "data/" + "a".repeat(64) + ".json")).toBeNull();
    expect(await sw.request("https://elsewhere.test/x.js")).toBeNull();
    expect(await sw.request(scope + "release.json", "POST")).toBeNull();
  });

  it("prints the credits page's sections, with no script", async () => {
    const credited = {
      ...m,
      credits: {
        ...m.credits,
        assets: [
          {
            assets: ["tiles"],
            spdx: "CC-BY-4.0",
            author: "Ada",
            source: "https://art.test/tiles",
            attribution: "Tiles by Ada, CC BY 4.0",
          },
        ],
      },
    };
    const html = renderCredits(credited);
    expect(html).toMatch(/^<!doctype html>\n<html lang="en">/);
    expect(html).toContain("<title>Free: credits</title>");
    expect(html).not.toMatch(/<script|\son[a-z]+=|<style|\sstyle=/i);
    expect(html).toContain("<p>Tiles by Ada, CC BY 4.0</p>");
    expect(html).toContain("<dt>Author</dt><dd>Ada</dd>");
    expect(html).toContain(
      '<dt>Source</dt><dd><a href="https://art.test/tiles" rel="noreferrer">https://art.test/tiles</a></dd>',
    );
    expect(html).toContain("<dt>Licence</dt><dd>CC-BY-4.0</dd>");
    expect(html).toContain("<li>art/tiles.png</li>");
    const missing = html.slice(html.indexOf("<h2>No licence recorded</h2>"));
    expect(m.credits.missing).toEqual(["rocks"]);
    expect(missing).toContain("<li>art/rocks.png</li>");
    expect(html).toContain("<h3>pixi.js 8.0.0</h3>");
    expect(html).toContain("<p>The package ships no licence file.</p>");
    expect(html).toContain("<h3>zod 4.0.0</h3>");
    expect(html).toContain(
      "<details><summary>Licence notice</summary><pre>MIT License</pre></details>",
    );
    expect(html.indexOf("<h3>pixi.js")).toBeLessThan(html.indexOf("<h3>zod"));
    expect(html).toContain(`<p>Made with @jams/engine ${m.engine.version}</p>`);
    const order = ["<h2>Assets</h2>", "<h2>No licence recorded</h2>", "<h2>Code</h2>", "Made with"];
    const at = order.map((s) => html.indexOf(s));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(at.every((i) => i >= 0)).toBe(true);
    for (const url of urlsIn(html).filter((u) => !u.startsWith("https://art.test/")))
      expect(url).not.toMatch(/^(?:[a-z][a-z0-9+.-]*:|\/)/i);
  });

  it("renders the same text for the same manifest", async () => {
    const again = await heldInput(FREE_PROJECT, physicsFreeFiles(), testGame);
    const b = await finishExport(await planContent(again), builtCode(), again);
    for (const path of ["index.html", "credits.html", "sw.js", "app.webmanifest"])
      expect(textOf(b, path), path).toBe(textOf(plan, path));
  });
});
