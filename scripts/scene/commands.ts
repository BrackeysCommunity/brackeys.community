import { closest } from "@jams/engine/scene";

import { failure, usage, type ToolContext, type ToolResult } from "./context";
import { apply } from "./tools/apply";
import { applyLive } from "./tools/apply-live";
import { check } from "./tools/check";
import { codes } from "./tools/codes";
import { diff } from "./tools/diff";
import { fmt } from "./tools/fmt";
import { fuzz } from "./tools/fuzz";
import { list } from "./tools/list";
import { newScene } from "./tools/new";
import { playtest } from "./tools/playtest";
import { render } from "./tools/render";
import { replay } from "./tools/replay";
import { schema } from "./tools/schema";
import { show } from "./tools/show";
import { step } from "./tools/step";
import { textconv } from "./tools/textconv";
import { validate } from "./tools/validate";

export type ParsedArgs = { positionals: string[]; flags: Record<string, string | true> };

type Command = {
  usage: string;
  summary: string;
  /** Flags that take a value; the rest of `flags` are switches. `json` is accepted everywhere. */
  values: readonly string[];
  switches: readonly string[];
  maxPositionals: number;
  run: (args: ParsedArgs, ctx: ToolContext) => Promise<ToolResult>;
};

const str = (v: string | true | undefined) => (typeof v === "string" ? v : undefined);

export const COMMANDS = {
  list: {
    usage: "list",
    summary: "every scene with its game, hash, issue counts, entity counts and bounds",
    values: [],
    switches: [],
    maxPositionals: 0,
    run: (_a, ctx) => list({}, ctx),
  },
  show: {
    usage: "show <scene|file|-> [--ref id] [--type t] [--near x,y,r]",
    summary: "entities and bulk entries with refs, AABB and top span, plus the scene hash",
    values: ["ref", "type", "near"],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) =>
      show({ scene, ref: str(flags.ref), type: str(flags.type), near: str(flags.near) }, ctx),
  },
  schema: {
    usage: "schema [scene|ops|script|checks|recording] [--game id]",
    summary:
      "a game's scene, op-batch, input-script or checks-file JSON Schema, or the recording schema; the engine's without --game",
    values: ["game"],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [which], flags }, ctx) => schema({ which, game: str(flags.game) }, ctx),
  },
  codes: {
    usage: "codes",
    summary: "every issue code, the engine's then each game's, with severity and summary",
    values: [],
    switches: [],
    maxPositionals: 0,
    run: (_a, ctx) => codes({}, ctx),
  },
  validate: {
    usage: "validate <scene|file|-> [--physical]",
    summary:
      "parse and structural issues, and with --physical the physics world's; exit 1 on errors",
    values: [],
    switches: ["physical"],
    maxPositionals: 1,
    run: ({ positionals: [target], flags }, ctx) =>
      validate({ target, physical: flags.physical === true }, ctx),
  },
  fmt: {
    usage: "fmt <scene> [--check]",
    summary: "rewrite a scene in canonical form; --check only reports",
    values: [],
    switches: ["check"],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) => fmt({ scene, check: flags.check === true }, ctx),
  },
  apply: {
    usage:
      "apply <scene> --ops <file|-> [--dry-run] [--base hash] [--live [--url ws://…] [--agent id] [--on-behalf-of user]]",
    summary:
      "apply an OpBatch; writes only when ok, error-free and not --dry-run; --live edits the dev server's doc",
    values: ["ops", "base", "url", "agent", "on-behalf-of"],
    switches: ["dry-run", "live"],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) => {
      const common = {
        scene,
        ops: str(flags.ops),
        base: str(flags.base),
        dryRun: flags["dry-run"] === true,
      };
      if (flags.live === true)
        return applyLive(
          {
            ...common,
            url: str(flags.url),
            agent: str(flags.agent),
            onBehalfOf: str(flags["on-behalf-of"]),
          },
          ctx,
        );
      const liveOnly = ["url", "agent", "on-behalf-of"].find((f) => f in flags);
      if (liveOnly) return Promise.resolve(usage(`--${liveOnly} needs --live`));
      return apply(common, ctx);
    },
  },
  diff: {
    usage: "diff <scene|file|-> (<scene|file|-> | --git <rev> | --ops <file|->)",
    summary: "entity, bulk and scene changes between two scenes, a git revision, or an op batch",
    values: ["git", "ops"],
    switches: [],
    maxPositionals: 2,
    run: ({ positionals: [a, b], flags }, ctx) =>
      diff({ a, b, git: str(flags.git), ops: str(flags.ops) }, ctx),
  },
  new: {
    usage: "new <name> [--game id] [--from scene]",
    summary: "write a new scene from the game's template, or a copy of another scene",
    values: ["game", "from"],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [name], flags }, ctx) =>
      newScene({ name, game: str(flags.game), from: str(flags.from) }, ctx),
  },
  step: {
    usage: "step <scene|file|-> [--ticks N] [--hold a,b] [--inputs file] [--game id]",
    summary: "run the headless runtime and report events and the game's final snapshot",
    values: ["ticks", "hold", "inputs", "game"],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) =>
      step(
        {
          scene,
          ticks: str(flags.ticks),
          hold: str(flags.hold),
          inputs: str(flags.inputs),
          game: str(flags.game),
        },
        ctx,
      ),
  },
  playtest: {
    usage: "playtest <scene|file|-> --script <file|-> [--at x,y] [--game id] [--record file]",
    summary:
      "play an input script headless: the outcome, steps, events and focus trail; exit 1 when blocked",
    values: ["script", "at", "game", "record"],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) =>
      playtest(
        {
          scene,
          script: str(flags.script),
          at: str(flags.at),
          game: str(flags.game),
          record: str(flags.record),
        },
        ctx,
      ),
  },
  replay: {
    usage: "replay <scene|file|-> --run <file|-> [--game id]",
    summary:
      "replay a run recording (or a playtest report's) headless; exit 1 when it ends differently",
    values: ["run", "game"],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) =>
      replay({ scene, run: str(flags.run), game: str(flags.game) }, ctx),
  },
  fuzz: {
    usage: "fuzz <scene|file|-> [--seed s] [--rollouts n] [--ticks n] [--game id]",
    summary: "seeded random rollouts: which entities were reached, in how many runs, how early",
    values: ["seed", "rollouts", "ticks", "game"],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) =>
      fuzz(
        {
          scene,
          seed: str(flags.seed),
          rollouts: str(flags.rollouts),
          ticks: str(flags.ticks),
          game: str(flags.game),
        },
        ctx,
      ),
  },
  check: {
    usage: "check <scene|file> [--checks file] [--only id] [--game id]",
    summary:
      "run the scene's <scene>.checks.json (playtests, fuzz, validation); exit 1 on a failure",
    values: ["checks", "only", "game"],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) =>
      check(
        { scene, checks: str(flags.checks), only: str(flags.only), game: str(flags.game) },
        ctx,
      ),
  },
  render: {
    usage:
      "render <scene|file|-> [--out file] [--ascii] [--region r|--around ref --margin n] [--labels l] [--scale n] [--overlay f]",
    summary:
      "a schematic of the scene as PNG or SVG (longest side 1600px), or --ascii as a character map",
    values: ["out", "region", "around", "margin", "labels", "scale", "overlay"],
    switches: ["ascii"],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) =>
      render(
        {
          scene,
          out: str(flags.out),
          region: str(flags.region),
          around: str(flags.around),
          margin: str(flags.margin),
          labels: str(flags.labels),
          scale: str(flags.scale),
          ascii: flags.ascii === true,
          overlay: str(flags.overlay),
        },
        ctx,
      ),
  },
  textconv: {
    usage: "textconv <file>",
    summary: "a scene as one sorted line per entity and bulk entry, for git diff",
    values: [],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [file] }, ctx) => textconv({ file }, ctx),
  },
} satisfies Record<string, Command>;

export type CommandName = keyof typeof COMMANDS;
export const COMMAND_NAMES = Object.keys(COMMANDS) as CommandName[];

export function helpText(): string {
  const width = Math.max(...COMMAND_NAMES.map((n) => COMMANDS[n].usage.length));
  const rows = COMMAND_NAMES.map(
    (n) => `  ${COMMANDS[n].usage.padEnd(width)}  ${COMMANDS[n].summary}`,
  );
  return [
    "usage: vp run scene <command> [args] [--json]",
    "",
    ...rows,
    "",
    "exit codes: 0 ok, 1 error issues or failure, 2 usage, 3 stale base (file batches only)",
  ].join("\n");
}

/** Splits argv into positionals and `--flag value` / `--flag=value` / `--switch`, checked against the command. */
export function parseArgs(
  command: Command,
  argv: readonly string[],
): { ok: true; args: ParsedArgs; json: boolean } | { ok: false; error: string } {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-" || !arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = arg.slice(2, eq < 0 ? undefined : eq);
    if (name === "json") {
      json = true;
      continue;
    }
    if (command.switches.includes(name)) {
      if (eq >= 0) return { ok: false, error: `--${name} takes no value` };
      flags[name] = true;
      continue;
    }
    if (!command.values.includes(name)) return { ok: false, error: `unknown flag --${name}` };
    const value = eq >= 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined) return { ok: false, error: `--${name} needs a value` };
    flags[name] = value;
  }
  if (positionals.length > command.maxPositionals) {
    return {
      ok: false,
      error: `too many arguments: ${positionals.slice(command.maxPositionals).join(" ")}`,
    };
  }
  return { ok: true, args: { positionals, flags }, json };
}

/** Runs one CLI invocation without touching the process: what `cli.ts` prints and exits with. */
export async function runCli(
  argv: readonly string[],
  ctx: ToolContext,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const [name, ...rest] = argv;
  if (!name || name === "help" || name === "--help" || name === "-h") {
    return {
      exitCode: name ? 0 : 2,
      stdout: name ? `${helpText()}\n` : "",
      stderr: name ? "" : `${helpText()}\n`,
    };
  }
  if (!Object.hasOwn(COMMANDS, name)) {
    const guess = closest(name, COMMAND_NAMES);
    const hint = guess ? `; did you mean "${guess}"?` : "";
    return {
      exitCode: 2,
      stdout: "",
      stderr: `unknown command ${JSON.stringify(name)}${hint}\n\n${helpText()}\n`,
    };
  }
  const command: Command = COMMANDS[name as CommandName];
  const parsed = parseArgs(command, rest);
  if (!parsed.ok) {
    const json = rest.includes("--json");
    const body = json
      ? `${JSON.stringify({ ok: false, error: parsed.error, usage: command.usage })}\n`
      : `${parsed.error}\nusage: vp run scene ${command.usage}\n`;
    return json
      ? { exitCode: 2, stdout: body, stderr: "" }
      : { exitCode: 2, stdout: "", stderr: body };
  }
  let result: ToolResult;
  try {
    result = await command.run(parsed.args, ctx);
  } catch (e) {
    result = failure(e instanceof Error ? e.message : String(e));
  }
  const out = parsed.json ? JSON.stringify(result.data) : result.text;
  return result.exitCode === 0 || parsed.json
    ? { exitCode: result.exitCode, stdout: `${out}\n`, stderr: "" }
    : { exitCode: result.exitCode, stdout: "", stderr: `${out}\n` };
}
