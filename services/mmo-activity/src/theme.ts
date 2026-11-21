import { palette } from "virtual:pack";

// The pack's palette under the names the stylesheet uses. Pieces are told
// apart by these in order, most unlike first, and always by a mark too.
const ROLES: Record<string, string> = {
  ash: "ash",
  concrete: "concrete",
  rust: "rust",
  hazard: "hazard",
  signal: "signal-green",
  coolant: "coolant",
  gold: "cartel-gold",
  violet: "cult-violet",
  tar: "tar",
  corruption: "corruption",
};
const PIECES = [
  "signal-green",
  "hazard",
  "coolant",
  "corruption",
  "rust",
  "ash",
  "cult-violet",
  "concrete",
  "cartel-gold",
];

/** Puts the wasteland pack's colours on the page (GDD 16.5). */
export function theme(root: HTMLElement): void {
  for (const [role, id] of Object.entries(ROLES)) {
    const hex = palette[id];
    if (hex) root.style.setProperty(`--${role}`, hex);
  }
  for (const [i, id] of PIECES.entries()) {
    const hex = palette[id];
    if (hex) root.style.setProperty(`--piece-${i}`, hex);
  }
}
