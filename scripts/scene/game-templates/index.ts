import { dirname, join, relative, sep } from "node:path";

import type { TimeKind } from "@jams/engine/game";

import { actionsFile, indexFile, playFile, templateFile, typesFile } from "./game";
import { gameSettingsFile, inputMapFile, projectFile, sceneListFile } from "./project";
import { runtimeFile } from "./runtime";
import { checksFile, scriptFile, sceneTemplateOf } from "./scene";
import { testFile } from "./tests";
import { hudFile, uiIndexFile } from "./ui";

export const GAME_PRESETS = ["top-down", "grid", "turns"] as const;
export type GamePreset = (typeof GAME_PRESETS)[number];

/** The world grid a game declares: square or hex cells `cell` metres across. */
export type GameGrid = { kind: "square" | "hex"; cell: number };

/** Every choice a scaffolded game writes out, flags applied over its preset. */
export type GameOptions = {
  id: string;
  name: string;
  preset: GamePreset;
  physics: "none" | "rapier";
  /** m/s²; y is down. */
  gravity: [number, number];
  time: { kind: TimeKind; rate: number };
  grid: GameGrid | null;
  /** px per metre (`world.lengthUnit`). */
  lengthUnit: number;
};

/** What each preset writes before flags override it. */
export const PRESET_OPTIONS: Readonly<Record<GamePreset, Omit<GameOptions, "id" | "name">>> = {
  "top-down": {
    preset: "top-down",
    physics: "none",
    gravity: [0, 0],
    time: { kind: "fixed", rate: 60 },
    grid: null,
    lengthUnit: 100,
  },
  grid: {
    preset: "grid",
    physics: "none",
    gravity: [0, 0],
    time: { kind: "event", rate: 60 },
    grid: { kind: "square", cell: 1 },
    lengthUnit: 32,
  },
  turns: {
    preset: "turns",
    physics: "none",
    gravity: [0, 0],
    time: { kind: "turns", rate: 60 },
    grid: { kind: "square", cell: 1 },
    lengthUnit: 32,
  },
};

/** One file of a scaffolded game: its path inside the project directory, `/`-separated, and its text. */
export type GameFile = { path: string; text: string };

/** The names a game's code uses, derived from its id. */
export type GameNames = {
  id: string;
  /** `myGame` for `my-game`; an id starting with a digit gets a `game` prefix. */
  camel: string;
  /** `MyGame`. */
  pascal: string;
  /** `MY_GAME`. */
  constant: string;
  /** The game module's export, `myGameGame`. */
  gameExport: string;
  /** The UI module's export, `mountMyGameHud`. */
  hudExport: string;
};

export function gameNames(id: string): GameNames {
  const words = id.split("-").filter((w) => w.length > 0);
  if (/^[0-9]/.test(words[0] ?? "")) words.unshift("game");
  const pascal = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);
  return {
    id,
    camel,
    pascal,
    constant: words.map((w) => w.toUpperCase()).join("_"),
    gameExport: `${camel}Game`,
    hudExport: `mount${pascal}Hud`,
  };
}

/** `My Game` for `my-game`. */
export const titleOf = (id: string): string =>
  id
    .split("-")
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** The repo's print width, which a generated line stays within. */
const PRINT_WIDTH = 100;

/**
 * An import as `vp fmt` writes it: on one line when it fits, else one
 * specifier per line. `specifiers` are in the order the file wants them.
 */
export function importLine(
  specifiers: readonly string[],
  from: string,
  typeOnly = false,
): string[] {
  const head = typeOnly ? "import type" : "import";
  const one = `${head} { ${specifiers.join(", ")} } from ${JSON.stringify(from)};`;
  if (one.length <= PRINT_WIDTH) return [one];
  return [`${head} {`, ...specifiers.map((s) => `  ${s},`), `} from ${JSON.stringify(from)};`];
}

const isPrimitive = (v: unknown) => v === null || typeof v !== "object";

/** `value` printed at `indent`, starting `used` columns into its line, with `tail` columns after it. */
function printJson(value: unknown, indent: string, used: number, tail: number): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every(isPrimitive)) {
      const one = `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
      if (used + one.length + tail <= PRINT_WIDTH) return one;
    }
    const items = value.map((v, i) =>
      printJson(v, inner, inner.length, i < value.length - 1 ? 1 : 0),
    );
    return `[\n${items.map((t) => inner + t).join(",\n")}\n${indent}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const lines = entries.map(([k, v], i) => {
      const head = `${inner}${JSON.stringify(k)}: `;
      return head + printJson(v, inner, head.length, i < entries.length - 1 ? 1 : 0);
    });
    return `{\n${lines.join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/**
 * A generated JSON file (a schema) as \`vp fmt\` leaves \`JSON.stringify(value,
 * null, 2)\`: objects one key per line, an array of plain values on one line
 * when it fits the print width.
 */
export const generatedJson = (value: unknown): string => `${printJson(value, "", 0, 0)}\n`;

/** Where the written files point their `$schema`s: the engine's schema directory. */
export type RenderPaths = {
  /** The project's directory, absolute. */
  projectDir: string;
  /** `packages/engine`, absolute. */
  engineDir: string;
};

/** `to` relative to the directory of `from` (both absolute), `/`-separated. */
export function relativeTo(from: string, to: string): string {
  return relative(dirname(from), to).split(sep).join("/");
}

/** The files generated from the game's registry, which only an import of the written module can give. */
export const GENERATED_FILES = [
  "scene.schema.json",
  "input-script.schema.json",
  "scenes/main.json",
];

/**
 * Every file of the game except `GENERATED_FILES`, sorted by path: the
 * project file, the game and UI modules, the scene's checks and its winning
 * input script, the scene list, the game-settings and input-map docs, and the test.
 */
export function renderSources(options: GameOptions, paths: RenderPaths): GameFile[] {
  const names = gameNames(options.id);
  const schema = (path: string, file: string) =>
    relativeTo(join(paths.projectDir, path), join(paths.engineDir, file));
  const files: GameFile[] = [
    {
      path: "jams.project.json",
      text: projectFile(options, names, schema("jams.project.json", "project/project.schema.json")),
    },
    {
      path: "game-settings.json",
      text: gameSettingsFile(schema("game-settings.json", "project/game-settings.schema.json")),
    },
    {
      path: "input-map.json",
      text: inputMapFile(schema("input-map.json", "project/input-map.schema.json")),
    },
    {
      path: "scene-list.json",
      text: sceneListFile(schema("scene-list.json", "project/scene-list.schema.json")),
    },
    { path: "index.ts", text: indexFile(options, names) },
    { path: "types.ts", text: typesFile(options, names) },
    { path: "actions.ts", text: actionsFile(options) },
    { path: "runtime.ts", text: runtimeFile(options) },
    { path: "play.ts", text: playFile(options) },
    { path: "template.ts", text: templateFile(sceneTemplateOf(options)) },
    { path: "ui/index.ts", text: uiIndexFile(names) },
    { path: "ui/hud.ts", text: hudFile(options) },
    { path: "scenes/main.checks.json", text: checksFile(options) },
    { path: "scenes/main.script.json", text: scriptFile(options, names) },
    { path: "__tests__/game.test.ts", text: testFile(options, names) },
  ];
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
