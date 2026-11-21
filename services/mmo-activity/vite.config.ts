import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";
import { defineConfig } from "vite-plus";

const world = fileURLToPath(new URL("../mmo-world/", import.meta.url));
const packDir = `${world}packs/wasteland/`;
const goldenDir = `${world}sim/puzzle/testdata/golden/`;
const sheetsDir = `${world}sheets/`;

// The sheets of the pack's names the Activity shows.
const NAMED = [
  "creatures.archetypes",
  "fights.beats",
  "fights.options",
  "fights.states",
  "items.materials",
  "map.terrain",
  "puzzles.families",
  "puzzles.titles",
];

function json(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * The setting is a pack, so its colours and names are read from it when the
 * Activity is built, never typed here. `virtual:rigs` is the golden layouts
 * with their traces dropped, for the mock gateway; it is empty where the
 * vectors are not checked out beside the build. `virtual:puzzle-sheet` is
 * the few cells the mock plays by, read from the world's sheets.
 */
function pack(): Plugin {
  const modules: Record<string, () => string> = {
    "virtual:pack": () => {
      const palette: Record<string, string> = {};
      for (const row of json(`${packDir}palette.json`).rows) palette[row.id] = row.hex;
      const names: Record<string, string> = {};
      if (!existsSync(`${packDir}names.json`))
        throw new Error(
          "the Activity names creatures, options and goods from the pack: services/mmo-world/packs/wasteland/names.json must sit beside palette.json when it is built",
        );
      for (const row of json(`${packDir}names.json`).rows)
        if (NAMED.includes(String(row.ref).split(":")[0]!)) names[row.ref] = row.name;
      return `export const palette = ${JSON.stringify(palette)};\nexport const names = ${JSON.stringify(names)};\n`;
    },
    "virtual:rigs": () => {
      const rigs: Record<string, unknown[]> = {};
      const files = existsSync(goldenDir) ? readdirSync(goldenDir) : [];
      for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
        const golden = json(goldenDir + file);
        rigs[golden.family] = golden.cases.map((c: any) => {
          const { level, tier, ...layout } = c.layout;
          const { level: _l, tier: _t, ...inner } = c.inner;
          const solve = c.logs.find((l: any) => l.name === "solve");
          return {
            level,
            tier,
            compact: Boolean(c.spec.compact),
            countdown: c.countdown,
            layout,
            inner,
            hints: solve.log.moves.slice(0, 3),
          };
        });
      }
      return `export default ${JSON.stringify(rigs)};\n`;
    },
    "virtual:puzzle-sheet": () => {
      const cell = (file: string, id: string): number => {
        const row = json(sheetsDir + file).rows.find((r: any) => r.id === id);
        if (row === undefined) throw new Error(`${file} has no row ${id}`);
        return row.value;
      };
      const sheet = {
        grace: cell("puzzles/params.json", "network-grace") * 1000,
        cleanPct: cell("puzzles/params.json", "clean-solve-left"),
        maxPlay: cell("puzzles/params.json", "max-play-seconds") * 1000,
        practiceUses: cell("growth/params.json", "practice-uses"),
        practiceMax: cell("growth/params.json", "practice-max"),
        gifts: json(`${sheetsDir}puzzles/practice.json`).rows.map((r: any) => ({
          practice: r.practice,
          gives: r.gives,
        })),
      };
      return `export default ${JSON.stringify(sheet)};\n`;
    },
  };
  return {
    name: "mmo-pack",
    resolveId(id) {
      return id in modules ? `\0${id}` : undefined;
    },
    load(id) {
      const make = id.startsWith("\0") ? modules[id.slice(1)] : undefined;
      return make?.();
    },
  };
}

export default defineConfig({
  // Discord serves the build under /.proxy, so every asset URL is relative.
  base: "./",
  plugins: [pack()],
  build: {
    target: "es2022",
    outDir: "dist",
  },

  // The root's fmt block, so `vp check` here and at the root agree.
  fmt: {
    tabWidth: 2,
    semi: true,
    printWidth: 100,
    singleQuote: false,
    endOfLine: "lf",
    trailingComma: "all",
    sortImports: {},
    sortTailwindcss: {
      stylesheet: "./src/styles.css",
      attributes: ["class", "className"],
      functions: ["clsx", "cn", "cva", "tw"],
    },
    sortPackageJson: true,
    ignorePatterns: [
      "bun.lock",
      "routeTree.gen.ts",
      ".tanstack-start/",
      ".tanstack/",
      "drizzle/",
      ".drizzle/",
      ".cache",
      ".output",
      "dist",
      "node_modules",
    ],
  },

  lint: {
    plugins: ["typescript"],
    env: {
      builtin: true,
      node: true,
      browser: true,
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "no-deprecated": "warn",
      "typescript/no-floating-promises": "off",
    },
    ignorePatterns: ["dist", "node_modules"],
  },

  test: {
    include: ["test/**/*.test.ts", "src/scenes/**/*.test.ts"],
    environment: "node",
  },
});
