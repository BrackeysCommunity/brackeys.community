/**
 * Shaper placement system — manages the Shaper's object placement flow.
 *
 * When in Shaper mode:
 *   - Number keys (1-6) select construct type
 *   - Mouse shows placement preview (ghost) at cursor
 *   - Scroll wheel rotates preview (for rotatable constructs)
 *   - Left click places the construct
 *   - Right click or Escape cancels selection
 *
 * Validates: cooldown, max per round, position within bounds.
 * For now, single-player only (no server validation).
 */

import { Graphics, type Container } from "pixi.js";

import type { GrappleAnchorSystem } from "../entities/grapple-anchor";
import {
  type ConstructType,
  type ShaperConstruct,
  CONSTRUCT_CONFIGS,
  createShaperConstruct,
  clearWindZones,
  clearBouncePads,
} from "../entities/shaper-constructs";
import type { PhysicsWorld } from "../physics";
import type { Vec2 } from "../types";

// ─── Placement validation ────────────────────────────────

export type PlacementValidation = {
  valid: boolean;
  reason?: string;
};

const PLACEMENT_COOLDOWN_MS = 500; // ms between placements
const MAP_BOUNDS = { minX: -2000, maxX: 4000, minY: -500, maxY: 1200 };

export function validatePlacement(
  type: ConstructType,
  position: Vec2,
  placedCounts: Record<ConstructType, number>,
  lastPlacementTimeMs: number,
  currentTimeMs: number,
): PlacementValidation {
  const config = CONSTRUCT_CONFIGS[type];

  // Cooldown
  if (currentTimeMs - lastPlacementTimeMs < PLACEMENT_COOLDOWN_MS) {
    const remaining =
      Math.ceil((PLACEMENT_COOLDOWN_MS - (currentTimeMs - lastPlacementTimeMs)) / 100) / 10;
    return { valid: false, reason: `Cooldown: ${remaining}s` };
  }

  // Max per round
  if ((placedCounts[type] ?? 0) >= config.maxPerRound) {
    return { valid: false, reason: `Max ${config.label}s reached (${config.maxPerRound})` };
  }

  // Bounds
  if (
    position.x < MAP_BOUNDS.minX ||
    position.x > MAP_BOUNDS.maxX ||
    position.y < MAP_BOUNDS.minY ||
    position.y > MAP_BOUNDS.maxY
  ) {
    return { valid: false, reason: "Out of bounds" };
  }

  return { valid: true };
}

// ─── Shaper system ───────────────────────────────────────

export type ShaperSystem = {
  /** Current mode: true = placing objects, false = runner control */
  isActive: () => boolean;
  setActive: (active: boolean) => void;
  /** Currently selected construct type */
  getSelectedType: () => ConstructType | null;
  selectType: (type: ConstructType) => void;
  clearSelection: () => void;
  /** Placement preview — call each frame with world-space mouse position */
  updatePreview: (mouseWorldPos: Vec2) => void;
  /** Attempt to place at current preview position */
  place: () => PlacementValidation;
  /** Rotate preview (scroll wheel delta) */
  rotatePreview: (delta: number) => void;
  /** Get all placed constructs */
  getPlacedConstructs: () => readonly ShaperConstruct[];
  /** Remove all placed constructs (round reset) */
  clearAll: () => void;
  destroy: () => void;
};

export function createShaperSystem(
  worldContainer: Container,
  physics: PhysicsWorld,
  grappleAnchors: GrappleAnchorSystem,
): ShaperSystem {
  let active = false;
  let selectedType: ConstructType | null = null;
  let previewRotation = 0;
  let previewPos: Vec2 = { x: 0, y: 0 };
  let lastPlacementTimeMs = -Infinity;
  let elapsedMs = 0;

  // Track placed objects
  const placedConstructs: ShaperConstruct[] = [];
  const placedCounts: Record<ConstructType, number> = {
    bridge: 0,
    bounce_pad: 0,
    wind_zone: 0,
    grapple_anchor: 0,
    light_orb: 0,
    shield_barrier: 0,
  };

  // Preview ghost graphic
  const previewGfx = new Graphics();
  previewGfx.visible = false;
  previewGfx.alpha = 0.4;
  worldContainer.addChild(previewGfx);

  function redrawPreview(): void {
    previewGfx.clear();
    if (!selectedType) {
      previewGfx.visible = false;
      return;
    }

    const config = CONSTRUCT_CONFIGS[selectedType];
    previewGfx.visible = true;

    if (selectedType === "grapple_anchor" || selectedType === "light_orb") {
      previewGfx.circle(0, 0, config.hw);
      previewGfx.fill({ color: config.color, alpha: 0.3 });
      previewGfx.stroke({ width: 2, color: config.color, alpha: 0.6 });
    } else {
      previewGfx.rect(-config.hw, -config.hh, config.hw * 2, config.hh * 2);
      previewGfx.fill({ color: config.color, alpha: 0.2 });
      previewGfx.stroke({ width: 1, color: config.color, alpha: 0.6 });
    }
  }

  function isActiveMode(): boolean {
    return active;
  }

  function setActive(a: boolean): void {
    active = a;
    if (!a) {
      previewGfx.visible = false;
    }
  }

  function getSelectedType(): ConstructType | null {
    return selectedType;
  }

  function selectType(type: ConstructType): void {
    selectedType = type;
    previewRotation = 0;
    redrawPreview();
  }

  function clearSelection(): void {
    selectedType = null;
    previewGfx.visible = false;
  }

  function updatePreview(mouseWorldPos: Vec2): void {
    previewPos = { ...mouseWorldPos };
    if (active && selectedType) {
      previewGfx.visible = true;
      previewGfx.position.set(mouseWorldPos.x, mouseWorldPos.y);
      previewGfx.rotation = previewRotation;
    } else {
      previewGfx.visible = false;
    }
  }

  function rotatePreview(delta: number): void {
    if (!selectedType) return;
    const config = CONSTRUCT_CONFIGS[selectedType];
    if (!config.rotatable) return;
    previewRotation += delta * 0.15; // ~8.6° per scroll notch
  }

  function place(): PlacementValidation {
    if (!selectedType) return { valid: false, reason: "No construct selected" };

    const validation = validatePlacement(
      selectedType,
      previewPos,
      placedCounts,
      lastPlacementTimeMs,
      elapsedMs,
    );
    if (!validation.valid) return validation;

    // Create the construct
    if (selectedType === "grapple_anchor") {
      // Grapple anchors are managed by the GrappleAnchorSystem
      grappleAnchors.add(previewPos);
      placedCounts.grapple_anchor++;
      // No ShaperConstruct entity needed — grapple system handles it
    } else {
      const construct = createShaperConstruct(
        selectedType,
        previewPos,
        previewRotation,
        worldContainer,
        physics,
      );
      placedConstructs.push(construct);
      placedCounts[selectedType]++;
    }

    lastPlacementTimeMs = elapsedMs;
    return { valid: true };
  }

  function getPlacedConstructs(): readonly ShaperConstruct[] {
    return placedConstructs;
  }

  function clearAll(): void {
    for (const c of placedConstructs) c.destroy();
    placedConstructs.length = 0;
    for (const key of Object.keys(placedCounts)) {
      placedCounts[key as ConstructType] = 0;
    }
    clearWindZones();
    clearBouncePads();
    grappleAnchors.clearAll();
  }

  function destroy(): void {
    clearAll();
    worldContainer.removeChild(previewGfx);
    previewGfx.destroy();
  }

  // Expose elapsed time update (called from engine tick)
  return {
    isActive: isActiveMode,
    setActive,
    getSelectedType,
    selectType,
    clearSelection,
    updatePreview(mouseWorldPos: Vec2) {
      elapsedMs += 1000 / 60; // approximate — TODO: pass dt properly
      updatePreview(mouseWorldPos);
    },
    place,
    rotatePreview,
    getPlacedConstructs,
    clearAll,
    destroy,
  };
}
