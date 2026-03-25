import { Assets } from "pixi.js"

let initialized = false

/**
 * Register asset bundles. Must be called AFTER Application.init()
 * since that internally calls Assets.init(). We use addBundle()
 * to avoid double-init warnings.
 */
export async function initAssets(): Promise<void> {
	if (initialized) return
	initialized = true

	Assets.addBundle("game-core", [
		// Future: player spritesheet, ground tiles, etc.
		// { alias: "player-idle", src: "/assets/game/player-idle.json" },
	])

	Assets.addBundle("ui", [
		// Future: UI icons, fonts, etc.
	])
}

export async function loadBundle(
	name: string,
	onProgress?: (progress: number) => void,
): Promise<void> {
	await Assets.loadBundle(name, onProgress)
}

export function resetAssets(): void {
	initialized = false
}
