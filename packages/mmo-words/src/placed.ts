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

/** Who staged or placed a thing: a server's staff or its admins, by its guild's name. */
export function stagerWords(role: string, label: string): string {
  return role === "staff" ? `staff of ${label}` : `the admins of ${label}`;
}

function byLine(verb: string, p: PlacedBy): string {
  const points = p.by === "staff" && p.points ? ` · ${amount(p.points, "event points")}` : "";
  return `${verb} by ${stagerWords(p.by, p.label)}${points}`;
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

/** An amount of goods, with the staged tag when they were staged. */
export function goodsAmountLine(amountText: string, staged?: StagedWhere): string {
  return staged ? `${amountText} (${stagedGoodsLine(staged)})` : amountText;
}
