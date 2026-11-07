import { Assets } from "pixi.js";

let initialized = false;

/**
 * Register asset bundles. Must be called AFTER Application.init()
 * since that internally calls Assets.init(). We use addBundle()
 * to avoid double-init warnings.
 */
export async function initAssets(): Promise<void> {
  if (initialized) return;
  initialized = true;

  Assets.addBundle("game-core", []);

  Assets.addBundle("ui", []);
}

export async function loadBundle(
  name: string,
  onProgress?: (progress: number) => void,
): Promise<void> {
  await Assets.loadBundle(name, onProgress);
}

export function resetAssets(): void {
  initialized = false;
}
