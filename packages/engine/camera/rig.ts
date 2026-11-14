/**
 * The camera rig: a pure function of the previous frame, the frame's wall
 * time, the targets and the scene's camera regions. View-side only: game
 * code steers it through presentation requests and nothing reads it back.
 */
import { ease, type EaseName } from "../anim/ease";
import { boxCentre, clampViewInBox, clampZoom, zoomToFit } from "../camera";
import {
  DEFAULT_CAMERA_DAMPING,
  DEFAULT_CAMERA_SHAKE,
  DEFAULT_REGION_EASE,
} from "../game/defaults";
import { zodIssueText } from "../game/fields";
import { CAMERA_RIG_SCHEMA, type CameraRigDef } from "../game/primitives";
import { clamp, lerp, lerpVec2, smoothstep } from "../math";
import type { CameraRequest } from "../runtime/present";
import { viewRandom } from "../sim-kit/rng";
import type { Vec2 } from "../types";
import { regionFor, type CameraRegion } from "./regions";

export type { CameraRigDef } from "../game/primitives";

/** What a camera follows: an entity, a point, or a seat's targets from `cameraTargets()`. */
export type CameraTargetSpec =
  | { entity: string; weight?: number }
  | { point: Vec2; weight?: number }
  | { player: number };

/** Where the camera looks this frame, world metres. */
export type CameraFrame = { position: Vec2; zoom: number; rotation: number };

/** One frame's input to the rig. */
export type RigInput = {
  dtMs: number;
  targets: readonly { at: Vec2; velocity: Vec2; weight: number }[];
  regions: readonly CameraRegion[];
  /** The view's size, world metres at zoom 1. */
  view: { width: number; height: number };
  bounds: { min: Vec2; max: Vec2 };
  /** View px per world metre at zoom 1 (the game's px per metre): what the shake's px offset is measured in. */
  pxPerMetre: number;
  reducedMotion: boolean;
};

export interface CameraRig {
  update(input: RigInput): CameraFrame;
  request(op: CameraRequest): void;
  readonly trauma: number;
  /** What a `follow` request put in place of the targets; null after `follow(null)` or none. */
  readonly following: CameraTargetSpec | null;
}

export { DEFAULT_CAMERA_DAMPING, DEFAULT_CAMERA_SHAKE };

/** Why `def` can't be a camera rig's settings, or null when it can. */
export function cameraRigProblem(def: unknown): string | null {
  const parsed = CAMERA_RIG_SCHEMA.safeParse(def);
  return parsed.success ? null : zodIssueText(parsed.error);
}

type Transition = { from: Vec2; fromZoom: number; elapsed: number; seconds: number };
type ZoomEase = { from: number; to: number; ms: number; elapsed: number; ease?: EaseName };

const finitePoint = (p: Vec2) => Number.isFinite(p.x) && Number.isFinite(p.y);

/** Whether the rig can take `op`: a number it carries that isn't finite (or a zoom that isn't positive) can't be shown. */
function usable(op: CameraRequest): boolean {
  switch (op.op) {
    case "follow":
      return op.target === null || !("point" in op.target) || finitePoint(op.target.point);
    case "zoom":
      return (
        Number.isFinite(op.zoom) && op.zoom > 0 && (op.ms === undefined || Number.isFinite(op.ms))
      );
    case "shake":
      return Number.isFinite(op.trauma);
    case "snap":
      return op.at === undefined || finitePoint(op.at);
  }
}

/**
 * The weighted centre and velocity of the targets, skipping any whose
 * weight isn't positive; null when none is left.
 */
export function centreOf(targets: RigInput["targets"]): { at: Vec2; velocity: Vec2 } | null {
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  let total = 0;
  for (const t of targets) {
    if (!(t.weight > 0)) continue;
    x += t.at.x * t.weight;
    y += t.at.y * t.weight;
    vx += t.velocity.x * t.weight;
    vy += t.velocity.y * t.weight;
    total += t.weight;
  }
  if (total <= 0) return null;
  return { at: { x: x / total, y: y / total }, velocity: { x: vx / total, y: vy / total } };
}

/** The zoom that keeps every target, plus `padding`, in a view of `view`'s size. */
function fitZoom(targets: RigInput["targets"], view: RigInput["view"], padding: number): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of targets) {
    minX = Math.min(minX, t.at.x);
    minY = Math.min(minY, t.at.y);
    maxX = Math.max(maxX, t.at.x);
    maxY = Math.max(maxY, t.at.y);
  }
  return zoomToFit(maxX - minX + 2 * padding, maxY - minY + 2 * padding, view);
}

/** A rig for `def`; `seed` (the scene's name) seeds its shake. */
export function createCameraRig(def: CameraRigDef, seed: string): CameraRig {
  const damping = def.damping ?? DEFAULT_CAMERA_DAMPING;
  const [deadW, deadH] = def.deadzone ?? [0, 0];
  const lookAhead = def.lookAhead ?? 0;
  const shake = def.shake ?? DEFAULT_CAMERA_SHAKE;
  const random = viewRandom(seed);
  /** -1 to 1 from the view's own stream. */
  const signed = () => random.between(-1, 1);

  let position: Vec2 | null = null;
  let zoom = 1;
  let baseZoom = 1;
  let zoomEase: ZoomEase | null = null;
  let trauma = 0;
  let following: CameraTargetSpec | null = null;
  let snap: { at?: Vec2 } | null = null;
  let region: CameraRegion | null = null;
  let transition: Transition | null = null;

  function advanceZoom(dtMs: number): void {
    if (!zoomEase) return;
    zoomEase.elapsed += dtMs;
    const t = zoomEase.ms > 0 ? Math.min(1, zoomEase.elapsed / zoomEase.ms) : 1;
    const k = zoomEase.ease ? ease(zoomEase.ease, t) : t;
    baseZoom = lerp(zoomEase.from, zoomEase.to, k);
    if (t >= 1) {
      baseZoom = zoomEase.to;
      zoomEase = null;
    }
  }

  function goalZoom(input: RigInput, framing: CameraRegion | null): number {
    let z = framing?.zoom ?? baseZoom;
    if (def.fit && input.targets.length >= 2) {
      z = Math.min(z, fitZoom(input.targets, input.view, def.fit.padding));
      z = clamp(z, def.fit.minZoom, def.fit.maxZoom);
    }
    // The zoom the camera will apply, so the view's clamp is sized from the view it shows.
    return clampZoom(z);
  }

  /** The point the camera heads for: the targets' centre led by their velocity, capped at `maxLead`. */
  function focusOf(centre: { at: Vec2; velocity: Vec2 }): Vec2 {
    let lx = centre.velocity.x * lookAhead;
    let ly = centre.velocity.y * lookAhead;
    if (def.maxLead !== undefined) {
      const len = Math.sqrt(lx * lx + ly * ly);
      if (len > def.maxLead && len > 0) {
        lx *= def.maxLead / len;
        ly *= def.maxLead / len;
      }
    }
    return { x: centre.at.x + lx, y: centre.at.y + ly };
  }

  /** How far the camera moves toward `focus`: only past the deadzone's edge. */
  function deadzoned(from: Vec2, focus: Vec2): Vec2 {
    const axis = (cam: number, f: number, half: number) => {
      const d = f - cam;
      if (Math.abs(d) <= half) return cam;
      return d > 0 ? f - half : f + half;
    };
    return { x: axis(from.x, focus.x, deadW / 2), y: axis(from.y, focus.y, deadH / 2) };
  }

  function update(input: RigInput): CameraFrame {
    const dtMs = Math.max(0, input.dtMs);
    const dt = dtMs / 1000;
    advanceZoom(dtMs);

    const framing = regionFor(input.targets, input.regions);
    const z = goalZoom(input, framing);
    const half = { x: input.view.width / (2 * z), y: input.view.height / (2 * z) };
    const box = framing && framing.clamp ? framing : input.bounds;
    const centre = centreOf(input.targets);
    const focus = centre ? focusOf(centre) : null;

    if (position === null || snap) {
      const at = snap?.at ?? focus ?? position ?? boxCentre(input.bounds.min, input.bounds.max);
      position = clampViewInBox(at, half, box.min, box.max);
      zoom = z;
      snap = null;
      transition = null;
      region = framing;
    } else {
      if ((framing?.id ?? null) !== (region?.id ?? null)) {
        const seconds = (framing ?? region)?.ease ?? DEFAULT_REGION_EASE;
        transition = { from: position, fromZoom: zoom, elapsed: 0, seconds };
        region = framing;
      }
      const desired = focus ? deadzoned(position, focus) : position;
      const k = damping > 0 ? 1 - Math.pow(0.5, dt / damping) : 1;
      const damped = lerpVec2(position, desired, k);
      const framed = clampViewInBox(damped, half, box.min, box.max);
      if (transition) {
        transition.elapsed += dt;
        const t = transition.seconds > 0 ? Math.min(1, transition.elapsed / transition.seconds) : 1;
        const s = smoothstep(t);
        position = t >= 1 ? framed : lerpVec2(transition.from, framed, s);
        zoom = t >= 1 ? z : lerp(transition.fromZoom, z, s);
        if (t >= 1) transition = null;
      } else {
        position = framed;
        zoom = z;
      }
    }

    let offset: Vec2 = { x: 0, y: 0 };
    let rotation = 0;
    if (input.reducedMotion) trauma = 0;
    if (trauma > 0) {
      const amount = trauma * trauma;
      const metres = (amount * shake.maxOffset) / (input.pxPerMetre * zoom);
      offset = { x: metres * signed(), y: metres * signed() };
      rotation = amount * shake.maxTurn * signed();
      trauma = Math.max(0, trauma - shake.decay * dt);
    }
    return {
      position: { x: position.x + offset.x, y: position.y + offset.y },
      zoom,
      rotation,
    };
  }

  function request(op: CameraRequest): void {
    if (!usable(op)) return;
    switch (op.op) {
      case "follow":
        following = op.target;
        break;
      case "zoom":
        zoomEase = {
          from: baseZoom,
          to: op.zoom,
          ms: op.ms ?? 0,
          elapsed: 0,
          ...(op.ease ? { ease: op.ease } : {}),
        };
        if (!(zoomEase.ms > 0)) advanceZoom(0);
        break;
      case "shake":
        trauma = clamp(trauma + op.trauma, 0, 1);
        break;
      case "snap":
        snap = op.at ? { at: { x: op.at.x, y: op.at.y } } : {};
        break;
    }
  }

  return {
    update,
    request,
    get trauma() {
      return trauma;
    },
    get following() {
      return following;
    },
  };
}
