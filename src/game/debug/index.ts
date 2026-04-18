import type { Store } from "@tanstack/store";
import type { Container } from "pixi.js";

import type { Camera } from "../camera";
import type { PhysicsWorld } from "../physics";
import { setDebugMode } from "../store";
import type { DebugMode, GameStoreState, Vec2 } from "../types";
import { createDebugPanel, type DebugPanel } from "./debug-panel";
import { createGridOverlay, type GridOverlay } from "./grid-overlay";
import { createJumpArcOverlay, type JumpArcOverlay } from "./jump-arc";
import { createPhysicsWireframes, type PhysicsWireframes } from "./physics-wireframes";
import { createPlayerScaleRef, type PlayerScaleRef } from "./player-scale";

export type PlayerDebugState = {
  position: Vec2;
  velocity: Vec2;
  grounded: boolean;
  holdingJump: boolean;
  holdingMove: boolean;
  wallSliding: boolean;
  wallDirection: -1 | 0 | 1;
  /** State before this tick's update — used for arc freeze origin */
  preUpdate: {
    position: Vec2;
    velocity: Vec2;
    grounded: boolean;
  };
};

export type DebugOverlay = {
  update: (dt: number, player: PlayerDebugState, mouseWorldPos: Vec2) => void;
  destroy: () => void;
};

type DebugDeps = {
  worldContainer: Container;
  uiContainer: Container;
  camera: Camera;
  store: Store<GameStoreState>;
  physics: PhysicsWorld;
  inputTarget: HTMLElement | Window;
};

/**
 * Creates the debug overlay system. Returns null in production builds.
 * All sub-systems are gated behind `import.meta.env.DEV`.
 */
export function createDebugOverlay(deps: DebugDeps): DebugOverlay | null {
  if (!import.meta.env.DEV) return null;

  const { worldContainer, uiContainer, camera, store, physics: physicsWorld, inputTarget } = deps;

  // ── Sub-systems ──────────────────────────────────
  let grid: GridOverlay | null = null;
  let playerScale: PlayerScaleRef | null = null;
  let jumpArc: JumpArcOverlay | null = null;
  let physics: PhysicsWireframes | null = null;
  let panel: DebugPanel | null = null;

  let currentMode: DebugMode = "off";

  function showGrid(): boolean {
    return currentMode !== "off";
  }
  function showPhysics(): boolean {
    return (
      currentMode === "grid+physics" || currentMode === "grid+physics+arcs" || currentMode === "all"
    );
  }
  function showArcs(): boolean {
    return currentMode === "grid+physics+arcs" || currentMode === "all";
  }
  function showPlayerScale(): boolean {
    return currentMode === "all";
  }

  // ── Lazy initialization of sub-systems ───────────

  function ensureGrid(): GridOverlay {
    if (!grid) {
      grid = createGridOverlay();
      // Insert at index 0 so grid is behind entities
      worldContainer.addChildAt(grid.container, 0);
    }
    return grid;
  }

  function ensurePlayerScale(): PlayerScaleRef {
    if (!playerScale) {
      playerScale = createPlayerScaleRef();
      worldContainer.addChild(playerScale.worldContainer);
      uiContainer.addChild(playerScale.uiContainer);
      // Position UI ref in the top-right area
      playerScale.uiContainer.position.set(
        uiContainer.parent ? (uiContainer.parent as Container).width - 100 : 700,
        0,
      );
    }
    return playerScale;
  }

  function ensureJumpArc(): JumpArcOverlay {
    if (!jumpArc) {
      jumpArc = createJumpArcOverlay();
      worldContainer.addChild(jumpArc.container);
    }
    return jumpArc;
  }

  function ensurePhysics(): PhysicsWireframes {
    if (!physics) {
      physics = createPhysicsWireframes(physicsWorld);
      worldContainer.addChild(physics.container);
    }
    return physics;
  }

  function applyMode(mode: DebugMode): void {
    currentMode = mode;
    setDebugMode(store, mode);

    if (showGrid()) {
      ensureGrid().setVisible(true);
    } else if (grid) {
      grid.setVisible(false);
    }

    if (showPhysics()) {
      ensurePhysics().setVisible(true);
    } else if (physics) {
      physics.setVisible(false);
    }

    if (showArcs()) {
      ensureJumpArc().setVisible(true);
    } else if (jumpArc) {
      jumpArc.setVisible(false);
    }

    if (showPlayerScale()) {
      ensurePlayerScale().setVisible(true);
    } else if (playerScale) {
      playerScale.setVisible(false);
    }
  }

  // ── Debug panel (keyboard toggle) ────────────────

  panel = createDebugPanel(inputTarget, applyMode);

  // ── Public API ───────────────────────────────────

  function update(_dt: number, player: PlayerDebugState, mouseWorldPos: Vec2): void {
    if (currentMode === "off") return;

    const viewport = camera.getViewport();

    if (showGrid() && grid) {
      grid.update(viewport);
    }

    if (showPhysics() && physics) {
      physics.update();
    }

    if (showArcs() && jumpArc) {
      jumpArc.update(player);
    }

    if (showPlayerScale() && playerScale) {
      playerScale.update(mouseWorldPos.x, mouseWorldPos.y);
    }
  }

  function destroy(): void {
    panel?.destroy();
    grid?.destroy();
    playerScale?.destroy();
    jumpArc?.destroy();
    physics?.destroy();

    panel = null;
    grid = null;
    playerScale = null;
    jumpArc = null;
    physics = null;
  }

  return { update, destroy };
}
