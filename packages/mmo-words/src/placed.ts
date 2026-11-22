import { amount } from "./units.ts";

/** How a staged place names who placed it (GDD 14.5). */
export function placedLine(p: { by: string; label: string; points?: number }): string {
  if (p.by !== "staff") return `Placed by the admins of ${p.label}`;
  return `Placed by staff of ${p.label}${p.points ? ` · ${amount(p.points, "event points")}` : ""}`;
}
