import { Container, Graphics } from "pixi.js"

// Color coding by collision group (matches future Rapier groups)
const COLORS = {
	GROUND: 0x44ff44, // Green
	PLAYER: 0x4444ff, // Blue
	SHAMAN_OBJ: 0xff8800, // Orange
	SENSOR: 0xff44ff, // Magenta
}

// Hardcoded floor — matches player.ts FLOOR_Y
const FLOOR_Y = 1020

export type PhysicsWireframes = {
	update: () => void
	setVisible: (visible: boolean) => void
	destroy: () => void
	container: Container
}

export function createPhysicsWireframes(): PhysicsWireframes {
	const container = new Container()
	container.label = "debug-physics"

	const graphics = new Graphics()
	container.addChild(graphics)

	let drawn = false

	function update(): void {
		// TODO: When Rapier is integrated, replace this with world.debugRender()
		// Rapier's debugRender() returns vertex arrays that can be converted
		// to PixiJS Graphics paths. Color by collision group membership.

		// For now, draw the hardcoded floor collider
		if (drawn) return
		drawn = true

		graphics.clear()

		// Floor line (ground collider)
		graphics.setStrokeStyle({ width: 2, color: COLORS.GROUND, alpha: 0.7 })
		graphics.moveTo(-2000, FLOOR_Y)
		graphics.lineTo(4000, FLOOR_Y)
		graphics.stroke()

		// Hash marks along the floor (batched)
		graphics.setStrokeStyle({ width: 1, color: COLORS.GROUND, alpha: 0.4 })
		for (let x = -2000; x <= 4000; x += 64) {
			graphics.moveTo(x, FLOOR_Y)
			graphics.lineTo(x, FLOOR_Y + 8)
		}
		graphics.stroke()
	}

	function setVisible(visible: boolean): void {
		container.visible = visible
		if (visible && !drawn) {
			update()
		}
	}

	function destroy(): void {
		graphics.destroy()
		container.destroy()
	}

	return { update, setVisible, destroy, container }
}
