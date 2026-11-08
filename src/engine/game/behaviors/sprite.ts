/**
 * The `sprite` behavior's schema and the geometry every reader of a sprite
 * block shares: the runtime system, the schematic renders and picking. Zod
 * only; the system lives in `runtime/behaviors/sprite.ts`.
 */
import { z } from "zod";

import type { BlendMode } from "../../context";
import type { AssetInfo } from "../../project/asset-info";
import type { Pt, ShapeObj } from "../../scene/types";
import { defineBehavior } from "../behaviors";
import { assetField, mirrorField, vectorField } from "../fields";
import type { FieldEnv } from "../types";

const unit = z.number().min(0).max(1);
const int = z.number().int().min(0);

const BLEND_MODES = ["normal", "add", "multiply", "screen"] as const satisfies readonly BlendMode[];
/** Compiles only while `BLEND_MODES` lists every `BlendMode`. */
const everyBlendMode: [Exclude<BlendMode, (typeof BLEND_MODES)[number]>] extends [never]
  ? true
  : never = true;
void everyBlendMode;

const spriteFields = (env: FieldEnv) => ({
  asset: assetField(
    env,
    ["texture", "atlas"],
    "The texture, or the atlas whose frame it draws.",
  ).optional(),
  frame: z.string().optional().describe("The atlas frame's name; required for an atlas."),
  size: z
    .tuple([
      z.number().int().positive().describe("Width, px."),
      z.number().int().positive().describe("Height, px."),
    ])
    .optional()
    .describe("Drawn size in world px; omitted, the frame's pixel size times scale."),
  scale: z.number().positive().optional().describe("Used when size is omitted; default 1."),
  anchor: z
    .tuple([
      unit.describe("x: 0 the frame's left edge, 1 its right."),
      unit.describe("y: 0 the frame's top, 1 its bottom."),
    ])
    .optional()
    .describe("0–1 in the frame; default its pivot, else the centre."),
  offset: vectorField(
    "World px from the pose to the anchor; turns and flips with the instance.",
  ).optional(),
  tint: z
    .number()
    .int()
    .min(0)
    .max(0xffffff)
    .optional()
    .describe("0xRRGGBB multiplied into the texture; default the material's, else none.")
    .meta({ widget: "color" }),
  alpha: z.number().min(0).max(1).optional().describe("Opacity, 0–1; default 1."),
  flipX: mirrorField("x", "Mirror left–right; an instance flip toggles it.").optional(),
  flipY: z.boolean().optional().describe("Mirror top–bottom."),
  blend: z
    .enum(BLEND_MODES)
    .optional()
    .describe("How it composites over what is below; default the material's, else normal."),
  tile: z.boolean().optional().describe("Repeat the frame across size."),
  nineSlice: z
    .tuple([
      int.describe("Left inset, px."),
      int.describe("Top inset, px."),
      int.describe("Right inset, px."),
      int.describe("Bottom inset, px."),
    ])
    .optional()
    .describe("Insets in texture px; default the import's."),
  turn: z.boolean().optional().describe("Turn with the pose; default true."),
});

/** A `sprite` block as an entity carries it. */
export type SpriteBlock = z.infer<z.ZodObject<ReturnType<typeof spriteFields>>>;

export const SPRITE = defineBehavior({
  name: "sprite",
  description: "Draws a texture or an atlas frame at the entity's pose.",
  visualOnly: true,
  fields: spriteFields,
});

/** A frame's rectangle in its texture, px. */
export type FrameRect = { x: number; y: number; w: number; h: number };

/** What the geometry reads of an asset's info: its (or its frame's) size and pivot, and a frame's rectangle when known. */
export type SpriteAssetInfo = Pick<AssetInfo, "size" | "pivot"> & { rect?: FrameRect };

export type SpriteGeometry = {
  /** The frame's rectangle in its texture; omitted, the whole texture. */
  frame?: FrameRect;
  /** Drawn size, world px. */
  size: [w: number, h: number];
  /** In the frame's own 0–1 space. */
  anchor: [x: number, y: number];
  /** From the pose to the anchor, world px, as the block writes it. */
  offset: Pt;
  /** The drawn rectangle in the sprite's own space: the anchor at the origin, the block's flips applied. */
  box: Extract<ShapeObj, { type: "box" }>;
};

/** A sprite's size when neither its block nor its asset gives one. */
export const SPRITE_FALLBACK_SIZE: readonly [w: number, h: number] = Object.freeze([32, 32]);

/**
 * Where a sprite block draws, from `info` (`ProjectRuntimeView.asset` or
 * `assetInfo` of its asset and frame; omitted without one): its size is the
 * block's `size`, else the info's times `scale`, else 32×32; its anchor
 * the block's, else the info's pivot, else the centre.
 */
export function spriteGeometry(
  block: Partial<SpriteBlock>,
  info?: SpriteAssetInfo | null,
): SpriteGeometry {
  const scale = block.scale ?? 1;
  const size: [number, number] = block.size
    ? [block.size[0], block.size[1]]
    : info?.size
      ? [info.size[0] * scale, info.size[1] * scale]
      : [SPRITE_FALLBACK_SIZE[0], SPRITE_FALLBACK_SIZE[1]];
  const anchor: [number, number] = block.anchor
    ? [block.anchor[0], block.anchor[1]]
    : info?.pivot
      ? [info.pivot[0], info.pivot[1]]
      : [0.5, 0.5];
  const [w, h] = size;
  const cx = (0.5 - anchor[0]) * w;
  const cy = (0.5 - anchor[1]) * h;
  return {
    ...(info?.rect ? { frame: { ...info.rect } } : {}),
    size,
    anchor,
    offset: block.offset ? [block.offset[0], block.offset[1]] : [0, 0],
    box: {
      type: "box",
      cx: (block.flipX ? -cx : cx) + 0,
      cy: (block.flipY ? -cy : cy) + 0,
      hw: w / 2,
      hh: h / 2,
      rotDeg: 0,
    },
  };
}
