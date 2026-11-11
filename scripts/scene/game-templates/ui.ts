import type { GameNames, GameOptions } from ".";

/** `ui/index.ts`: the export the project file's `ui` key names. */
export function uiIndexFile(names: GameNames): string {
  return [
    `// The HUD the site mounts over the game's canvas while it plays: plain DOM, no framework.`,
    `export { createHud as ${names.hudExport} } from "./hud";`,
    ``,
  ].join("\n");
}

/** `ui/hud.ts`: a status line and one button, kept current through `bindText`. */
export function hudFile(options: GameOptions): string {
  const turns = options.preset === "turns";
  return [
    `import { bindText, type MountUi } from "@jams/engine";`,
    ``,
    turns
      ? `import { STEP, type Direction, type Slice } from "../types";`
      : `import type { Slice } from "../types";`,
    ``,
    ...(turns
      ? [
          `/** The way a \`move\` vector points: its larger axis wins. */`,
          `function directionOf(x: number, y: number): Direction {`,
          `  if (Math.abs(x) >= Math.abs(y)) return x < 0 ? "left" : "right";`,
          `  return y < 0 ? "up" : "down";`,
          `}`,
          ``,
        ]
      : []),
    turns
      ? `/** The status line, a pause button, and \`move\` sent on as \`step\` commands. */`
      : `/** The status line and a pause button; \`pause\` (P, or a pad's start) toggles it too. */`,
    `export const createHud: MountUi<Slice> = (ctx) => {`,
    `  const panel = document.createElement("div");`,
    `  Object.assign(panel.style, {`,
    `    position: "absolute",`,
    `    top: "8px",`,
    `    left: "8px",`,
    `    display: "flex",`,
    `    alignItems: "center",`,
    `    gap: "8px",`,
    `    padding: "4px 8px",`,
    `    borderRadius: "6px",`,
    `    background: "rgba(0, 0, 0, 0.6)",`,
    `    color: "#fff",`,
    `    font: "14px system-ui, sans-serif",`,
    `    pointerEvents: "auto",`,
    `  });`,
    ``,
    `  const status = document.createElement("p");`,
    `  status.setAttribute("aria-live", "polite");`,
    `  status.style.margin = "0";`,
    ``,
    `  const button = document.createElement("button");`,
    `  button.type = "button";`,
    `  const toggle = () => {`,
    `    if (ctx.game.getStore().state.sim.paused) ctx.game.resume();`,
    `    else ctx.game.pause();`,
    `  };`,
    `  button.addEventListener("click", toggle);`,
    ``,
    `  panel.append(status, button);`,
    `  ctx.root.append(panel);`,
    ...(turns ? [``, `  let moving = false;`] : []),
    `  const stops = [`,
    `    bindText(`,
    `      status,`,
    `      ctx,`,
    `      (s) => (s.game as Slice | null)?.reached === true,`,
    `      (reached) => (reached ? "Goal reached!" : "Find the goal."),`,
    `    ),`,
    `    bindText(`,
    `      button,`,
    `      ctx,`,
    `      (s) => s.sim.paused,`,
    `      (paused) => (paused ? "Resume" : "Pause"),`,
    `    ),`,
    `    ctx.game.input.onAction(`,
    `      (e) => {`,
    `        if (e.down && !e.repeat) toggle();`,
    `      },`,
    `      { actions: ["pause"] },`,
    `    ),`,
    ...(turns
      ? [
          `    ctx.game.input.onAction(`,
          `      (e) => {`,
          `        const v = e.vector ?? { x: 0, y: 0 };`,
          `        const held = v.x !== 0 || v.y !== 0;`,
          `        if (held && !moving) ctx.game.send({ name: STEP, args: { dir: directionOf(v.x, v.y) } });`,
          `        moving = held;`,
          `      },`,
          `      { actions: ["move"] },`,
          `    ),`,
        ]
      : []),
    `  ];`,
    ``,
    `  return {`,
    `    destroy() {`,
    `      for (const stop of stops) stop();`,
    `      button.removeEventListener("click", toggle);`,
    `      panel.remove();`,
    `    },`,
    `  };`,
    `};`,
    ``,
  ].join("\n");
}
