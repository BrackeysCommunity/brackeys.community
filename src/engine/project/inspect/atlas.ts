import { z } from "zod";

import { isPlainObject } from "../kinds/define";

export type AtlasDirection = "forward" | "reverse" | "pingpong";

export type AtlasFrame = {
  x: number;
  y: number;
  w: number;
  h: number;
  pivot?: [number, number];
  durationMs?: number;
};

export type AtlasTag = { name: string; from: number; to: number; direction: AtlasDirection };

/** A slice's rectangle is relative to its frame; `center` is the nine-slice middle, [x, y, w, h]. */
export type AtlasSlice = {
  name: string;
  frame: string;
  x: number;
  y: number;
  w: number;
  h: number;
  center?: [number, number, number, number];
};

/** What an atlas JSON yields: the atlas meta without its `tool`. */
export type AtlasSheet = {
  frames: Record<string, AtlasFrame>;
  tags: AtlasTag[];
  slices: AtlasSlice[];
  /** Frame names in file order; tags and slice keys index into it. */
  order: string[];
};

const int = z.number().int().nonnegative();
const rect = z.object({ x: int, y: int, w: int, h: int });
const point = z.object({ x: z.number(), y: z.number() });

const frameSchema = z.object({
  frame: rect,
  rotated: z.boolean().optional(),
  pivot: point.optional(),
  /** PixiJS's name for the pivot. */
  anchor: point.optional(),
  duration: z.number().nonnegative().optional(),
  /** PixiJS nine-slice insets. */
  borders: z.object({ left: int, top: int, right: int, bottom: int }).optional(),
  /** Phaser's nine-slice rectangle. */
  scale9Borders: rect.optional(),
  scale9Enabled: z.boolean().optional(),
});
type RawFrame = z.infer<typeof frameSchema>;

const namedFrameSchema = frameSchema.extend({ filename: z.string() });

const tagSchema = z.object({
  name: z.string(),
  from: int,
  to: int,
  direction: z.enum(["forward", "reverse", "pingpong", "pingpong_reverse"]).default("forward"),
});

const sliceSchema = z.object({
  name: z.string(),
  keys: z.array(z.object({ frame: int, bounds: rect, center: rect.optional() })),
});

const metaSchema = z.object({
  image: z.string().optional(),
  app: z.string().optional(),
  frameTags: z.array(tagSchema).optional(),
  slices: z.array(sliceSchema).optional(),
});

// Frames and animations are keyed by name and read entry by entry, so a
// name like "__proto__" stays a name.
const sheetSchema = z.object({
  frames: z.unknown(),
  meta: metaSchema.optional(),
  /** PixiJS animations: name → frame names. */
  animations: z.unknown().optional(),
});

const animationSchema = z.array(z.string());

export type SheetFeatures = {
  /**
   * TexturePacker's export flavours: PixiJS `anchor`, `animations` (as tags
   * where they step through `order`) and `borders`, and Phaser
   * `scale9Borders` (both as a slice named after the frame).
   */
  packer: boolean;
};

/** Frames as [name, raw] in file order, or null when one is malformed or a name repeats. */
function rawFrames(frames: unknown): [string, RawFrame][] | null {
  const out: [string, RawFrame][] = [];
  if (Array.isArray(frames)) {
    for (const item of frames) {
      const parsed = namedFrameSchema.safeParse(item);
      if (!parsed.success) return null;
      out.push([parsed.data.filename, parsed.data]);
    }
  } else if (isPlainObject(frames)) {
    for (const [name, value] of Object.entries(frames)) {
      const parsed = frameSchema.safeParse(value);
      if (!parsed.success) return null;
      out.push([name, parsed.data]);
    }
  } else {
    return null;
  }
  if (new Set(out.map(([name]) => name)).size !== out.length) return null;
  return out;
}

function toFrame(raw: RawFrame, features: SheetFeatures): AtlasFrame {
  const frame: AtlasFrame = { x: raw.frame.x, y: raw.frame.y, w: raw.frame.w, h: raw.frame.h };
  const pivot = raw.pivot ?? (features.packer ? raw.anchor : undefined);
  if (pivot) frame.pivot = [pivot.x, pivot.y];
  if (raw.duration !== undefined) frame.durationMs = raw.duration;
  return frame;
}

function borderSlice(name: string, raw: RawFrame): AtlasSlice | null | undefined {
  const { w, h } = raw.frame;
  let center: [number, number, number, number] | undefined;
  if (raw.borders) {
    const { left, top, right, bottom } = raw.borders;
    if (left + right > w || top + bottom > h) return null;
    center = [left, top, w - left - right, h - top - bottom];
  } else if (raw.scale9Borders && raw.scale9Enabled !== false) {
    const b = raw.scale9Borders;
    center = [b.x, b.y, b.w, b.h];
  }
  return center ? { name, frame: name, x: 0, y: 0, w, h, center } : undefined;
}

/** Tags for PixiJS animations that step through `order` one frame at a time. */
function animationTags(animations: unknown, order: string[]): AtlasTag[] | null {
  if (!isPlainObject(animations)) return null;
  const index = new Map(order.map((name, i) => [name, i]));
  const tags: AtlasTag[] = [];
  for (const [name, value] of Object.entries(animations)) {
    const frames = animationSchema.safeParse(value);
    if (!frames.success) return null;
    const ids: number[] = [];
    for (const frame of frames.data) {
      const i = index.get(frame);
      if (i === undefined) return null;
      ids.push(i);
    }
    const first = ids[0];
    const last = ids[ids.length - 1];
    if (first === undefined || last === undefined) continue;
    const step = ids.length === 1 ? 1 : Math.sign(last - first);
    if (step === 0 || !ids.every((id, i) => id === first + i * step)) continue;
    tags.push(
      step > 0
        ? { name, from: first, to: last, direction: "forward" }
        : { name, from: last, to: first, direction: "reverse" },
    );
  }
  return tags;
}

/**
 * The frames, tags and slices of a JSON sprite sheet, in the hash form
 * (frames keyed by name) or the array form (frames with `filename`).
 * Null when the JSON is malformed, a frame is rotated (the meta has no
 * rotation), or a tag or slice names a frame that doesn't exist.
 */
export function parseSheet(json: unknown, features: SheetFeatures): AtlasSheet | null {
  const parsed = sheetSchema.safeParse(json);
  if (!parsed.success) return null;
  const raws = rawFrames(parsed.data.frames);
  if (!raws) return null;
  if (raws.some(([, raw]) => raw.rotated === true)) return null;

  const order = raws.map(([name]) => name);
  const frames = Object.fromEntries(raws.map(([name, raw]) => [name, toFrame(raw, features)]));

  const tags: AtlasTag[] = [];
  for (const tag of parsed.data.meta?.frameTags ?? []) {
    if (tag.from > tag.to || tag.to >= order.length) return null;
    // The meta has no reverse ping-pong; it keeps the frames and the bounce.
    const direction = tag.direction === "pingpong_reverse" ? "pingpong" : tag.direction;
    tags.push({ name: tag.name, from: tag.from, to: tag.to, direction });
  }
  if (features.packer && parsed.data.animations !== undefined) {
    const more = animationTags(parsed.data.animations, order);
    if (!more) return null;
    tags.push(...more);
  }

  const slices: AtlasSlice[] = [];
  for (const slice of parsed.data.meta?.slices ?? []) {
    for (const key of slice.keys) {
      const frame = order[key.frame];
      if (frame === undefined) return null;
      const { x, y, w, h } = key.bounds;
      const out: AtlasSlice = { name: slice.name, frame, x, y, w, h };
      if (key.center) out.center = [key.center.x, key.center.y, key.center.w, key.center.h];
      slices.push(out);
    }
  }
  if (features.packer) {
    for (const [name, raw] of raws) {
      const slice = borderSlice(name, raw);
      if (slice === null) return null;
      if (slice) slices.push(slice);
    }
  }

  return { frames, tags, slices, order };
}

/** The texture file an atlas JSON names in `meta.image`, or null. */
export function atlasImage(json: unknown): string | null {
  if (!isPlainObject(json) || !isPlainObject(json.meta)) return null;
  const image = json.meta.image;
  return typeof image === "string" && image !== "" ? image : null;
}

/** Which tool exported an atlas JSON: Aseprite by its `meta.app`, otherwise TexturePacker's format. */
export function atlasTool(json: unknown): "aseprite" | "texturepacker" | null {
  if (!isPlainObject(json) || !("frames" in json)) return null;
  const app = isPlainObject(json.meta) ? json.meta.app : undefined;
  return typeof app === "string" && app.includes("aseprite.org") ? "aseprite" : "texturepacker";
}
