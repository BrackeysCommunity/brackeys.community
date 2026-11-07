import type { Vec2 } from "@jams/engine";

/** A rectangular area that accelerates the player while inside it. */
export type ForceZone = {
  center: Vec2;
  hw: number;
  hh: number;
  /** Radians. */
  rotation: number;
  /** Acceleration in game units/sec². */
  force: Vec2;
};

export type ForceFields = {
  add: (id: string, zone: ForceZone) => void;
  remove: (id: string) => void;
  /** Summed force of every zone containing `pos`. */
  sample: (pos: Vec2) => Vec2;
  clear: () => void;
  readonly size: number;
};

export function zoneContains(zone: ForceZone, pos: Vec2): boolean {
  const dx = pos.x - zone.center.x;
  const dy = pos.y - zone.center.y;
  const cos = Math.cos(zone.rotation);
  const sin = Math.sin(zone.rotation);
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  return Math.abs(lx) < zone.hw && Math.abs(ly) < zone.hh;
}

export function createForceFields(): ForceFields {
  const zones = new Map<string, ForceZone>();

  return {
    add(id, zone) {
      zones.set(id, { ...zone, center: { ...zone.center }, force: { ...zone.force } });
    },
    remove(id) {
      zones.delete(id);
    },
    sample(pos) {
      let x = 0;
      let y = 0;
      for (const zone of zones.values()) {
        if (!zoneContains(zone, pos)) continue;
        x += zone.force.x;
        y += zone.force.y;
      }
      return { x, y };
    },
    clear() {
      zones.clear();
    },
    get size() {
      return zones.size;
    },
  };
}
