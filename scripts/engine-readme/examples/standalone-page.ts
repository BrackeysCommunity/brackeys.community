import { bootStandalone, type StandaloneGame } from "@jams/engine/standalone";

import { walkerGame } from "./walker-game";

/**
 * What a build's generated entry does, by hand: boots the release next to
 * the page. A refused boot already shows its reason, the issue's code and a
 * Reload button in `root`, and sets `<html data-jams-state="error">`.
 */
export async function playLane(
  root: HTMLElement,
  fetch?: typeof globalThis.fetch,
): Promise<StandaloneGame | null> {
  try {
    return await bootStandalone({ root, game: walkerGame, ...(fetch ? { fetch } : {}) });
  } catch {
    return null;
  }
}

/** An Install button, shown while the browser offers to install the game, and a Credits link. */
export function laneMenu(game: StandaloneGame, doc: Document): HTMLElement {
  const menu = doc.createElement("nav");
  const install = doc.createElement("button");
  install.type = "button";
  install.textContent = "Install";
  const sync = () => {
    install.hidden = game.install === null;
  };
  sync();
  // The host holds the browser's prompt from `beforeinstallprompt` on; `install` is set from then.
  doc.defaultView?.addEventListener("beforeinstallprompt", () => queueMicrotask(sync));
  install.addEventListener("click", async () => {
    await game.install?.();
    sync();
  });
  const credits = doc.createElement("a");
  credits.href = game.credits;
  credits.textContent = "Credits";
  menu.append(install, credits);
  return menu;
}
