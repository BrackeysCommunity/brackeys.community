import type { Store } from "@tanstack/store";
import { useSyncExternalStore } from "react";

import type { Pt, ShapeObj } from "../../../editor/index";
import type { GameStoreState } from "../../../index";
import { shapeOutline, type PathCommand } from "../../../scene/index";
import { roundLength } from "../../../scene/units";
import { useStoreValue } from "../../session/use-store-value";

/**
 * World to screen: `screen = world * scale + (tx, ty)`, in CSS px from the
 * canvas's corner. The world is in metres, so `scale` is screen px per metre.
 */
export type View = { width: number; height: number; scale: number; tx: number; ty: number };

type Camera = Pick<GameStoreState["camera"], "position" | "scale">;

/**
 * World to screen as the engine's camera draws it: `camera.scale` canvas px
 * per metre (the game's px per metre, the display scale and the zoom), the
 * camera's position at the canvas's centre. The game is sized to the window,
 * so the overlay is too.
 */
export function viewOf(camera: Camera, width: number, height: number): View {
  const { scale } = camera;
  return {
    width,
    height,
    scale,
    tx: width / 2 - camera.position.x * scale,
    ty: height / 2 - camera.position.y * scale,
  };
}

/** Screen px per metre for the camera now. */
export function viewScale(camera: Camera): number {
  return camera.scale;
}

function subscribeResize(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}
const windowWidth = () => window.innerWidth;
const windowHeight = () => window.innerHeight;

/** The game camera's view, following the store and the window. */
export function useView(store: Store<GameStoreState>): View {
  const [x, y, scale] = useStoreValue(
    store,
    (s) => [s.camera.position.x, s.camera.position.y, s.camera.scale] as const,
  );
  const width = useSyncExternalStore(subscribeResize, windowWidth, () => 0);
  const height = useSyncExternalStore(subscribeResize, windowHeight, () => 0);
  return viewOf({ position: { x, y }, scale }, width, height);
}

/** A point entity's mark, in screen pixels. */
export const POINT_RADIUS_PX = 8;

/** A screen coordinate, to 1/100 px. */
export const num = (n: number) => Math.round(n * 100) / 100;

/** A world coordinate in metres, by the rounding rule lengths are written with. */
export const worldNum = roundLength;

/** A world point in screen px. */
export const toScreen = (view: View, [x, y]: Pt): Pt => [
  view.tx + x * view.scale,
  view.ty + y * view.scale,
];

/** Metres that come out as `px` on screen, for marks that keep a constant screen size. */
export const worldPx = (view: View, px: number) => px / (view.scale || 1);

/** The group transform that draws world coordinates in screen space. */
export const worldTransform = (view: View) =>
  `translate(${num(view.tx)} ${num(view.ty)}) scale(${view.scale})`;

/** SVG path data for an outline; arcs are split so none sweeps more than half a turn. */
export function outlinePath(commands: readonly PathCommand[]): string {
  const out: string[] = [];
  for (const c of commands) {
    switch (c.op) {
      case "moveTo":
        out.push(`M${worldNum(c.x)} ${worldNum(c.y)}`);
        break;
      case "lineTo":
        out.push(`L${worldNum(c.x)} ${worldNum(c.y)}`);
        break;
      case "arc": {
        const steps = Math.max(1, Math.ceil(Math.abs(c.end - c.start) / Math.PI));
        for (let i = 1; i <= steps; i++) {
          const a = c.start + ((c.end - c.start) * i) / steps;
          const sweep = c.end >= c.start ? 1 : 0;
          out.push(
            `A${worldNum(c.r)} ${worldNum(c.r)} 0 0 ${sweep} ${worldNum(c.cx + c.r * Math.cos(a))} ${worldNum(c.cy + c.r * Math.sin(a))}`,
          );
        }
        break;
      }
      case "close":
        out.push("Z");
        break;
    }
  }
  return out.join(" ");
}

/** A shape's outline as SVG path data. */
export const shapePath = (shape: ShapeObj) => outlinePath(shapeOutline(shape));

/** SVG path data through `pts`, closed back to the first when `closed`. */
export function polylinePath(pts: readonly (readonly [number, number])[], closed = false): string {
  if (pts.length === 0) return "";
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${worldNum(x)} ${worldNum(y)}`).join(" ");
  return closed ? `${d} Z` : d;
}
