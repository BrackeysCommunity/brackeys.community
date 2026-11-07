import { readFile, writeFile, readdir, rename } from "node:fs/promises";

import type { RapierModule } from "@jams/engine/headless";
import { parseScene, type SceneDefinition, type SceneIssue } from "@jams/engine/scene";
import { resolveScenePath, sceneNameOf, ScenePathError } from "@jams/engine/vite";

export type ToolContext = {
  scenesDir: string;
  loadRapier: () => Promise<RapierModule>;
  /** Reads `-` arguments; the CLI passes stdin. */
  readStdin?: () => Promise<string>;
};

/** 0 ok, 1 error-severity issues or failure, 2 usage, 3 stale base. */
export type ExitCode = 0 | 1 | 2 | 3;

export type ToolResult = { exitCode: ExitCode; data: unknown; text: string };

export type Tool<I> = (input: I, ctx: ToolContext) => Promise<ToolResult>;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export const usage = (message: string): ToolResult => ({
  exitCode: 2,
  data: { ok: false, error: message },
  text: `usage: ${message}`,
});

export const failure = (message: string, extra: Record<string, unknown> = {}): ToolResult => ({
  exitCode: 1,
  data: { ok: false, error: message, ...extra },
  text: `error: ${message}`,
});

export async function listSceneNames(ctx: ToolContext): Promise<string[]> {
  const files = await readdir(ctx.scenesDir).catch(() => [] as string[]);
  return files
    .map(sceneNameOf)
    .filter((n): n is string => n !== null)
    .sort();
}

export async function readSceneText(ctx: ToolContext, name: string): Promise<string> {
  return readFile(resolveScenePath(ctx.scenesDir, name), "utf8");
}

export async function writeSceneText(ctx: ToolContext, name: string, text: string): Promise<void> {
  const file = resolveScenePath(ctx.scenesDir, name);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}

/** A scene name reads from the scenes directory; anything with a slash or `.json` is a file path, read-only. */
export function isFileArg(arg: string): boolean {
  return arg.includes("/") || arg.endsWith(".json");
}

export async function readArg(ctx: ToolContext, arg: string): Promise<string> {
  if (arg === "-") {
    if (!ctx.readStdin) throw new UsageError("stdin is not available here");
    return ctx.readStdin();
  }
  return readFile(arg, "utf8");
}

export type LoadedScene =
  | { ok: true; name: string; text: string; def: SceneDefinition }
  | { ok: false; result: ToolResult };

/** Reads and parses a scene by name, turning every failure into a ToolResult. */
export async function loadScene(
  ctx: ToolContext,
  name: string | undefined,
  cmd: string,
): Promise<LoadedScene> {
  if (!name) return { ok: false, result: usage(`scene ${cmd} <scene>`) };
  let text: string;
  try {
    text = await readSceneText(ctx, name);
  } catch (e) {
    if (e instanceof ScenePathError) return { ok: false, result: usage(e.message) };
    if ((e as { code?: string }).code === "ENOENT")
      return { ok: false, result: failure(`No scene named ${JSON.stringify(name)}.`) };
    throw e;
  }
  const parsed = parseScene(text);
  if (!parsed.ok) return { ok: false, result: issuesFailure(name, parsed.issues) };
  return { ok: true, name, text, def: parsed.def };
}

export function issuesFailure(scene: string, issues: SceneIssue[]): ToolResult {
  return {
    exitCode: 1,
    data: { ok: false, scene, issues },
    text: [`${scene}: failed to parse`, ...issues.map(issueLine)].join("\n"),
  };
}

export function issueLine(i: SceneIssue): string {
  const where = i.line !== undefined ? `:${i.line}` : "";
  const ids = i.entityIds.length > 0 ? ` [${i.entityIds.join(", ")}]` : "";
  const hint = i.hint ? `\n    hint: ${i.hint}` : "";
  return `  ${i.severity} ${i.code}${where}${ids} ${i.message}${hint}`;
}
