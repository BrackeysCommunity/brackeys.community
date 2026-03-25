import { Container, Graphics, Text, TextStyle } from "pixi.js"
import type { Vec2 } from "../types"

// Physics constants — must match player.ts
const JUMP_VELOCITY = -500 // game units/sec (negative = up)
const GRAVITY = 1200 // game units/sec²
const MOVE_SPEED = 300 // game units/sec
const FLOOR_Y = 1020
const PLAYER_HEIGHT = 60

const ARC_SAMPLES = 40
const POSITION_THRESHOLD = 10 // px — skip redraw if player hasn't moved much

const ARC_COLORS = {
	standing: 0xffff00, // yellow — standing jump
	right: 0x00ff88, // green — full speed right
	left: 0xff8800, // orange — full speed left
}
const ARC_ALPHA = 0.5
const ARC_WIDTH = 2

const LABEL_STYLE = new TextStyle({
	fontFamily: "monospace",
	fontSize: 9,
	fill: 0xffffff,
})

export type JumpArcOverlay = {
	update: (playerPos: Vec2) => void
	setVisible: (visible: boolean) => void
	destroy: () => void
	container: Container
}

/** Simulate a jump arc and return sample points */
export function computeJumpArc(
	startX: number,
	startY: number,
	horizontalSpeed: number,
): Vec2[] {
	const points: Vec2[] = []
	let x = startX
	let y = startY
	let vy = JUMP_VELOCITY
	const dt = 1 / 60 // simulate at 60fps

	for (let i = 0; i < ARC_SAMPLES * 3; i++) {
		points.push({ x, y })

		vy += GRAVITY * dt
		x += horizontalSpeed * dt
		y += vy * dt

		// Stop when we hit the floor or go below start height + margin
		if (y >= FLOOR_Y - PLAYER_HEIGHT) {
			points.push({ x, y: FLOOR_Y - PLAYER_HEIGHT })
			break
		}
	}

	return points
}

export function createJumpArcOverlay(): JumpArcOverlay {
	const container = new Container()
	container.label = "debug-jump-arcs"

	const graphics = new Graphics()
	container.addChild(graphics)

	const maxHeightLabel = new Text({ text: "", style: LABEL_STYLE })
	maxHeightLabel.alpha = 0.6
	container.addChild(maxHeightLabel)

	const maxDistLabel = new Text({ text: "", style: LABEL_STYLE })
	maxDistLabel.alpha = 0.6
	container.addChild(maxDistLabel)

	let lastPos: Vec2 = { x: -99999, y: -99999 }

	function drawArc(points: Vec2[], color: number): void {
		if (points.length < 2) return

		graphics.setStrokeStyle({ width: ARC_WIDTH, color, alpha: ARC_ALPHA })
		graphics.moveTo(points[0].x, points[0].y)

		for (let i = 1; i < points.length; i++) {
			graphics.lineTo(points[i].x, points[i].y)
		}
		graphics.stroke()
	}

	function update(playerPos: Vec2): void {
		const dx = playerPos.x - lastPos.x
		const dy = playerPos.y - lastPos.y
		if (dx * dx + dy * dy < POSITION_THRESHOLD * POSITION_THRESHOLD) return

		lastPos = { ...playerPos }
		graphics.clear()

		// Only draw arcs when player is on the ground
		const onGround = playerPos.y >= FLOOR_Y - PLAYER_HEIGHT - 1

		if (!onGround) return

		// Standing jump
		const standingArc = computeJumpArc(playerPos.x, playerPos.y, 0)
		drawArc(standingArc, ARC_COLORS.standing)

		// Full speed right
		const rightArc = computeJumpArc(playerPos.x, playerPos.y, MOVE_SPEED)
		drawArc(rightArc, ARC_COLORS.right)

		// Full speed left
		const leftArc = computeJumpArc(playerPos.x, playerPos.y, -MOVE_SPEED)
		drawArc(leftArc, ARC_COLORS.left)

		// Compute max height from standing jump
		let minY = playerPos.y
		for (const p of standingArc) {
			if (p.y < minY) minY = p.y
		}
		const maxHeight = Math.round(playerPos.y - minY)

		// Compute max horizontal distance from right jump
		const lastRight = rightArc[rightArc.length - 1]
		const maxDist = lastRight
			? Math.round(Math.abs(lastRight.x - playerPos.x))
			: 0

		maxHeightLabel.text = `↑ ${maxHeight}px`
		maxHeightLabel.position.set(playerPos.x + 8, minY - 4)

		maxDistLabel.text = `→ ${maxDist}px`
		maxDistLabel.position.set(
			lastRight ? lastRight.x + 4 : playerPos.x,
			playerPos.y + 4,
		)
	}

	function setVisible(visible: boolean): void {
		container.visible = visible
		if (!visible) {
			graphics.clear()
			lastPos = { x: -99999, y: -99999 }
		}
	}

	function destroy(): void {
		graphics.destroy()
		maxHeightLabel.destroy()
		maxDistLabel.destroy()
		container.destroy()
	}

	return { update, setVisible, destroy, container }
}
