import { amount } from "./units.ts";

const RISK_UNIT: Record<string, string> = { durability: "durability", haul: "goods", coin: "coin" };

/** What an option risks when it fails (GDD 7.3). */
export function riskLine(o: { risk?: string; riskSize: number }): string {
  if (!o.risk || o.risk === "none" || o.riskSize === 0) return "risks nothing";
  if (o.risk === "wound") return "risks a wound";
  if (o.risk === "first-strike") return "risks the first strike";
  return `risks ${amount(o.riskSize, RISK_UNIT[o.risk] ?? o.risk.replace(/-/g, " "))}`;
}
