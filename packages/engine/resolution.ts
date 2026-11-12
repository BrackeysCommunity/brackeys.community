/**
 * How the world maps onto the canvas: what the camera shows, how it fits,
 * and how it samples. Its sizes are virtual px; the camera reaches them from
 * world metres through the game's px per metre (`world.lengthUnit`).
 */
export type ResolutionPolicy = {
  /** Virtual px the camera shows at zoom 1 on the fixed axis or axes. */
  virtual: { height: number } | { width: number } | { width: number; height: number };
  /**
   * expand: the fixed axis fills the canvas and the other shows more;
   * letterbox: the whole virtual area shows, bars fill the rest (needs width and height);
   * crop: the virtual area covers the canvas, the overflow is cut (needs width and height).
   */
  fit: "expand" | "letterbox" | "crop";
  /** Scale only by whole multiples (pixel art); bars take the remainder. */
  integer?: boolean;
  /** Default texture sampling; a texture's import `filter` wins. */
  sampling?: "linear" | "nearest";
  /** The renderer's antialiasing; changing it rebuilds the renderer. */
  antialias?: boolean;
  /** Round camera and visual positions to whole canvas pixels. */
  pixelSnap?: boolean;
  /** Bar colour, 0xRRGGBB; default the background. */
  bars?: number;
};

/** A fixed 1080 virtual px height (10.8 m at 100 px per metre), the width expanding with the canvas's aspect. */
export const DEFAULT_RESOLUTION: ResolutionPolicy = Object.freeze({
  virtual: Object.freeze({ height: 1080 }),
  fit: "expand",
  sampling: "linear",
  antialias: true,
});

export type ResolutionViewport = {
  /** Canvas px per virtual px at zoom 1. */
  scale: number;
  /** The area the camera shows at zoom 1, virtual px. */
  view: { width: number; height: number };
  /** Canvas px from the canvas's corner to the shown area's; the bars' size on each side. */
  offset: { x: number; y: number };
  /** Whether bars fill part of the canvas. */
  bars: boolean;
};

/** Below this many canvas px a bar is a rounding artefact, not a bar. */
const BAR_EPSILON = 1e-6;

/** Whole multiples from 1× up; below 1×, whole divisions, so the area still fits. */
function wholeScale(raw: number): number {
  return raw >= 1 ? Math.floor(raw) : 1 / Math.ceil(1 / raw);
}

/**
 * Pure: the virtual-to-canvas scale, the visible virtual size, the viewport's offset
 * and bars. The shown area is centred on the canvas. `letterbox` and `crop`
 * need a width and a height; given one, they fit as `expand` does. Under
 * `integer` the scale is a whole multiple and the fixed axes take bars for
 * the remainder; under `pixelSnap` the offset is whole canvas px.
 */
export function viewportFor(
  policy: ResolutionPolicy,
  canvas: { width: number; height: number },
): ResolutionViewport {
  const cw = Math.max(1, canvas.width);
  const ch = Math.max(1, canvas.height);
  const vw = "width" in policy.virtual ? policy.virtual.width : undefined;
  const vh = "height" in policy.virtual ? policy.virtual.height : undefined;
  const sx = vw === undefined ? Infinity : cw / vw;
  const sy = vh === undefined ? Infinity : ch / vh;
  const both = vw !== undefined && vh !== undefined;
  const fit = both ? policy.fit : "expand";

  // A fixed axis shows the virtual size (or less, under crop); a free one shows what the canvas has room for.
  const raw = fit === "crop" ? Math.max(sx, sy) : Math.min(sx, sy);
  const fixedX = fit !== "expand" || (vw !== undefined && sx <= sy);
  const fixedY = fit !== "expand" || (vh !== undefined && sy <= sx);
  const scale = policy.integer ? wholeScale(raw) : raw;
  const shown = (fixed: boolean, virtual: number | undefined, canvasPx: number) => {
    if (!fixed || virtual === undefined) return canvasPx / scale;
    return fit === "crop" ? Math.min(virtual, canvasPx / scale) : virtual;
  };
  const width = shown(fixedX, vw, cw);
  const height = shown(fixedY, vh, ch);
  const gap = (canvasPx: number, shownPx: number) => {
    const g = (canvasPx - shownPx) / 2;
    if (g <= BAR_EPSILON) return 0;
    return policy.pixelSnap ? Math.floor(g) : g;
  };
  const offset = { x: gap(cw, width * scale), y: gap(ch, height * scale) };
  return {
    scale,
    view: { width, height },
    offset,
    bars: offset.x > 0 || offset.y > 0,
  };
}

const POLICY_FIELDS = [
  "virtual",
  "fit",
  "integer",
  "sampling",
  "antialias",
  "pixelSnap",
  "bars",
] as const satisfies readonly (keyof ResolutionPolicy)[];

/**
 * The policy in force, field by field: the host's, then the project's, then
 * the game's, then `DEFAULT_RESOLUTION`. `virtual` is taken whole.
 */
export function resolveResolution(sources: {
  host?: Partial<ResolutionPolicy>;
  project?: Partial<ResolutionPolicy>;
  game?: Partial<ResolutionPolicy>;
}): ResolutionPolicy {
  const order = [sources.host, sources.project, sources.game, DEFAULT_RESOLUTION];
  const out: Record<string, unknown> = {};
  for (const field of POLICY_FIELDS) {
    const from = order.find((s) => s?.[field] !== undefined);
    const value = from?.[field];
    if (value !== undefined) out[field] = field === "virtual" ? { ...(value as object) } : value;
  }
  return out as ResolutionPolicy;
}
