import { readFile } from "node:fs/promises";

import {
  bulkEntries,
  bulkId,
  bulkKeysOf,
  formatScene,
  RESERVED_SCENE_KEYS,
  SCENE_HEADER_KEYS,
  type SceneDefinition,
} from "@jams/engine/scene";

import { failure, usage, type Tool } from "../context";

/** A value as `formatScene` writes it on one line: canonical key order, `, ` separators. */
function canonical(value: unknown): string {
  const row = formatScene({ _: [value] } as unknown as SceneDefinition).text.split("\n")[2]!;
  return row.trim();
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** A bulk entry the way `scene diff` prints one: `[box 100 0 10 10]`. */
const entry = (v: unknown) => (Array.isArray(v) ? `[${v.join(" ")}]` : canonical(v));

/**
 * `entities` in file order, except that an entity whose parent is an entity
 * listed after it waits and follows that parent, with its own waiting
 * children after it. What a parent cycle leaves waiting comes last, in file
 * order.
 */
function parentsFirst(entities: readonly unknown[]): unknown[] {
  const idOf = (e: unknown) => (isObject(e) ? e.id : undefined);
  const ids = new Set(entities.map(idOf));
  const waiting = new Map<unknown, unknown[]>();
  const out: unknown[] = [];
  const done = new Set<unknown>();
  const listedIds = new Set<unknown>();
  const emit = (e: unknown) => {
    if (done.has(e)) return;
    done.add(e);
    out.push(e);
    const id = idOf(e);
    if (id === undefined) return;
    listedIds.add(id);
    const kids = waiting.get(id);
    waiting.delete(id);
    for (const k of kids ?? []) emit(k);
  };
  for (const e of entities) {
    const parent = isObject(e) ? e.parent : undefined;
    if (parent !== undefined && parent !== idOf(e) && ids.has(parent) && !listedIds.has(parent))
      waiting.set(parent, [...(waiting.get(parent) ?? []), e]);
    else emit(e);
  }
  for (const e of entities) emit(e);
  return out;
}

function listing(def: SceneDefinition): string {
  const doc = def as Record<string, unknown>;
  const lines: string[] = [];
  for (const k of SCENE_HEADER_KEYS) {
    const v = doc[k];
    if (v === undefined) continue;
    if (k === "settings" && isObject(v)) {
      for (const s of Object.keys(v).sort()) lines.push(`settings.${s}: ${canonical(v[s])}`);
    } else lines.push(`${k}: ${canonical(v)}`);
  }
  const bulk = bulkKeysOf(def);
  for (const k of bulk)
    bulkEntries(def, k).forEach((v, i) => lines.push(`${bulkId(k, i)} ${entry(v)}`));
  for (const k of Object.keys(doc).sort()) {
    if (!RESERVED_SCENE_KEYS.includes(k) && !bulk.includes(k))
      lines.push(`${k}: ${canonical(doc[k])}`);
  }
  const entities = doc.entities;
  if (!Array.isArray(entities)) {
    if (entities !== undefined) lines.push(`entities: ${canonical(entities)}`);
    return lines.join("\n");
  }
  for (const e of parentsFirst(entities)) {
    if (!isObject(e)) {
      lines.push(canonical(e));
      continue;
    }
    const { id, type, ...rest } = e;
    const fields = Object.keys(rest).length > 0 ? ` ${canonical(rest)}` : "";
    lines.push(`${String(id)} ${String(type)}${fields}`);
  }
  return lines.join("\n");
}

/**
 * git's `diff.scene.textconv`: a scene file as one line per header field,
 * settings key, bulk entry (by its `~key:index` ref) and entity (id, type,
 * then its fields in canonical order; a child after its parent), so
 * `git diff` reads by entry. git
 * passes a temporary copy, which needn't be valid: text that isn't a JSON
 * object with a numeric `v` comes back as it is.
 */
export const textconv: Tool<{ file?: string }> = async (input) => {
  if (!input.file) return usage("scene textconv <file>");
  let text: string;
  try {
    text = await readFile(input.file, "utf8");
  } catch (e) {
    return failure(`cannot read ${input.file}: ${(e as Error).message}`);
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    doc = undefined;
  }
  const scene = isObject(doc) && typeof doc.v === "number";
  return {
    exitCode: 0,
    data: { ok: true, scene },
    // The CLI ends its output with a newline, so a file that ends in one comes back byte for byte.
    text: scene ? listing(doc as SceneDefinition) : text.replace(/\n$/, ""),
  };
};
