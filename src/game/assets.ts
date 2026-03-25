import { Assets, type AssetsManifest } from "pixi.js"

/**
 * Asset manifest for the game. Organized into bundles that can be
 * loaded independently. For now this is mostly empty — placeholder
 * art uses programmatic Graphics. Real sprites get added here.
 */
const gameManifest: AssetsManifest = {
	bundles: [
		{
			name: "game-core",
			assets: [
				// Future: player spritesheet, ground tiles, etc.
				// { alias: "player-idle", src: "/assets/game/player-idle.json" },
			],
		},
		{
			name: "ui",
			assets: [
				// Future: UI icons, fonts, etc.
			],
		},
	],
}

let initialized = false

export async function initAssets(): Promise<void> {
	if (initialized) return
	await Assets.init({ manifest: gameManifest })
	initialized = true
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
