import { jsonPointer } from "./issues";
import { BULK_KEYS, type SceneDefinition } from "./types";

const ENTITY_KEY_ORDER = [
  "id",
  "b",
  "name",
  "layer",
  "group",
  "off",
  "kind",
  "type",
  "shape",
  "at",
  "rot",
  "path",
  "material",
  "density",
  "restitution",
  "friction",
  "text",
] as const;
const PATH_KEY_ORDER = ["pts", "mode", "speed", "pauseMs", "seg", "startT"] as const;

function ordered(obj: Record<string, unknown>, order: readonly string[]): [string, unknown][] {
  const known = order
    .filter((k) => obj[k] !== undefined)
    .map((k) => [k, obj[k]] as [string, unknown]);
  const rest = Object.keys(obj)
    .filter((k) => !order.includes(k) && obj[k] !== undefined)
    .sort()
    .map((k) => [k, obj[k]] as [string, unknown]);
  return [...known, ...rest];
}

/** Single-line JSON with `, ` separators and spaced braces. */
function inline(value: unknown, order: readonly string[] = ENTITY_KEY_ORDER): string {
  if (Array.isArray(value)) return `[${value.map((v) => inline(v)).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const entries = ordered(value as Record<string, unknown>, order);
    if (entries.length === 0) return "{}";
    const body = entries
      .map(
        ([k, v]) =>
          `${JSON.stringify(k)}: ${inline(v, k === "path" ? PATH_KEY_ORDER : ENTITY_KEY_ORDER)}`,
      )
      .join(", ");
    return `{ ${body} }`;
  }
  return JSON.stringify(value) ?? "null";
}

function addNested(
  lines: Map<string, number>,
  pointer: string,
  value: unknown,
  line: number,
): void {
  lines.set(pointer, line);
  if (Array.isArray(value)) value.forEach((v, i) => addNested(lines, `${pointer}/${i}`, v, line));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value))
      addNested(lines, `${pointer}${jsonPointer([k])}`, v, line);
  }
}

/**
 * The canonical text of a scene: fixed key order, one tuple or entity per
 * line, two-space indent, trailing newline. Empty bulk arrays and an empty
 * `entities` are left out. `lines` maps every JSON Pointer to its 1-based
 * line; pointers inside a tuple or entity map to that item's line.
 */
export function formatScene(def: SceneDefinition): { text: string; lines: Map<string, number> } {
  const out: string[] = ["{"];
  const lines = new Map<string, number>([["", 1]]);
  const members: [string, unknown, "inline" | "rows"][] = [];
  if (def.$schema !== undefined) members.push(["$schema", def.$schema, "inline"]);
  members.push(
    ["v", def.v, "inline"],
    ["name", def.name, "inline"],
    ["bounds", def.bounds, "inline"],
  );
  members.push(["spawn", def.spawn, "rows"]);
  for (const key of BULK_KEYS) {
    const rows = def[key];
    if (rows && rows.length > 0) members.push([key, rows, "rows"]);
  }
  if (def.entities && def.entities.length > 0) members.push(["entities", def.entities, "rows"]);
  const extra = Object.keys(def)
    .filter((k) => !members.some(([m]) => m === k) && !["entities", ...BULK_KEYS].includes(k))
    .sort();
  for (const k of extra) {
    const v = (def as Record<string, unknown>)[k];
    if (v !== undefined) members.push([k, v, "inline"]);
  }

  members.forEach(([key, value, layout], m) => {
    const comma = m < members.length - 1 ? "," : "";
    const pointer = jsonPointer([key]);
    const keyText = `  ${JSON.stringify(key)}: `;
    if (layout === "inline" || !Array.isArray(value) || value.length === 0) {
      addNested(lines, pointer, value, out.length + 1);
      out.push(`${keyText}${inline(value)}${comma}`);
      return;
    }
    lines.set(pointer, out.length + 1);
    out.push(`${keyText}[`);
    value.forEach((row, i) => {
      addNested(lines, `${pointer}/${i}`, row, out.length + 1);
      out.push(`    ${inline(row)}${i < value.length - 1 ? "," : ""}`);
    });
    out.push(`  ]${comma}`);
  });
  out.push("}");
  return { text: `${out.join("\n")}\n`, lines };
}
