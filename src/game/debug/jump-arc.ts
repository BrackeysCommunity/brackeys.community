import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { Vec2 } from "../types";
import type { PlayerDebugState } from "./index";
import { JUMP_VELOCITY, GRAVITY, MAX_FALL_SPEED } from "../entities/player";

const ARC_SAMPLES = 120;

const ARC_COLOR_LIVE = 0x00ff88; // green — live directional arc
const ARC_COLOR_STANDING = 0xffff00; // yellow — standing jump (vertical only)
const ARC_COLOR_FROZEN = 0xff4444; // red — frozen arc during airborne
const ARC_ALPHA = 0.5;
const ARC_ALPHA_FROZEN = 0.35;
const ARC_WIDTH = 2;

const LABEL_STYLE = new TextStyle({
  fontFamily: "monospace",
  fontSize: 9,
  fill: 0xffffff,
});

export type JumpArcOverlay = {
  update: (player: PlayerDebugState) => void;
  setVisible: (visible: boolean) => void;
  destroy: () => void;
  container: Container;
};

/**
 * Simulate a jump arc with constant horizontal speed.
 * Used for live (grounded) preview arcs — optimistic, assumes input held.
 */
export function computeJumpArc(
  startX: number,
  startY: number,
  horizontalSpeed: number,
  startVy: number = JUMP_VELOCITY,
  floorY?: number,
): Vec2[] {
  const floor = floorY ?? startY;
  const points: Vec2[] = [];
  let x = startX;
  let y = startY;
  let vy = startVy;
  const dt = 1 / 60;

  for (let i = 0; i < ARC_SAMPLES; i++) {
    points.push({ x, y });

    vy += GRAVITY * dt;
    if (vy > MAX_FALL_SPEED) vy = MAX_FALL_SPEED;
    x += horizontalSpeed * dt;
    y += vy * dt;

    if (y >= floor) {
      points.push({ x, y: floor });
      break;
    }
  }

  return points;
}

/**
 * Simulate a predicted arc from current state.
 * In air: preserve horizontal momentum (no decel), apply gravity + fall cap.
 */
function computeOptimisticArc(
  startX: number,
  startY: number,
  startVx: number,
  startVy: number,
  floorY: number,
): Vec2[] {
  const points: Vec2[] = [];
  let x = startX;
  let y = startY;
  const vx = startVx;
  let vy = startVy;
  const dt = 1 / 60;

  for (let i = 0; i < ARC_SAMPLES; i++) {
    points.push({ x, y });

    vy += GRAVITY * dt;
    if (vy > MAX_FALL_SPEED) vy = MAX_FALL_SPEED;
    x += vx * dt;
    y += vy * dt;

    if (y >= floorY) {
      points.push({ x, y: floorY });
      break;
    }
  }

  return points;
}

export function createJumpArcOverlay(): JumpArcOverlay {
  const container = new Container();
  container.label = "debug-jump-arcs";

  const frozenGraphics = new Graphics();
  const liveGraphics = new Graphics();
  container.addChild(frozenGraphics);
  container.addChild(liveGraphics);

  const heightLabel = new Text({ text: "", style: LABEL_STYLE });
  heightLabel.alpha = 0.6;
  container.addChild(heightLabel);

  const distLabel = new Text({ text: "", style: LABEL_STYLE });
  distLabel.alpha = 0.6;
  container.addChild(distLabel);

  // Frozen arc state
  let frozenLaunchPos: Vec2 | null = null;
  let frozenIsStandingJump = false;
  let actualTrail: Vec2[] = [];

  function drawArc(gfx: Graphics, points: Vec2[], color: number, alpha: number): void {
    if (points.length < 2) return;

    gfx.setStrokeStyle({ width: ARC_WIDTH, color, alpha });
    gfx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
      gfx.lineTo(points[i].x, points[i].y);
    }
    gfx.stroke();
  }

  function update(player: PlayerDebugState): void {
    const { position: playerPos, velocity: playerVel, grounded, holdingJump, preUpdate } = player;

    // ── Freeze/unfreeze logic ────────────────────────
    if (preUpdate.grounded && !grounded) {
      frozenLaunchPos = { ...preUpdate.position };
      frozenIsStandingJump = Math.abs(preUpdate.velocity.x) < 1;
      actualTrail = [{ ...preUpdate.position }];
    }

    // Record actual trail while airborne
    if (!grounded && frozenLaunchPos) {
      actualTrail.push({ ...playerPos });
    }

    if (!preUpdate.grounded && grounded) {
      frozenLaunchPos = null;
      actualTrail = [];
      frozenGraphics.clear();
    }

    // ── Frozen arc ──────────────────────────────────
    frozenGraphics.clear();
    if (frozenLaunchPos && !grounded) {
      // Standing jump only: frozen vertical jump line
      if (frozenIsStandingJump) {
        const vy = holdingJump ? JUMP_VELOCITY : playerVel.y;
        const standArc = computeJumpArc(
          frozenLaunchPos.x,
          frozenLaunchPos.y,
          0,
          vy,
          frozenLaunchPos.y,
        );
        drawArc(frozenGraphics, standArc, ARC_COLOR_FROZEN, ARC_ALPHA_FROZEN);
      }

      // Always: actual trail + optimistic predicted parabola
      if (actualTrail.length >= 2) {
        drawArc(frozenGraphics, actualTrail, ARC_COLOR_FROZEN, ARC_ALPHA_FROZEN);
      }

      const predicted = computeOptimisticArc(
        playerPos.x,
        playerPos.y,
        playerVel.x,
        playerVel.y,
        frozenLaunchPos.y,
      );
      if (predicted.length >= 2) {
        drawArc(frozenGraphics, predicted, ARC_COLOR_FROZEN, ARC_ALPHA_FROZEN * 0.7);
      }
    }

    // ── Live arcs (only when grounded) ───────────────
    liveGraphics.clear();
    heightLabel.text = "";
    distLabel.text = "";

    if (!grounded) return;

    const vx = playerVel.x;
    const absVx = Math.abs(vx);

    // Always draw the vertical jump line (max jump height) when grounded
    const standingArc = computeJumpArc(playerPos.x, playerPos.y, 0);
    drawArc(liveGraphics, standingArc, ARC_COLOR_STANDING, ARC_ALPHA);

    // Height label from standing arc
    let minY = playerPos.y;
    for (const p of standingArc) {
      if (p.y < minY) minY = p.y;
    }
    const maxHeight = Math.round(playerPos.y - minY);

    if (absVx < 1) {
      // Standing still — just the vertical line + height label
      heightLabel.text = `↑ ${maxHeight}`;
      heightLabel.position.set(playerPos.x + 8, minY - 4);
    } else {
      // Moving — add directional arc using actual velocity (optimistic: constant vx)
      const arc = computeJumpArc(playerPos.x, playerPos.y, vx);
      drawArc(liveGraphics, arc, ARC_COLOR_LIVE, ARC_ALPHA);

      const lastPt = arc[arc.length - 1];
      const maxDist = lastPt ? Math.round(Math.abs(lastPt.x - playerPos.x)) : 0;

      const movingRight = vx > 0;
      const labelOffsetX = movingRight ? 8 : -50;

      heightLabel.text = `↑ ${maxHeight}`;
      heightLabel.position.set(playerPos.x + labelOffsetX, minY - 4);

      const arrow = movingRight ? "→" : "←";
      distLabel.text = `${arrow} ${maxDist}`;
      distLabel.position.set(
        lastPt ? lastPt.x + (movingRight ? 4 : -50) : playerPos.x,
        playerPos.y + 4,
      );
    }
  }

  function setVisible(visible: boolean): void {
    container.visible = visible;
    if (!visible) {
      liveGraphics.clear();
      frozenGraphics.clear();
      heightLabel.text = "";
      distLabel.text = "";
      frozenLaunchPos = null;
      frozenIsStandingJump = false;
      actualTrail = [];
    }
  }

  function destroy(): void {
    liveGraphics.destroy();
    frozenGraphics.destroy();
    heightLabel.destroy();
    distLabel.destroy();
    container.destroy();
  }

  return { update, setVisible, destroy, container };
}
