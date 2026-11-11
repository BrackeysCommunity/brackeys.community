/** The HUD's class names and its one stylesheet, scoped under the HUD's root class. */
export const CLS = {
  root: "tactics-hud",
  cells: "tactics-hud-cells",
  cell: "tactics-hud-cell",
  pulse: "tactics-hud-pulse",
  head: "tactics-hud-head",
  banner: "tactics-hud-banner",
  prompt: "tactics-hud-prompt",
  card: "tactics-hud-card",
  menu: "tactics-hud-menu",
  button: "tactics-hud-button",
  top: "tactics-hud-top",
  side: "tactics-hud-side",
  log: "tactics-hud-log",
  live: "tactics-hud-live",
} as const;

const css = `
.${CLS.root} {
  position: absolute;
  inset: 0;
  overflow: hidden;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.3;
  color: #f4f1e8;
  --tactics-panel: rgb(20 22 34 / 0.86);
  --tactics-edge: rgb(255 255 255 / 0.18);
  --tactics-focus: #ffd75e;
}
.${CLS.cells} { position: absolute; inset: 0; pointer-events: none; }
.${CLS.cell} {
  box-sizing: border-box;
  width: var(--tactics-cell-w, 48px);
  height: var(--tactics-cell-h, 48px);
  margin-left: calc(var(--tactics-cell-w, 48px) * -0.5);
  margin-top: calc(var(--tactics-cell-h, 48px) * -0.5);
  pointer-events: none;
}
/* Fog is near-opaque, so what stands in it stays hidden, as the unit card does. */
.${CLS.cell}-fog {
  z-index: 0;
  background:
    repeating-linear-gradient(135deg, rgb(255 255 255 / 0.04) 0 2px, transparent 2px 8px),
    rgb(12 14 26 / 0.97);
}
/* Reach and attack read by their edges and pattern, not their tint: a light fill keeps units' colours true over any ground. */
.${CLS.cell}-reach {
  z-index: 1;
  background: rgb(60 130 255 / 0.22);
  border: 3px solid #2f6cf0;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.75);
}
.${CLS.cell}-attack {
  z-index: 2;
  background: repeating-linear-gradient(45deg, rgb(230 40 30 / 0.6) 0 3px, transparent 3px 9px);
  border: 3px solid #d8281e;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.75);
}
.${CLS.cell}-target { z-index: 3; border: 3px solid #ffd75e; }
.${CLS.cell}-cursor { z-index: 4; border: 2px solid #ffffff; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.6); }
.${CLS.pulse} { animation: tactics-hud-pulse 1.2s ease-in-out infinite alternate; }
@keyframes tactics-hud-pulse { from { opacity: 1; } to { opacity: 0.55; } }
@media (prefers-reduced-motion: reduce) { .${CLS.pulse} { animation: none; } }

/* The host's chrome over the canvas, as UiContext.root documents it; panels keep 8px clear of it. */
.${CLS.root} {
  --tactics-top: calc(var(--jams-ui-safe-top, 0px) + 8px);
  --tactics-right: calc(var(--jams-ui-safe-right, 0px) + 8px);
  --tactics-bottom: calc(var(--jams-ui-safe-bottom, 0px) + 8px);
  --tactics-left: calc(var(--jams-ui-safe-left, 0px) + 8px);
}
.${CLS.banner}, .${CLS.card}, .${CLS.menu}, .${CLS.log} {
  background: var(--tactics-panel);
  border: 1px solid var(--tactics-edge);
  border-radius: 6px;
}
/* The side column (card, log) and the banner share one grid row, so a narrow window wraps the banner instead of overlapping. */
.${CLS.top} {
  position: absolute;
  top: var(--tactics-top);
  left: var(--tactics-left);
  right: var(--tactics-right);
  display: grid;
  grid-template-columns: minmax(min-content, 1fr) auto minmax(min-content, 1fr);
  gap: 8px;
  align-items: start;
}
.${CLS.side} { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; }
.${CLS.head} {
  grid-column: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.${CLS.banner} {
  padding: 4px 12px;
  font-weight: 600;
  text-align: center;
  overflow-wrap: anywhere;
}
.${CLS.prompt} {
  margin: 0;
  padding: 2px 10px;
  border-radius: 4px;
  background: rgb(20 22 34 / 0.72);
  font-size: 12px;
  text-align: center;
  overflow-wrap: anywhere;
}
.${CLS.prompt}[hidden] { display: none; }
.${CLS.card} { min-width: 9rem; padding: 6px 10px; }
.${CLS.card}[hidden] { display: none; }
.${CLS.card} h2 { margin: 0 0 4px; font-size: 14px; }
.${CLS.card} dl { display: grid; grid-template-columns: auto auto; gap: 1px 10px; margin: 0; }
.${CLS.card} dt { opacity: 0.7; }
.${CLS.card} dd { margin: 0; text-align: right; }
.${CLS.log} { max-width: 16rem; margin: 0; padding: 4px 10px; list-style: none; font-size: 12px; }
.${CLS.log}[hidden] { display: none; }
.${CLS.log} li { opacity: 0.7; }
.${CLS.log} li:last-child { opacity: 1; }
.${CLS.menu} {
  position: absolute;
  bottom: var(--tactics-bottom);
  left: 50%;
  transform: translateX(-50%);
  max-width: calc(100% - var(--tactics-left) - var(--tactics-right));
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  padding: 4px;
  pointer-events: auto;
}
.${CLS.button} {
  font: inherit;
  color: inherit;
  background: rgb(255 255 255 / 0.08);
  border: 1px solid var(--tactics-edge);
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
}
.${CLS.button}:hover { background: rgb(255 255 255 / 0.16); }
.${CLS.button}:focus-visible { outline: 2px solid var(--tactics-focus); outline-offset: 1px; }
.${CLS.button}[aria-pressed="true"] { background: rgb(90 160 255 / 0.4); }
.${CLS.button}[aria-disabled="true"] { opacity: 0.45; cursor: default; }
.${CLS.button}[data-key]::after {
  content: attr(data-key);
  margin-left: 6px;
  padding: 0 4px;
  border: 1px solid var(--tactics-edge);
  border-radius: 3px;
  font-size: 11px;
  opacity: 0.75;
}
.${CLS.live} {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
`;

/** A `<style>` with the HUD's rules, for the HUD's own root so removing the HUD removes it. */
export function createStyles(doc: Document): HTMLStyleElement {
  const style = doc.createElement("style");
  style.textContent = css;
  return style;
}
