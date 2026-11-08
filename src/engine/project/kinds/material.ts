import { z } from "zod";

import type { BlendMode } from "../../context";
import type { ProjectMaterialDef } from "../../game/define";
import type { Style } from "../../game/types";
import { canonicalJson } from "../canonical";
import { defineAssetKind, type DocLayout } from "./define";

export const MATERIAL_KIND = "material";
export const MATERIAL_VERSION = 1;
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
    strokeWidth: z.number().min(0).describe("Outline width, px.").optional(),
  })
  .describe("A fallback look; wins over the entity type's style field by field.");

const PhysicsSchema = z
  .strictObject({
    friction: z.number().min(0).describe("Surface friction."),
    restitution: z.number().min(0).describe("Bounciness: 0 doesn't bounce, 1 keeps all its speed."),
    impulse: z
      .strictObject({
        x: z.number().describe("x, px/s."),
        y: z.number().describe("y, px/s; y is down, so a bounce is negative."),
      })
      .optional()
      .describe("Launch velocity on contact, px/s."),
  })
  .describe(
    "How bodies of this material collide. Required when a physics body uses the material; without it the material is render data only.",
  );

const BlendSchema = z
  .enum(["normal", "add", "multiply", "screen"])
  .describe(
    "How a sprite of this material composites over what is under it.",
  ) satisfies z.ZodType<BlendMode>;

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

/** A material file as the registry overlays it; null when it isn't a valid material. */
export function projectMaterialOf(value: unknown): ProjectMaterialDef | null {
  const parsed = materialSchema.safeParse(value);
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
