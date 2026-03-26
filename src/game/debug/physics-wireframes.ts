import { Container, Graphics } from "pixi.js"
import type { PhysicsWorld } from "../physics"

export type PhysicsWireframes = {
	update: () => void
	setVisible: (visible: boolean) => void
	destroy: () => void
	container: Container
}

export function createPhysicsWireframes(
	physicsWorld: PhysicsWorld,
): PhysicsWireframes {
	const container = new Container()
	container.label = "debug-physics"

	const graphics = new Graphics()
	container.addChild(graphics)

	function update(): void {
		graphics.clear()

		const { vertices, colors } = physicsWorld.debugRender()

		// Rapier returns line segments: every 4 floats in vertices = one segment
		// [x1, y1, x2, y2, ...] and colors has [r, g, b, a] per vertex
		for (let i = 0; i < vertices.length; i += 4) {
			const x1 = vertices[i]
			const y1 = vertices[i + 1]
			const x2 = vertices[i + 2]
			const y2 = vertices[i + 3]

			// Each segment has 2 vertices, 4 color components each → 8 color values per segment
			const ci = (i / 4) * 8
			const r = colors[ci]
			const g = colors[ci + 1]
			const b = colors[ci + 2]
			const a = colors[ci + 3]

			// Convert [0..1] floats to hex color
			const color =
				((Math.round(r * 255) & 0xff) << 16) |
				((Math.round(g * 255) & 0xff) << 8) |
				(Math.round(b * 255) & 0xff)

			graphics.setStrokeStyle({ width: 1.5, color, alpha: a * 0.8 })
			graphics.moveTo(x1, y1)
			graphics.lineTo(x2, y2)
			graphics.stroke()
		}
	}

	function setVisible(visible: boolean): void {
		container.visible = visible
		if (visible) {
			update()
		}
	}

	function destroy(): void {
		graphics.destroy()
		container.destroy()
	}

	return { update, setVisible, destroy, container }
}
