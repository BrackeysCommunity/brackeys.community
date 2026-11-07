import type { Container } from "pixi.js";

import { clampVec2, lerpVec2 } from "./math";
import type { Bounds } from "./scene/types";
import type { CameraConfig, CameraMode, CameraState, Vec2 } from "./types";
import { VIRTUAL_HEIGHT } from "./types";

/** World units the camera may show past each edge of a scene's bounds. */
export const CAMERA_SCENE_MARGIN = 100;

export type Viewport = { x: number; y: number; width: number; height: number };

export type Camera = {
  /** In `follow` mode eases toward `target` (`null` holds); in `free` mode holds. Either way it stays inside the bounds. */
  update: (dt: number, target: Vec2 | null) => void;
  getPosition: () => Vec2;
  getViewport: () => Viewport;
  getDisplayScale: () => number;
  getState: () => CameraState;
  /** Canvas pixels to world units, honouring zoom and position. The engine's only screen-to-world conversion. */
  screenToWorld: (screen: Vec2) => Vec2;
  /** Jumps to `p` (`null`: the bounds' center) and moves the view now, without easing. */
  snapTo: (p: Vec2 | null) => void;
  /** Moves the camera to `p`, clamped to the bounds; the view follows on the next `update`. */
  setPosition: (p: Vec2) => void;
  setMode: (mode: CameraMode) => void;
  setBounds: (min: Vec2, max: Vec2) => void;
  setBoundsFromScene: (bounds: Bounds, margin?: number) => void;
  setZoom: (zoom: number) => void;
  resize: (displayWidth: number, displayHeight: number) => void;
  destroy: () => void;
};

export function createCamera(
  worldContainer: Container,
  displayWidth: number,
  displayHeight: number,
  config: CameraConfig,
): Camera {
  let position: Vec2 = { x: 0, y: 0 };
  let zoom = 1;
  let mode: CameraMode = "follow";
  let bounds = { min: { ...config.bounds.min }, max: { ...config.bounds.max } };

  // Expand-viewport scaling: height is anchored to VIRTUAL_HEIGHT,
  // width expands based on display aspect ratio.
  let displayScale = displayHeight / VIRTUAL_HEIGHT;
  let viewW = displayWidth / displayScale;
  let viewH = VIRTUAL_HEIGHT;

  function recomputeScale(dw: number, dh: number): void {
    displayScale = dh / VIRTUAL_HEIGHT;
    viewW = dw / displayScale;
    viewH = VIRTUAL_HEIGHT;
  }

  function clampToBounds(p: Vec2): Vec2 {
    const halfW = viewW / (2 * zoom);
    const halfH = viewH / (2 * zoom);
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
    // Scale maps game units to display pixels.
    const effectiveScale = displayScale * zoom;
    worldContainer.position.set(
      -position.x * effectiveScale + (displayScale * viewW) / 2,
      -position.y * effectiveScale + (displayScale * viewH) / 2,
    );
    worldContainer.scale.set(effectiveScale);
  }

  function update(_dt: number, target: Vec2 | null): void {
    if (target && mode === "follow") position = lerpVec2(position, target, config.lerpSpeed);
    apply();
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
      bounds: { min: { ...bounds.min }, max: { ...bounds.max } },
      mode,
    };
  }

  function screenToWorld(screen: Vec2): Vec2 {
    const vp = getViewport();
    const scale = displayScale * zoom;
    return { x: vp.x + screen.x / scale, y: vp.y + screen.y / scale };
  }

  function snapTo(p: Vec2 | null): void {
    position = p ? { ...p } : boundsCenter();
    apply();
  }

  function setPosition(p: Vec2): void {
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
    getState,
    screenToWorld,
    snapTo,
    setPosition,
    setMode,
    setBounds,
    setBoundsFromScene,
    setZoom,
    resize,
    destroy,
  };
}
