import { usage, type Tool, type ToolResult } from "../context";
import { runProjectBatch, type WriterFlags } from "./assets-apply";

export type AssetsSetImportInput = WriterFlags & { id?: string; set?: string };

const USAGE =
  "scene assets set-import <id> --set <json object | key=value,key=value> [writer flags]";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `--set` as import settings: a JSON object, or `key=value` pairs whose values are JSON when they parse (`null` resets a field). */
export function settingsArg(
  raw: string,
): { ok: true; set: Record<string, unknown> } | { ok: false; result: ToolResult } {
  const bad = (message: string) => ({ ok: false as const, result: usage(`--set: ${message}`) });
  const text = raw.trim();
  if (text.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed)) return { ok: true, set: parsed };
    } catch {
      // Reported below.
    }
    return bad(`${raw} isn't a JSON object`);
  }
  const out: Record<string, unknown> = {};
  for (const pair of text.split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) return bad(`expected key=value, got ${JSON.stringify(pair)}`);
    const value = pair.slice(eq + 1).trim();
    let parsed: unknown = value;
    try {
      parsed = JSON.parse(value);
    } catch {
      // A bare word is a string.
    }
    out[pair.slice(0, eq).trim()] = parsed;
  }
  return { ok: true, set: out };
}

/** Changes a binary asset's import settings, per field; its meta is re-inspected from its bytes. */
export const assetsSetImport: Tool<AssetsSetImportInput> = async (input, ctx) => {
  const { id } = input;
  if (!id || input.set === undefined) return usage(USAGE);
  const parsed = settingsArg(input.set);
  if (!parsed.ok) return parsed.result;
  const { set } = parsed;
  return runProjectBatch(ctx, input, {
    id,
    build: () => ({ v: 1, ops: [{ op: "setImport", id, set }] }),
  });
};
