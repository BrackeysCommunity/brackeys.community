/**
 * The release smoke test: pack `@jams/engine`, install the tarball into a
 * directory outside the repo, and use it the way an outside host would.
 *
 *   vp run engine:smoke [--keep]
 *
 * 1. The tarball holds exactly the published files, and every export resolves.
 * 2. The entries that must load without a DOM or Pixi don't reach them, and
 *    only `./editor-ui` reaches React and the editor's libraries.
 * 3. Under Bun, `dist/headless` with `-compat` Rapier gives the same probe
 *    and playtest reports as the source build, the playtest wins, and its
 *    recording replays to the same end.
 * 4. Under Bun, `./vite` loads and the schema files resolve by export.
 * 5. A jsdom vitest drives `dist` with standard Rapier (`consumer.test.ts`),
 *    and mounts the packed editor UI on `./vite`'s dev server over a scratch
 *    copy of the engine project (`editor-consumer.test.tsx`).
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, relative } from "node:path";

import { copyInto, ENGINE, packAndExtract, REPO, run, type PackageJson } from "./pack";

const keep = process.argv.includes("--keep");
const failures: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) failures.push(message);
};

const SCENE = join(ENGINE, "scenes/engine-yard.json");
const INPUTS = join(ENGINE, "__tests__/fixtures/parity-inputs.json");

const packed = packAndExtract([
  "vite-plus",
  "vite-plugin-wasm",
  "jsdom",
  "@testing-library/react",
  "@testing-library/dom",
]);
const { dir, pkgDir, pkg, files } = packed;
console.log(`packed ${pkg.name}@${pkg.version} into ${dir}`);

try {
  // ─── 1. Tarball contents and exports ───────────────────
  for (const required of ["package.json", "README.md", "CHANGELOG.md"]) {
    check(files.includes(required), `the tarball has no ${required}`);
  }
  const stray = files.filter(
    (f) =>
      !f.startsWith("dist/") &&
      !/^scene\/[a-z-]+\.schema\.json$/.test(f) &&
      !/^project\/[a-z-]+\.schema\.json$/.test(f) &&
      !["package.json", "README.md", "CHANGELOG.md", "editor-ui/style.css"].includes(f),
  );
  check(
    stray.length === 0,
    `the tarball has files outside dist, the schemas and the stylesheet: ${stray.join(", ")}`,
  );
  const sources = files.filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.mts"));
  check(sources.length === 0, `the tarball has TypeScript sources: ${sources.join(", ")}`);

  for (const [entry, target] of Object.entries(pkg.exports)) {
    const paths = typeof target === "string" ? [target] : [target.types, target.import];
    for (const p of paths) {
      check(existsSync(join(pkgDir, p)), `export ${entry} points at a missing ${p}`);
    }
  }

  // ─── 2. What each entry may reach ──────────────────────
  const reach = (entry: string) => reachableSpecifiers(join(pkgDir, "dist", `${entry}.mjs`));
  const forbid = (entry: string, specs: string[], why: string) => {
    const bad = [...reach(entry)].filter((s) => specs.includes(s));
    check(bad.length === 0, `dist/${entry}.mjs reaches ${bad.join(", ")} (${why})`);
  };
  forbid("index", ["@dimforge/rapier2d", "@dimforge/rapier2d-compat"], "Rapier is injected");
  forbid("scene", ["pixi.js", "@tanstack/store", "yjs"], "./scene loads on a server");
  forbid("headless", ["pixi.js", "@tanstack/store"], "./headless is DOM- and Pixi-free");
  forbid("collab", ["pixi.js", "@tanstack/store", "@hocuspocus/server"], "./collab is pure");
  const project = [...reach("project")].filter((s) => s !== "zod");
  check(
    project.length === 0,
    `dist/project.mjs reaches ${project.join(", ")} (./project needs only zod)`,
  );
  const simKit = [...reach("sim-kit")];
  check(
    simKit.length === 0,
    `dist/sim-kit.mjs reaches ${simKit.join(", ")} (./sim-kit has no dependencies)`,
  );
  const editorUiLib = /^(react|react-dom|@base-ui\/react|@dnd-kit\/core|@hugeicons\/[a-z-]+)(\/|$)/;
  const builtEntries = Object.values(pkg.exports).flatMap((target) => {
    const built =
      typeof target === "string" ? null : /^\.\/dist\/([a-z-]+)\.mjs$/.exec(target.import);
    return built?.[1] ? [built[1]] : [];
  });
  check(builtEntries.includes("editor-ui"), "package.json exports no ./editor-ui entry");
  for (const entry of builtEntries) {
    if (entry === "editor-ui") continue;
    if (entry !== "vite")
      forbid(entry, ["@hocuspocus/server"], "only ./vite may load the dev server");
    const ui = [...reach(entry)].filter((s) => editorUiLib.test(s));
    check(
      ui.length === 0,
      `dist/${entry}.mjs reaches ${ui.join(", ")} (only ./editor-ui uses React and its libraries)`,
    );
  }
  forbid(
    "editor-ui",
    ["@hocuspocus/server", "@hocuspocus/provider"],
    "the host passes the provider module in, and the dev server is ./vite's",
  );
  const editorUiNode = [...reach("editor-ui")].filter((s) => s.startsWith("node:"));
  check(
    editorUiNode.length === 0,
    `dist/editor-ui.mjs reaches ${editorUiNode.join(", ")} (the editor UI runs in a browser)`,
  );

  // ─── 3. Headless under Bun: dist matches source ────────
  copyInto(dir, {
    "browser/contact.ts": "scripts/engine-smoke/browser/contact.ts",
    "game.ts": "scripts/engine-smoke/game.ts",
    "headless.ts": "scripts/engine-smoke/headless.ts",
    "consumer.test.ts": "scripts/engine-smoke/consumer.test.ts",
    "editor-consumer.test.tsx": "scripts/engine-smoke/editor-consumer.test.tsx",
    "engine-yard.json": relative(REPO, SCENE),
    "engine-project": relative(REPO, join(ENGINE, "scenes")),
  });
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(consumerPackage(pkg), null, 2)}\n`);

  const fromDist = run("bun", ["headless.ts", SCENE, INPUTS], { cwd: dir });
  const fromSource = run("bun", ["scripts/engine-smoke/headless.ts", SCENE, INPUTS], { cwd: REPO });
  const dist = JSON.parse(fromDist) as {
    probe: { ticks: number; events: unknown[] };
    playtest: { blocked: boolean; outcome?: { result: string } };
    replay: { blocked: boolean; matches?: boolean; divergence?: string | null } | null;
  };
  check(dist.probe.ticks === 600, `dist/headless ran ${dist.probe.ticks} ticks, not 600`);
  check(dist.probe.events.length > 0, "dist/headless reported no events");
  check(
    !dist.playtest.blocked && dist.playtest.outcome?.result === "won",
    `dist/headless's playtest didn't win: ${JSON.stringify(dist.playtest.outcome ?? dist.playtest)}`,
  );
  check(
    dist.replay?.blocked === false && dist.replay.matches === true,
    `dist/headless's replay of the playtest's recording didn't match: ${JSON.stringify(dist.replay)}`,
  );
  check(fromDist === fromSource, "dist/headless's reports differ from the source build's");

  // ─── 4. ./vite and the schema files under Bun ──────────
  const probe = `
    const vite = await import("@jams/engine/vite");
    if (typeof vite.sceneCollabServer !== "function") throw new Error("no sceneCollabServer");
    for (const name of [
      "scene",
      "ops",
      "input-script",
      "recording",
      "project",
      "asset-sidecar",
      "project-ops",
      "material",
      "game-settings",
      "input-map",
      "data-table",
      "project-snapshot",
    ]) {
      const url = import.meta.resolve("@jams/engine/schemas/" + name + ".schema.json");
      const schema = await Bun.file(new URL(url)).json();
      if (!String(schema.$id).startsWith("urn:jams-engine:")) throw new Error(name + " has no $id");
    }
  `;
  writeFileSync(join(dir, "exports-probe.ts"), probe);
  run("bun", ["exports-probe.ts"], { cwd: dir });

  // ─── 5. The jsdom consumer ─────────────────────────────
  // The jsdom page and the editor's dev server share this origin, as an editor page served by it would.
  const collabPort = await freePort();
  writeFileSync(join(dir, "vite.config.ts"), consumerViteConfig(collabPort));
  // vite logs a missing source map for every Rapier file, so the output shows only on failure.
  const vitest = run("vp", ["test", "run"], {
    cwd: dir,
    env: {
      ...process.env,
      NODE_OPTIONS: "--no-experimental-webstorage",
      SMOKE_COLLAB_PORT: String(collabPort),
    },
  });
  console.log(vitest.match(/^\s*Tests\s+.*$/m)?.[0]?.trim() ?? "the jsdom consumers passed");
} catch (err) {
  failures.push(err instanceof Error ? err.message : String(err));
} finally {
  if (keep) console.log(`kept ${dir}`);
  else rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\nengine smoke failed:\n${failures.map((f) => `- ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(`engine smoke passed (${files.length} files in the tarball)`);

// ─── Helpers ─────────────────────────────────────────────

/** Every bare specifier a built module reaches, statically or by `import()`, through its relative imports. */
function reachableSpecifiers(entry: string): Set<string> {
  const bare = new Set<string>();
  const seen = new Set<string>();
  const queue = [entry];
  // No whitespace or `$` in a specifier and matching quotes around it, so message text like
  // `from "${a.path}"` or `the import's."` never matches.
  const pattern = /(?<![\w$."'])(?:from\s*|import\s*\(?\s*)(["'])([^"'\s$]+)\1/g;
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, , spec] of readFileSync(file, "utf8").matchAll(pattern)) {
      if (spec!.startsWith(".")) queue.push(join(dirname(file), spec!));
      else bare.add(spec!);
    }
  }
  return bare;
}

function consumerPackage(pkg: PackageJson) {
  return {
    name: "jams-engine-smoke-consumer",
    private: true,
    type: "module",
    dependencies: { [pkg.name]: pkg.version },
  };
}

/** A port nothing listens on, for the editor consumer's dev server. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no free port")),
      );
    });
  });
}

function consumerViteConfig(collabPort: number): string {
  // Standard Rapier needs the wasm plugin and its `rapier.js` entry under vitest,
  // as in the repo's own config; the engine is inlined so `vi.mock("pixi.js")`
  // reaches the imports inside `dist`.
  const rapierJs = join(REPO, "node_modules/@dimforge/rapier2d/rapier.js");
  return `import wasm from "vite-plugin-wasm";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [wasm()],
  resolve: { alias: [{ find: /^@dimforge\\/rapier2d$/, replacement: ${JSON.stringify(rapierJs)} }] },
  test: {
    include: ["consumer.test.ts", "editor-consumer.test.tsx"],
    environmentOptions: { jsdom: { url: "http://127.0.0.1:${collabPort}/" } },
    server: { deps: { inline: [/@jams\\/engine/] } },
  },
});
`;
}
