import { amount } from "./units.ts";

/** Who placed or staged a thing, as the wire carries it (`api.Placed`). */
export interface PlacedBy {
  by: string;
  label: string;
  points?: number;
}

/** Where staged goods or an item were staged, as the wire carries it (`api.StagedAt`). */
export interface StagedWhere {
  settlement: number;
  name: string;
}

function byLine(verb: string, p: PlacedBy): string {
  if (p.by !== "staff") return `${verb} by the admins of ${p.label}`;
  return `${verb} by staff of ${p.label}${p.points ? ` · ${amount(p.points, "event points")}` : ""}`;
}

/** How a staged place names who placed it (GDD 14.5). */
export function placedLine(p: PlacedBy): string {
  return byLine("Placed", p);
}

/** How a server's staged event names who staged it (GDD 14.5). */
export function stagedLine(p: PlacedBy): string {
  return byLine("Staged", p);
}

/** The tag staged goods and items carry: they stay where they were staged (GDD 10.8). */
export function stagedGoodsLine(at: StagedWhere): string {
  return `staged · local to ${at.name || "its settlement"}`;
}
