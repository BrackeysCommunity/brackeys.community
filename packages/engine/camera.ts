import type { Container } from "pixi.js";

import type { CameraFrame } from "./camera/rig";
import { DEFAULT_LENGTH_UNIT } from "./game/defaults";
import { clampVec2, lerpVec2 } from "./math";
import { DEFAULT_RESOLUTION, viewportFor, type ResolutionPolicy } from "./resolution";
import type { Bounds } from "./scene/types";
import type { CameraConfig, CameraMode, CameraState, Vec2 } from "./types";

/** Metres the camera may show past each edge of a scene's bounds. */
export const CAMERA_SCENE_MARGIN = 1;

/** The world area in view, metres. */
export type Viewport = { x: number; y: number; width: number; height: number };

export type Camera = {
  /**
   * In `follow` mode eases toward `target` (`null` holds) with the view inside
   * the bounds; in `free` mode holds, with the view only kept from leaving
   * the bounds entirely, so a zoom about any point over them keeps it put.
   */
  update: (dt: number, target: Vec2 | null) => void;
  getPosition: () => Vec2;
  getViewport: () => Viewport;
  /** Canvas px per world metre at zoom 1: the game's px per metre times the policy's scale. */
  getDisplayScale: () => number;
  /** The game's px per metre: world metres to the resolution's virtual px. */
  getPxPerMetre: () => number;
  getState: () => CameraState;
  /** Canvas px to world metres, honouring zoom and position. The engine's only screen-to-world conversion. */
  screenToWorld: (screen: Vec2) => Vec2;
  /** World metres to canvas px: `screenToWorld`'s inverse. */
  worldToScreen: (world: Vec2) => Vec2;
  /** Jumps to `p` (`null`: the bounds' center) and moves the view now, without easing. */
  snapTo: (p: Vec2 | null) => void;
  /**
   * Places the view where a camera rig framed it this frame: position, zoom
   * and turn, applied now. The rig keeps its own bounds, so the frame isn't
   * clamped; the next `update`, `snapTo` or `setPosition` drops the turn.
   */
  setFrame: (frame: CameraFrame) => void;
  /** Moves the camera to `p`, clamped to the bounds; the view follows on the next `update`. */
  setPosition: (p: Vec2) => void;
  setMode: (mode: CameraMode) => void;
  setBounds: (min: Vec2, max: Vec2) => void;
  setBoundsFromScene: (bounds: Bounds, margin?: number) => void;
  setZoom: (zoom: number) => void;
  resize: (displayWidth: number, displayHeight: number) => void;
  destroy: () => void;
};

/**
 * The view is the policy's viewport, centred on the canvas; under
 * `pixelSnap` the world lands on whole canvas px. Positions, bounds and the
 * viewport are world metres; `pxPerMetre` (the game's `world.lengthUnit`)
 * turns them into the policy's virtual px, so `worldContainer` maps metres
 * to canvas px.
 */
export function createCamera(
  worldContainer: Container,
  displayWidth: number,
  displayHeight: number,
  config: CameraConfig,
  resolution: ResolutionPolicy = DEFAULT_RESOLUTION,
  pxPerMetre: number = DEFAULT_LENGTH_UNIT,
): Camera {
  let position: Vec2 = { x: 0, y: 0 };
  let zoom = 1;
  /** Radians, set only by a rig's frame (a shake's turn). */
  let rotation = 0;
  let mode: CameraMode = "follow";
  let bounds = { min: { ...config.bounds.min }, max: { ...config.bounds.max } };

  /** Canvas px per metre at zoom 1. */
  let displayScale = 1;
  /** The policy's view, metres. */
  let viewW = 0;
  let viewH = 0;
  let offset: Vec2 = { x: 0, y: 0 };
  recomputeScale(displayWidth, displayHeight);

  function recomputeScale(dw: number, dh: number): void {
    const vp = viewportFor(resolution, { width: dw, height: dh });
    displayScale = vp.scale * pxPerMetre;
    viewW = vp.view.width / pxPerMetre;
    viewH = vp.view.height / pxPerMetre;
    offset = vp.offset;
  }

  function clampToBounds(p: Vec2): Vec2 {
    const halfW = viewW / (2 * zoom);
    const halfH = viewH / (2 * zoom);
    if (mode === "free") {
      return clampVec2(
        p,
        { x: bounds.min.x - halfW, y: bounds.min.y - halfH },
        { x: bounds.max.x + halfW, y: bounds.max.y + halfH },
      );
    }
    const worldW = bounds.max.x - bounds.min.x;
    const worldH = bounds.max.y - bounds.min.y;
    const center = boundsCenter();

    const clampMin = {
      x: worldW <= viewW / zoom ? center.x : bounds.min.x + halfW,
      y: worldH <= viewH / zoom ? center.y : bounds.min.y + halfH,
    };
    const clampMax = {
      x: worldW <= viewW / zoom ? center.x : bounds.max.x - halfW,
      y: worldH <= viewH / zoom ? center.y : bounds.max.y - halfH,
    };
    return clampVec2(p, clampMin, clampMax);
  }

  function boundsCenter(): Vec2 {
    return { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 };
  }

  function apply(): void {
    position = clampToBounds(position);
    place();
  }

  /** Moves the world container so `position` sits at the view's centre, turned by `rotation`. */
  function place(): void {
    const effectiveScale = displayScale * zoom;
    const cx = offset.x + (displayScale * viewW) / 2;
    const cy = offset.y + (displayScale * viewH) / 2;
    let x = -position.x * effectiveScale + cx;
    let y = -position.y * effectiveScale + cy;
    if (rotation !== 0) {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const px = position.x * effectiveScale;
      const py = position.y * effectiveScale;
      x = cx - (px * cos - py * sin);
      y = cy - (px * sin + py * cos);
    }
    if (resolution.pixelSnap) worldContainer.position.set(Math.round(x), Math.round(y));
    else worldContainer.position.set(x, y);
    worldContainer.rotation = rotation;
    worldContainer.scale.set(effectiveScale);
  }

  function update(_dt: number, target: Vec2 | null): void {
    rotation = 0;
    if (target && mode === "follow") position = lerpVec2(position, target, config.lerpSpeed);
    apply();
  }

  function setFrame(frame: CameraFrame): void {
    position = { x: frame.position.x, y: frame.position.y };
    setZoom(frame.zoom);
    rotation = frame.rotation;
    place();
  }

  /** `d`, a canvas-px offset from the view's centre, turned back by the view's turn. */
  function unturn(d: Vec2): Vec2 {
    if (rotation === 0) return d;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return { x: d.x * cos + d.y * sin, y: -d.x * sin + d.y * cos };
  }

  function turn(d: Vec2): Vec2 {
    if (rotation === 0) return d;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return { x: d.x * cos - d.y * sin, y: d.x * sin + d.y * cos };
  }

  function getPosition(): Vec2 {
    return { ...position };
  }

  function getViewport(): Viewport {
    const halfW = viewW / (2 * zoom);
    const halfH = viewH / (2 * zoom);
    return {
      x: position.x - halfW,
      y: position.y - halfH,
      width: viewW / zoom,
      height: viewH / zoom,
    };
  }

  function getDisplayScale(): number {
    return displayScale;
  }

  function getState(): CameraState {
    return {
      position: { ...position },
      zoom,
      scale: displayScale * zoom,
      bounds: { min: { ...bounds.min }, max: { ...bounds.max } },
      mode,
    };
  }

  function screenToWorld(screen: Vec2): Vec2 {
    const scale = displayScale * zoom;
    if (rotation !== 0) {
      const cx = offset.x + (displayScale * viewW) / 2;
      const cy = offset.y + (displayScale * viewH) / 2;
      const d = unturn({ x: screen.x - cx, y: screen.y - cy });
      return { x: position.x + d.x / scale, y: position.y + d.y / scale };
    }
    const vp = getViewport();
    return { x: vp.x + (screen.x - offset.x) / scale, y: vp.y + (screen.y - offset.y) / scale };
  }

  function worldToScreen(world: Vec2): Vec2 {
    const scale = displayScale * zoom;
    if (rotation !== 0) {
      const cx = offset.x + (displayScale * viewW) / 2;
      const cy = offset.y + (displayScale * viewH) / 2;
      const d = turn({ x: (world.x - position.x) * scale, y: (world.y - position.y) * scale });
      return { x: cx + d.x, y: cy + d.y };
    }
    const vp = getViewport();
    return { x: (world.x - vp.x) * scale + offset.x, y: (world.y - vp.y) * scale + offset.y };
  }

  function snapTo(p: Vec2 | null): void {
    rotation = 0;
    position = p ? { ...p } : boundsCenter();
    apply();
  }

  function setPosition(p: Vec2): void {
    rotation = 0;
    position = clampToBounds(p);
  }

  function setMode(m: CameraMode): void {
    mode = m;
  }

  function setBounds(min: Vec2, max: Vec2): void {
    bounds = { min: { ...min }, max: { ...max } };
  }

  function setBoundsFromScene(
    [minX, minY, maxX, maxY]: Bounds,
    margin: number = CAMERA_SCENE_MARGIN,
  ): void {
    setBounds({ x: minX - margin, y: minY - margin }, { x: maxX + margin, y: maxY + margin });
  }

  function setZoom(z: number): void {
    zoom = Math.max(0.1, Math.min(5, z));
  }

  function resize(dw: number, dh: number): void {
    recomputeScale(dw, dh);
  }

  function destroy(): void {
    // No resources to release
  }

  return {
    update,
    getPosition,
    getViewport,
    getDisplayScale,
    getPxPerMetre: () => pxPerMetre,
    getState,
    screenToWorld,
    worldToScreen,
    snapTo,
    setFrame,
    setPosition,
    setMode,
    setBounds,
    setBoundsFromScene,
    setZoom,
    resize,
    destroy,
  };
}
