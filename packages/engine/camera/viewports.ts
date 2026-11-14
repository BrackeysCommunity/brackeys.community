/** Viewports: split screen and minimaps drawn from one world. View-side; nothing here reads the simulation. */
import { z } from "zod";

import { boxCentre, clampZoom, zoomToFit } from "../camera";
import { rgbSchema } from "../game/color";
import { CAMERA_RIG_SCHEMA, type CameraRigDef } from "../game/primitives";
import type { CameraFrame } from "./rig";

/** One viewport over the canvas. */
export type ViewportDef = {
  /** Canvas fractions: [x, y, w, h], 0–1. */
  rect: [x: number, y: number, w: number, h: number];
  /** What it frames: a seat's targets, an entity, the main targets, or the whole scene (a minimap). */
  frame: { player: number } | { entity: string } | "main" | "scene";
  /** Scene layers drawn; default all but editor-only. */
  layers?: readonly string[];
  rig?: CameraRigDef;
  /** A frame of `width` view px around it. */
  border?: { width: number; color: number };
};

/** At most this many viewports share a canvas. */
export const MAX_VIEWPORTS = 4;

/** A rectangle in canvas px. */
export type ViewportRect = { x: number; y: number; width: number; height: number };

/** The one viewport a game declares none of: the whole canvas, framing the main targets. */
export function defaultViewports(): ViewportDef[] {
  return [{ rect: [0, 0, 1, 1], frame: "main" }];
}

const RECT = "must be [x, y, w, h]";
const rectPart = z.number({ error: "must be a fraction 0–1" });
const fraction = (n: number) => n >= 0 && n <= 1;

/** `ViewportDef` checked at run time; its output is a `ViewportDef`. */
const VIEWPORT_SCHEMA = z.strictObject({
  rect: z
    .tuple([rectPart, rectPart, rectPart, rectPart], { error: RECT })
    .refine(
      ([x, y, w, h]) =>
        [x, y, w, h].every(fraction) && w > 0 && h > 0 && x + w <= 1 + 1e-9 && y + h <= 1 + 1e-9,
      {
        error: (issue) =>
          `[${(issue.input as number[]).join(", ")}] isn't a non-empty part of the canvas in 0–1 fractions`,
      },
    ),
  frame: z.union(
    [
      z.literal(["main", "scene"]),
      z.strictObject({ player: z.number().int().min(0) }),
      z.strictObject({ entity: z.string().min(1) }),
    ],
    {
      error: (issue) =>
        `${JSON.stringify(issue.input)} isn't "main", "scene", { player: n ≥ 0 } or { entity: id }`,
    },
  ),
  layers: z
    .array(z.string({ error: "must be a layer name" }), { error: "must be a list of layer names" })
    .optional(),
  rig: CAMERA_RIG_SCHEMA.optional(),
  border: z.strictObject({ width: z.number().min(0), color: rgbSchema }).optional(),
}) satisfies z.ZodType<ViewportDef>;

/** A viewport's first issue: `frame "minimap" isn't …`, `rig damping: Too small …`. */
function issueText(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "invalid";
  const [key, ...rest] = issue.path;
  if (key === undefined) return issue.message;
  return `${String(key)} ${rest.length > 0 ? `${rest.join(".")}: ` : ""}${issue.message}`;
}

/** Why `defs` can't be a canvas's viewports, or null when they can. */
export function viewportsProblem(defs: readonly ViewportDef[]): string | null {
  if (defs.length < 1 || defs.length > MAX_VIEWPORTS)
    return `a canvas has 1–${MAX_VIEWPORTS} viewports, not ${defs.length}`;
  for (const [i, def] of defs.entries()) {
    const parsed = VIEWPORT_SCHEMA.safeParse(def);
    if (!parsed.success) return `viewport ${i}: ${issueText(parsed.error)}`;
  }
  return null;
}

/** Whether `def` covers the whole canvas. */
export function fillsCanvas(def: ViewportDef): boolean {
  const [x, y, w, h] = def.rect;
  return x === 0 && y === 0 && w === 1 && h === 1;
}

/** `def`'s rectangle in canvas px on a `width` × `height` canvas. */
export function viewportRect(def: ViewportDef, width: number, height: number): ViewportRect {
  const [x, y, w, h] = def.rect;
  return { x: x * width, y: y * height, width: w * width, height: h * height };
}

/**
 * The index of the viewport under canvas px (`x`, `y`) on a `width` × `height`
 * canvas: the topmost, since later viewports draw over earlier ones. Null
 * where none is, or off the canvas.
 */
export function viewportIndexAt(
  defs: readonly ViewportDef[],
  x: number,
  y: number,
  width: number,
  height: number,
): number | null {
  if (!(width > 0 && height > 0)) return null;
  const fx = x / width;
  const fy = y / height;
  if (!(fx >= 0 && fy >= 0 && fx <= 1 && fy <= 1)) return null;
  for (let i = defs.length - 1; i >= 0; i--) {
    const [rx, ry, rw, rh] = defs[i]!.rect;
    if (fx >= rx && fx <= rx + rw && fy >= ry && fy <= ry + rh) return i;
  }
  return null;
}

/**
 * The frame that shows all of `bounds` ([minX, minY, maxX, maxY], metres) in
 * a view of `view`'s size (metres at zoom 1): centred, as large as fits within
 * the camera's zoom limits, never turned or shaken.
 */
export function sceneFitFrame(
  bounds: readonly [number, number, number, number],
  view: { width: number; height: number },
): CameraFrame {
  const [minX, minY, maxX, maxY] = bounds;
  const zoom = zoomToFit(maxX - minX, maxY - minY, view);
  return {
    position: boxCentre({ x: minX, y: minY }, { x: maxX, y: maxY }),
    zoom: Number.isFinite(zoom) && zoom > 0 ? clampZoom(zoom) : 1,
    rotation: 0,
  };
}
