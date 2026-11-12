/**
 * The scene format reference in `packages/engine/README.md`, generated from the
 * engine registry's JSON Schema so the README can't drift from the format.
 * `readme.test.ts` checks it; `UPDATE_README=1` rewrites it.
 */
import { BASE_FIELDS, createRegistry } from "@jams/engine/game";
import { sceneJsonSchema } from "@jams/engine/scene";

type Node = {
  $ref?: string;
  type?: string;
  const?: unknown;
  enum?: unknown[];
  not?: object;
  items?: Node | false;
  prefixItems?: Node[];
  properties?: Record<string, Node>;
  additionalProperties?: Node | boolean;
  required?: string[];
  oneOf?: Node[];
  anyOf?: Node[];
  description?: string;
  title?: string;
  unit?: string;
  default?: unknown;
};

export const REFERENCE_START = "<!-- format-reference:start -->";
export const REFERENCE_END = "<!-- format-reference:end -->";

const REF_NAMES: Record<string, string> = {
  Pt: "[point](#points)",
  ShapeTuple: "[shape](#shapes)",
  BodyShape: "[body shape](#shapes)",
  Polygon: "[polygon](#shapes)",
  Path: "[path](#paths)",
  Entity: "[entity](#entity-types)",
  Group: "[group](#groups-and-prefabs)",
  Instance: "[instance](#groups-and-prefabs)",
};

/** Fields the engine adds to every entity type. */
const BASE = ["id", "type", ...Object.keys(BASE_FIELDS).filter((key) => key !== "id")];

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n+/g, " ");
const code = (v: unknown) => `\`${JSON.stringify(v)}\``;

function typeOf(node: Node): string {
  const unit = node.unit ? ` (${node.unit})` : "";
  if (node.$ref) return REF_NAMES[node.$ref.replace("#/$defs/", "")] ?? node.$ref;
  if (node.const !== undefined) return code(node.const);
  if (node.enum) return node.enum.map(code).join(" | ");
  if (node.not) return "none registered";
  if (node.type === "array" && node.prefixItems) {
    return `[${node.prefixItems.map((i) => typeOf(i)).join(", ")}]${unit}`;
  }
  if (node.type === "array" && node.items) return `${typeOf(node.items)}[]`;
  if (node.oneOf ?? node.anyOf) return (node.oneOf ?? node.anyOf)!.map(typeOf).join(" or ");
  if (node.type === "object" && typeof node.additionalProperties === "object")
    return `{ id: ${typeOf(node.additionalProperties)} }`;
  return `${node.type ?? "any"}${unit}`;
}

function fieldTable(node: Node, skip: readonly string[] = []): string[] {
  const required = new Set(node.required ?? []);
  const rows = Object.entries(node.properties ?? {})
    .filter(([key]) => !skip.includes(key))
    .map(
      ([key, field]) =>
        `| \`${key}\` | ${cell(typeOf(field))} | ${required.has(key) ? "yes" : ""} | ${cell(field.description ?? "")} |`,
    );
  return ["| Field | Type | Required | Description |", "| --- | --- | --- | --- |", ...rows];
}

/** The tuple layouts the shape union's description spells out, by tag. */
function tupleLayouts(description: string): Map<string, string> {
  const layouts = new Map<string, string>();
  for (const m of description.matchAll(/\["([a-z]+)"[^\]]*\]/g)) layouts.set(m[1]!, m[0]);
  return layouts;
}

export function formatReference(): string {
  const schema = sceneJsonSchema(createRegistry()) as Node & { $defs: Record<string, Node> };
  const defs = schema.$defs;
  const out: string[] = [];

  out.push("### Top-level keys", "", ...fieldTable(schema), "");

  const entities = defs.Entity!.oneOf ?? [];
  out.push("### Fields every entity has", "");
  const base = pick(entities[0]!.properties, BASE);
  base.type = { type: "string", description: "The entity's type: one of the types below." };
  out.push(...fieldTable({ ...entities[0]!, properties: base }), "");

  out.push("### Entity types", "");
  for (const variant of entities) {
    const type = variant.properties!.type!;
    out.push(`#### \`${String(type.const)}\``, "", type.description ?? "", "");
    out.push(...fieldTable(variant, BASE), "");
  }

  const shapes = defs.ShapeTuple!;
  const layouts = tupleLayouts(shapes.description ?? "");
  out.push("### Shapes", "", shapes.description ?? "", "");
  out.push("A body shape is any of these but `chain`.", "");
  for (const shape of shapes.oneOf ?? []) {
    const tag = shape.title ?? "";
    const items = (shape.prefixItems ?? [])
      .slice(1)
      .map((i) => `${(i.description ?? "").replace(/\.$/, "")}${i.unit ? ` (${i.unit})` : ""}`);
    const layout = layouts.get(tag);
    const parts = items.length ? ` Items: ${items.join("; ")}.` : "";
    out.push(
      `- **\`${tag}\`**${layout ? ` \`${layout}\`` : ""}: ${shape.description ?? ""}${parts}`,
    );
  }
  out.push("");

  out.push("### Points", "", defs.Pt!.description ?? "", "");
  out.push("### Paths", "", defs.Path!.description ?? "", "", ...fieldTable(defs.Path!));
  return out.join("\n").trim();
}

function pick(props: Record<string, Node> | undefined, keys: readonly string[]) {
  return Object.fromEntries(keys.filter((k) => props?.[k]).map((k) => [k, props![k]!]));
}

/** `readme` with the reference section replaced by `reference`. */
export function withReference(readme: string, reference: string): string {
  const start = readme.indexOf(REFERENCE_START);
  const end = readme.indexOf(REFERENCE_END);
  if (start < 0 || end < start) throw new Error("the README has no format-reference markers");
  return `${readme.slice(0, start + REFERENCE_START.length)}\n\n${reference}\n\n${readme.slice(end)}`;
}
