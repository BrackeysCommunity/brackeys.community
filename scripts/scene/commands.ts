import { closest } from "@jams/engine/scene";

import { failure, type ToolContext, type ToolResult } from "./context";
import { apply } from "./tools/apply";
import { codes } from "./tools/codes";
import { fmt } from "./tools/fmt";
import { list } from "./tools/list";
import { schema } from "./tools/schema";
import { show } from "./tools/show";
import { step } from "./tools/step";
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
    summary: "scenes with hash, entity counts and bounds",
    values: [],
    switches: [],
    maxPositionals: 0,
    run: (_a, ctx) => list({}, ctx),
  },
  show: {
    usage: "show <scene> [--ref id] [--behavior b] [--near x,y,r]",
    summary: "entities and bulk entries with refs, AABB and top span, plus the scene hash",
    values: ["ref", "behavior", "near"],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) =>
      show(
        { scene, ref: str(flags.ref), behavior: str(flags.behavior), near: str(flags.near) },
        ctx,
      ),
  },
  schema: {
    usage: "schema [scene|ops]",
    summary: "a JSON Schema",
    values: [],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [which] }, ctx) => schema({ which }, ctx),
  },
  codes: {
    usage: "codes",
    summary: "every issue code with its severity, summary and hint",
    values: [],
    switches: [],
    maxPositionals: 0,
    run: (_a, ctx) => codes({}, ctx),
  },
  validate: {
    usage: "validate <scene|file|->",
    summary: "parse and structural issues; exit 1 on errors",
    values: [],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [target] }, ctx) => validate({ target }, ctx),
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
    usage: "apply <scene> --ops <file|-> [--dry-run] [--base hash]",
    summary: "apply an OpBatch; writes only when ok, error-free and not --dry-run",
    values: ["ops", "base"],
    switches: ["dry-run"],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) =>
      apply(
        { scene, ops: str(flags.ops), base: str(flags.base), dryRun: flags["dry-run"] === true },
        ctx,
      ),
  },
  step: {
    usage: "step <scene> [--ticks N] [--hold a,b] [--inputs file]",
    summary: "run the headless runtime and report events, landings and the final player state",
    values: ["ticks", "hold", "inputs"],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) =>
      step(
        { scene, ticks: str(flags.ticks), hold: str(flags.hold), inputs: str(flags.inputs) },
        ctx,
      ),
  },
} satisfies Record<string, Command>;

export type CommandName = keyof typeof COMMANDS;
export const COMMAND_NAMES = Object.keys(COMMANDS) as CommandName[];

export function helpText(): string {
  const rows = COMMAND_NAMES.map((n) => `  ${COMMANDS[n].usage.padEnd(56)} ${COMMANDS[n].summary}`);
  return [
    "usage: vp run scene <command> [args] [--json]",
    "",
    ...rows,
    "",
    "exit codes: 0 ok, 1 error issues or failure, 2 usage, 3 stale base",
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
