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
 * Validates: cooldown, max per round, position within the scene bounds.
 * For now, single-player only (no server validation).
 */

import { Graphics, type Container } from "pixi.js";

import { addToLayer } from "../context";
import type { GrappleAnchorSystem } from "../entities/grapple-anchor";
import {
  type ConstructSystem,
  type ConstructType,
  CONSTRUCT_CONFIGS,
} from "../entities/shaper-constructs";
import type { Bounds } from "../scene/types";
import type { Vec2 } from "../types";

// ─── Placement validation ────────────────────────────────

export type PlacementValidation = {
  valid: boolean;
  reason?: string;
};

const PLACEMENT_COOLDOWN_MS = 500; // ms between placements

export function validatePlacement(
  type: ConstructType,
  position: Vec2,
  placedCounts: Record<ConstructType, number>,
  lastPlacementTimeMs: number,
  currentTimeMs: number,
  bounds: Bounds,
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

  const [minX, minY, maxX, maxY] = bounds;
  if (position.x < minX || position.x > maxX || position.y < minY || position.y > maxY) {
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
  /** Placement preview — call each tick with world-space mouse position */
  updatePreview: (mouseWorldPos: Vec2, dtMs: number) => void;
  /** Attempt to place at current preview position */
  place: () => PlacementValidation;
  /** Rotate preview (scroll wheel delta) */
  rotatePreview: (delta: number) => void;
  /** Ids of the constructs placed this round */
  getPlacedConstructs: () => readonly string[];
  /** Remove everything placed this round; the scene's own constructs stay */
  clearAll: () => void;
  destroy: () => void;
};

export type ShaperDeps = {
  view: Container | null;
  constructs: ConstructSystem;
  anchors: GrappleAnchorSystem;
  bounds: Bounds;
};

export function createShaperSystem({
  view,
  constructs,
  anchors,
  bounds,
}: ShaperDeps): ShaperSystem {
  let active = false;
  let selectedType: ConstructType | null = null;
  let previewRotation = 0;
  let previewPos: Vec2 = { x: 0, y: 0 };
  let lastPlacementTimeMs = -Infinity;
  let elapsedMs = 0;

  const placedConstructs: string[] = [];
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
  if (view) addToLayer(view, previewGfx, "preview");

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
      bounds,
    );
    if (!validation.valid) return validation;

    placedConstructs.push(constructs.place(selectedType, previewPos, previewRotation));
    placedCounts[selectedType]++;

    lastPlacementTimeMs = elapsedMs;
    return { valid: true };
  }

  function getPlacedConstructs(): readonly string[] {
    return placedConstructs;
  }

  function clearAll(): void {
    placedConstructs.length = 0;
    for (const key of Object.keys(placedCounts)) {
      placedCounts[key as ConstructType] = 0;
    }
    constructs.clearRuntime();
    anchors.clearRuntime();
  }

  function destroy(): void {
    previewGfx.destroy();
  }

  return {
    isActive: isActiveMode,
    setActive,
    getSelectedType,
    selectType,
    clearSelection,
    updatePreview(mouseWorldPos: Vec2, dtMs: number) {
      elapsedMs += dtMs;
      updatePreview(mouseWorldPos);
    },
    place,
    rotatePreview,
    getPlacedConstructs,
    clearAll,
    destroy,
  };
}
