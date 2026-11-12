import { createGame, type GameInstance } from "@jams/engine";

import { walkerGame } from "./walker-game";

/** Shown in place of the default "Restoring graphics…" line while the GPU context is restored. */
export function restoringCard(layer: HTMLElement): { destroy(): void } {
  const card = layer.ownerDocument.createElement("p");
  card.setAttribute("role", "status");
  card.textContent = "The graphics card dropped out. Your game is paused and will carry on.";
  card.style.cssText = "margin:auto;padding:12px 16px;background:#111;color:#eee";
  layer.style.display = "flex";
  layer.append(card);
  return { destroy: () => card.remove() };
}

/** The three render events, as lines a host might log or send to its error reporting. */
export function watchGraphics(game: Pick<GameInstance, "on">, log: (line: string) => void): void {
  game.on("render:lost", ({ backend }) => log(`lost ${backend}: paused`));
  game.on("render:restored", ({ backend, rebuilt }) =>
    log(`back on ${backend}${rebuilt ? ", rebuilt" : ""}: resumed`),
  );
  game.on("render:fallback", ({ from, reason }) => log(`${from} ${reason}: WebGL from here on`));
}

export async function startLane(canvas: HTMLCanvasElement): Promise<GameInstance> {
  const game = await createGame(canvas, {
    game: walkerGame,
    displayWidth: canvas.clientWidth,
    displayHeight: canvas.clientHeight,
    dev: false,
    renderer: { preference: "webgpu", lostOverlay: restoringCard },
  });
  watchGraphics(game, (line) => console.info(line));
  return game;
}
