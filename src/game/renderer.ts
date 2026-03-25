import { Application, Container } from "pixi.js"
import type { GameConfig } from "./types"

export type Renderer = {
	app: Application
	worldContainer: Container
	uiContainer: Container
	resize: (width: number, height: number) => void
	destroy: () => void
}

export async function createRenderer(
	canvas: HTMLCanvasElement,
	config: GameConfig,
): Promise<Renderer> {
	const app = new Application()

	await app.init({
		canvas,
		preference: "webgpu",
		width: config.width,
		height: config.height,
		backgroundColor: config.backgroundColor,
		resolution: window.devicePixelRatio || 1,
		autoDensity: true,
		antialias: true,
	})

	// Stage hierarchy: world (camera-affected) and UI (screen-fixed)
	const worldContainer = new Container()
	worldContainer.label = "world"

	const uiContainer = new Container()
	uiContainer.label = "ui"

	app.stage.addChild(worldContainer)
	app.stage.addChild(uiContainer)

	function resize(width: number, height: number): void {
		app.renderer.resize(width, height)
	}

	function destroy(): void {
		app.destroy(true, { children: true })
	}

	return { app, worldContainer, uiContainer, resize, destroy }
}
