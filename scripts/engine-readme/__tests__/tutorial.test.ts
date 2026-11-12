// @vitest-environment node
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { runCli } from "../../scene/commands";
import type { ToolContext } from "../../scene/context";
import { DEFAULT_PROJECT_GLOBS, discoverProjects } from "../../scene/projects";
import { loadCompatRapier } from "../../scene/rapier-compat";
import { GAME_NEW_STAGE } from "../../scene/tools/game-new";

/**
 * Runs the engine README's "Your first game" in a temporary project: every
 * `sh` block in order, each `vp run scene` line through the CLI with the
 * temporary directory as the working directory and its projects as the
 * only ones, failing on a non-zero exit. Blocks marked `sh browser` (the
 * dev server, the static server) are skipped; the export smoke covers what
 * they show.
 */

const README = fileURLToPath(new URL("../../../packages/engine/README.md", import.meta.url));
/** Inside the repo, so the generated game's imports resolve; under node_modules, so git never sees it. */
const ROOT = join(GAME_NEW_STAGE, `tutorial-${process.pid}-${Date.now()}`);
const INVOCATION = /^vp run scene (.+)$/;
/** One CLI command that writes or plays a small scene. */
const COMMAND_MS = 120_000;
/** A build packs the engine first when its `dist/` is stale (up to 10 minutes), then runs Vite. */
const BUILD_MS = 900_000;

type Command = { line: string; argv: string[]; stdin: string | null };
type Block = { browser: boolean; commands: Command[]; text: string };

function section(readme: string): string {
  const start = readme.indexOf("\n## Your first game\n");
  if (start === -1) throw new Error("the README has no ## Your first game");
  const end = readme.indexOf("\n## ", start + 1);
  return readme.slice(start, end === -1 ? undefined : end);
}

/** Words as a shell splits a line with no expansions: whitespace-separated, single quotes stripped. */
const shellWords = (line: string): string[] =>
  [...line.matchAll(/'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2]!);

/** A block's commands, each line one command; `<<'EOF'` hands the lines up to `EOF` to its stdin. */
function commands(body: string): Command[] {
  const lines = body.split("\n");
  const out: Command[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "") continue;
    const heredoc = /\s<<'(\w+)'$/.exec(line);
    const command = heredoc ? line.slice(0, heredoc.index) : line;
    let stdin: string | null = null;
    if (heredoc) {
      const close = lines.indexOf(heredoc[1]!, i + 1);
      if (close === -1) throw new Error(`no ${heredoc[1]} closes the heredoc of: ${line}`);
      stdin = `${lines.slice(i + 1, close).join("\n")}\n`;
      i = close;
    }
    const m = INVOCATION.exec(command);
    if (!m) throw new Error(`a tutorial block runs only scene commands: ${line}`);
    out.push({ line: command, argv: shellWords(m[1]!), stdin });
  }
  return out;
}

function blocks(markdown: string): Block[] {
  return [...markdown.matchAll(/^```sh( browser)?\n([\s\S]*?)^```$/gm)].map((m) => ({
    browser: m[1] !== undefined,
    commands: m[1] ? [] : commands(m[2]!),
    text: m[2]!,
  }));
}

const tutorial = blocks(section(await readFile(README, "utf8")));
const runnable = tutorial.filter((b) => !b.browser).flatMap((b) => b.commands);

let cwd: string;

async function contextHere(stdin: string | null): Promise<ToolContext> {
  return {
    projects: await discoverProjects(ROOT, DEFAULT_PROJECT_GLOBS, {
      cacheDirOf: (id) => join(ROOT, "node_modules", ".cache", id),
    }),
    loadRapier: loadCompatRapier,
    rapierFlavour: "rapier2d-compat",
    readStdin: async () => {
      if (stdin === null) throw new Error("this command reads no stdin");
      return stdin;
    },
  };
}

beforeAll(async () => {
  await mkdir(ROOT, { recursive: true });
  cwd = process.cwd();
  process.chdir(ROOT);
});

afterAll(async () => {
  if (cwd) process.chdir(cwd);
  if (!process.env.KEEP_TUTORIAL) await rm(ROOT, { recursive: true, force: true });
});

describe("the README's Your first game", () => {
  it("goes game new, apply, playtest, game build, game export, with the browser steps marked", () => {
    expect(runnable.map((c) => c.argv.slice(0, c.argv[0] === "game" ? 2 : 1).join(" "))).toEqual([
      "game new",
      "apply",
      "playtest",
      "game build",
      "game export",
    ]);
    expect(runnable[0]!.argv).toEqual(["game", "new", "orbs", "--preset", "top-down"]);
    expect(runnable.at(-1)!.argv).toEqual(["game", "export", "orbs", "--zip"]);
    const browser = tutorial.filter((b) => b.browser).map((b) => b.text.trim());
    expect(browser).toEqual(["vp dev", "vp dlx serve dist/games/orbs/web"]);
  });

  describe.sequential("runs in a temporary project", () => {
    for (const command of runnable) {
      const builds = command.argv[0] === "game" && command.argv[1] !== "new";
      it(
        command.line,
        async () => {
          const r = await runCli(command.argv, await contextHere(command.stdin));
          expect(r.exitCode, `${command.line}\n${r.stdout}\n${r.stderr}`).toBe(0);
        },
        builds ? BUILD_MS : COMMAND_MS,
      );
    }

    it("left the orb in the scene, the build where step 6 serves it and the zip step 7 names", async () => {
      const scene = JSON.parse(
        await readFile(join(ROOT, "src/games/orbs/scenes/main.json"), "utf8"),
      );
      const orb = (scene.entities as { id: string }[]).find((e) => e.id === "orb");
      expect(orb).toMatchObject({ type: "marker", at: [2.5, 4.5], tags: ["orb"] });
      expect((await stat(join(ROOT, "dist/games/orbs/web/index.html"))).isFile()).toBe(true);
      expect((await stat(join(ROOT, "dist/games/orbs/web/release.json"))).isFile()).toBe(true);
      expect((await stat(join(ROOT, "dist/games/orbs-itch.zip"))).isFile()).toBe(true);
    });
  });
});
