// @vitest-environment node
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { platformerGame } from "../../../src/games/platformer";
import { COMMAND_GROUPS, COMMANDS, runCli, type CommandName } from "../commands";
import type { ToolContext } from "../context";
import { loadCompatRapier } from "../rapier-compat";
import { tempProject } from "./fixtures";

const repoFile = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

/** Tracked documents whose scene commands are checked. */
const DOCS = ["scripts/scene/README.md"];

const INVOCATION = /(?:vp run scene|bun scripts\/scene\/cli\.ts) ([^`\n]+)/g;

type Example = { doc: string; line: string; fenced: boolean; argv: string[] };

/** Every scene command in a document: fenced `sh`/`bash` lines, and inline code spans. */
function examples(doc: string, text: string): Example[] {
  const out: Example[] = [];
  const fences = [...text.matchAll(/^```(?:sh|bash)\n([\s\S]*?)^```/gm)];
  for (const block of fences) {
    for (const line of block[1]!.split("\n")) {
      const m = /^(?:vp run scene|bun scripts\/scene\/cli\.ts) (.+)$/.exec(line.trim());
      if (!m) continue;
      out.push({ doc, line: line.trim(), fenced: true, argv: m[1]!.trim().split(/\s+/) });
    }
  }
  const prose = text.replace(/^```[\s\S]*?^```/gm, "");
  for (const [, span] of prose.matchAll(/`([^`]+)`/g)) {
    const invocations = [...span!.matchAll(INVOCATION)].map((m) => m[1]!);
    // Bare spans such as `scene diff`, `apply --dry-run` and `assets list`.
    const bare = /^(?:scene )?([a-z]+(?: [a-z][a-z-]*)?)((?: --[a-z-]+(?: [^-\s][^\s]*)?)*)$/.exec(
      span!,
    );
    if (invocations.length === 0 && bare && Object.hasOwn(COMMANDS, bare[1]!))
      invocations.push(`${bare[1]}${bare[2]}`);
    for (const inv of invocations)
      out.push({ doc, line: inv, fenced: false, argv: inv.trim().split(/\s+/) });
  }
  return out;
}

/** A command's name and the arguments after it: `assets import x` is `assets import`, then `x`. */
function split(argv: readonly string[]): [string | undefined, string[]] {
  const [first, second, ...more] = argv;
  if (first && second && (COMMAND_GROUPS as readonly string[]).includes(first))
    return [`${first} ${second}`, more];
  return [first, argv.slice(1)];
}

/** Commands that write nothing and need no dev server, as invoked. */
function isPure(argv: string[]): boolean {
  const [name, rest] = split(argv);
  if (rest.includes("--live") || name === "project pull" || name === "project push") return false;
  if (name === "fmt") return rest.includes("--check");
  if (name === "apply" || name?.startsWith("assets "))
    return name === "assets list" || rest.includes("--dry-run");
  if (name === "render") return !rest.includes("--out");
  if (name === "project snapshot") return !rest.includes("--out") || rest.includes("-");
  return name !== "new";
}

const placeholder = (arg: string) => arg.startsWith("<") || arg.includes("...");

/** A recording a doc example writes and the next one reads, kept in the scratch root, not the repo. */
const SCRATCH_FLAGS = new Set(["--record", "--run"]);
const inRoot = (argv: readonly string[]) =>
  argv.map((arg, i) => (i > 0 && SCRATCH_FLAGS.has(argv[i - 1]!) ? join(root, arg) : arg));

let root: string;
let ctx: ToolContext;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-readme-"));
  const dirs = { engine: join(root, "engine"), platformer: join(root, "platformer") };
  await mkdir(dirs.engine);
  await mkdir(dirs.platformer);
  await copyFile(
    repoFile("src/engine/scenes/engine-yard.json"),
    join(dirs.engine, "engine-yard.json"),
  );
  await copyFile(
    repoFile("src/engine/scenes/engine-yard.checks.json"),
    join(dirs.engine, "engine-yard.checks.json"),
  );
  await copyFile(
    repoFile("src/games/platformer/scenes/test-yard.json"),
    join(dirs.platformer, "test-yard.json"),
  );
  ctx = {
    projects: [
      await tempProject(dirs.engine, { id: "engine" }),
      await tempProject(dirs.platformer, { game: platformerGame }),
    ],
    loadRapier: loadCompatRapier,
  };
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const all = await Promise.all(
  DOCS.map(async (doc) => examples(doc, await readFile(repoFile(doc), "utf8"))),
);

describe("scene commands in the docs", () => {
  it("finds the README's fenced examples and its inline commands", () => {
    const [readme] = all;
    expect(readme!.filter((e) => e.fenced).length).toBeGreaterThan(10);
    expect(readme!.filter((e) => !e.fenced).length).toBeGreaterThan(0);
  });

  for (const example of all.flat()) {
    const [name, rest] = split(example.argv);
    if (!name || placeholder(name)) continue;

    it(`${example.doc}: ${example.line} names a real command and real flags`, () => {
      expect(Object.hasOwn(COMMANDS, name), `unknown command ${name}`).toBe(true);
      const command: { values: readonly string[]; switches: readonly string[] } =
        COMMANDS[name as CommandName];
      for (const arg of rest.filter((a) => a.startsWith("--"))) {
        const flag = arg.slice(2).split("=")[0]!;
        expect(
          flag === "json" || command.values.includes(flag) || command.switches.includes(flag),
          `${name} has no flag --${flag}`,
        ).toBe(true);
      }
    });

    if (example.fenced && isPure(example.argv) && !example.argv.some(placeholder)) {
      it(`${example.doc}: ${example.line} runs`, async () => {
        const r = await runCli(inRoot(example.argv), ctx);
        expect(r.exitCode, `${example.line}\n${r.stderr}`).toBe(0);
      });
    }
  }
});
