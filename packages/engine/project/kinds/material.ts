import { z } from "zod";

import { BLEND_MODES } from "../../game/defaults";
import type { ProjectMaterialDef } from "../../game/define";
import type { Registry, Style } from "../../game/types";
import { pxPerMetreOf, scaleLengths } from "../../game/units";
import { unitsRefusal } from "../../scene/issues";
import type { MigrateEnv } from "../../scene/migrate";
import { canonicalJson } from "../canonical";
import { defineAssetKind, isPlainObject, type DocLayout } from "./define";

export const MATERIAL_KIND = "material";
export const MATERIAL_VERSION = 2;
export const MATERIAL_SCHEMA_ID = `urn:jams-engine:material:v${MATERIAL_VERSION}`;

const color = (description: string) =>
  z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, { error: 'a color is "#rgb" or "#rrggbb"' })
    .describe(description);
const unit = (description: string) => z.number().min(0).max(1).describe(description);

const StyleSchema = z
  .strictObject({
    fill: color("Fill color, #rgb or #rrggbb.").optional(),
    stroke: color("Outline color, #rgb or #rrggbb.").optional(),
    alpha: unit("Opacity of the whole shape, 0 to 1.").optional(),
    strokeAlpha: unit("Opacity of the outline, 0 to 1; the shape's alpha when omitted.").optional(),
    strokeWidth: z.number().min(0).describe("Outline width, px.").meta({ unit: "px" }).optional(),
  })
  .describe("A fallback look; wins over the entity type's style field by field.");

const ImpulseSchema = z
  .strictObject({
    x: z.number().describe("x, m/s.").meta({ unit: "m/s" }),
    y: z.number().describe("y, m/s; y is down, so a bounce is negative.").meta({ unit: "m/s" }),
  })
  .describe("Launch velocity on contact, m/s.")
  .meta({ unit: "m/s" });

/** v1 → v2: the launch velocity becomes m/s, divided by the game's px per metre. */
function materialV1ToV2(raw: unknown, env: MigrateEnv): unknown {
  if (!env.registry) return unitsRefusal("material");
  const doc = raw as Record<string, unknown>;
  const physics = doc.physics;
  const out = { ...doc, v: 2 };
  if (!isPlainObject(physics) || physics.impulse === undefined) return out;
  const impulse = scaleLengths(physics.impulse, ImpulseSchema, pxPerMetreOf(env.registry));
  return { ...out, physics: { ...physics, impulse } };
}

const PhysicsSchema = z
  .strictObject({
    friction: z.number().min(0).describe("Surface friction."),
    restitution: z.number().min(0).describe("Bounciness: 0 doesn't bounce, 1 keeps all its speed."),
    impulse: ImpulseSchema.optional(),
  })
  .describe(
    "How bodies of this material collide. Required when a physics body uses the material; without it the material is render data only.",
  );

const BlendSchema = z
  .enum(BLEND_MODES)
  .describe("How a sprite of this material composites over what is under it.");

const RenderSchema = z
  .strictObject({
    style: StyleSchema.optional(),
    tint: color("Sprite tint, #rgb or #rrggbb; multiplies the texture's colours.").optional(),
    blend: BlendSchema.optional(),
  })
  .describe("How bodies of this material are drawn.");

export const materialSchema = z
  .strictObject({
    $schema: z.string().optional().describe("The material JSON Schema this file follows."),
    kind: z.literal(MATERIAL_KIND).describe('Always "material".'),
    v: z.literal(MATERIAL_VERSION).describe("Material format version."),
    description: z
      .string()
      .min(1)
      .describe("One sentence; the inspector and the scene schema list it beside the name."),
    physics: PhysicsSchema.optional(),
    render: RenderSchema.optional(),
  })
  .describe(
    "A surface material. Its asset id is its name in material fields, and it wins over a game's code material of that name.",
  );

export type MaterialFile = z.infer<typeof materialSchema>;

const hexColor = (text: string): number => {
  const hex = text.slice(1);
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return Number.parseInt(full, 16);
};

function styleOf(style: z.infer<typeof StyleSchema>): Style {
  const out: Style = {};
  if (style.fill !== undefined) out.fill = hexColor(style.fill);
  if (style.stroke !== undefined) out.stroke = hexColor(style.stroke);
  if (style.alpha !== undefined) out.alpha = style.alpha;
  if (style.strokeAlpha !== undefined) out.strokeAlpha = style.strokeAlpha;
  if (style.strokeWidth !== undefined) out.strokeWidth = style.strokeWidth;
  return out;
}

/**
 * A material file as the registry overlays it; null when it isn't a valid
 * material. A v1 file is lifted to v2 first when `registry` gives its game's
 * px per metre.
 */
export function projectMaterialOf(value: unknown, registry?: Registry): ProjectMaterialDef | null {
  const lifted =
    registry && isPlainObject(value) && value.v === 1 ? materialV1ToV2(value, { registry }) : value;
  const parsed = materialSchema.safeParse(lifted);
  if (!parsed.success) return null;
  const { description, physics, render } = parsed.data;
  return {
    description,
    ...(physics ? { physics: { ...physics } } : {}),
    ...(render?.style ? { style: styleOf(render.style) } : {}),
    ...(render?.tint !== undefined ? { tint: hexColor(render.tint) } : {}),
    ...(render?.blend !== undefined ? { blend: render.blend } : {}),
  };
}

/** Each top-level field is one value, so the file keeps `render` on one line. */
const MATERIAL_TEXT_LAYOUT: DocLayout = { as: "map", rest: { as: "atomic" } };

/** A surface material: a description, an optional physics block and an optional look. */
export const materialKind = defineAssetKind({
  kind: MATERIAL_KIND,
  title: "Material",
  description: "A surface material: friction and bounce for physics bodies, and a fallback look.",
  match: { jsonKind: MATERIAL_KIND },
  defaultFolder: () => "materials",
  storage: "doc",
  version: MATERIAL_VERSION,
  migrations: { 1: materialV1ToV2 },
  schemaId: MATERIAL_SCHEMA_ID,
  schema: () => materialSchema,
  // `render`'s fields merge one by one, so concurrent tint and blend edits both survive.
  layout: {
    as: "map",
    fields: { render: { as: "map", rest: { as: "atomic" } } },
    rest: { as: "atomic" },
  },
  format: (value: MaterialFile) => canonicalJson(value, MATERIAL_TEXT_LAYOUT),
  empty: (): MaterialFile => ({
    kind: MATERIAL_KIND,
    v: MATERIAL_VERSION,
    description: "A new material.",
  }),
});
