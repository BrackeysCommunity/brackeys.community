import { Container, Graphics } from "pixi.js"
import type { Vec2 } from "../types"

// ─── Config ──────────────────────────────────────────────

export const GRAPPLE_RANGE = 400 // max distance to attach
export const GRAPPLE_ROPE_COLOR = 0x88ddff
export const GRAPPLE_ANCHOR_COLOR = 0x88ddff
export const GRAPPLE_ANCHOR_RADIUS = 8

// ─── Types ───────────────────────────────────────────────

export type GrappleAnchor = {
	position: Vec2
	id: number
}

export type GrappleAnchorSystem = {
	/** Place a new anchor at the given position. Returns anchor ID. */
	add: (position: Vec2) => number
	/** Remove an anchor by ID */
	remove: (id: number) => void
	/** Get all anchors */
	getAnchors: () => GrappleAnchor[]
	/** Find the closest anchor within range of a point, or null */
	findClosest: (from: Vec2, maxRange?: number) => GrappleAnchor | null
	/** Draw/update the tether line between player and anchor */
	drawTether: (from: Vec2, to: Vec2) => void
	/** Clear the tether line */
	clearTether: () => void
	/** Remove all anchors (round reset) */
	clearAll: () => void
	destroy: () => void
}

// ─── System ──────────────────────────────────────────────

export function createGrappleAnchorSystem(
	worldContainer: Container,
): GrappleAnchorSystem {
	const container = new Container()
	container.label = "grapple-anchors"
	worldContainer.addChild(container)

	const anchors = new Map<number, { anchor: GrappleAnchor; graphics: Graphics }>()
	let nextId = 0

	// Tether line (reused)
	const tetherGraphics = new Graphics()
	tetherGraphics.label = "grapple-tether"
	worldContainer.addChild(tetherGraphics)

	function add(position: Vec2): number {
		const id = nextId++
		const gfx = new Graphics()
		// Draw anchor point: glowing circle
		gfx.circle(0, 0, GRAPPLE_ANCHOR_RADIUS)
		gfx.fill({ color: GRAPPLE_ANCHOR_COLOR, alpha: 0.6 })
		gfx.circle(0, 0, GRAPPLE_ANCHOR_RADIUS * 0.5)
		gfx.fill({ color: 0xffffff, alpha: 0.8 })
		gfx.position.set(position.x, position.y)
		container.addChild(gfx)

		const anchor: GrappleAnchor = { position: { ...position }, id }
		anchors.set(id, { anchor, graphics: gfx })
		return id
	}

	function remove(id: number): void {
		const entry = anchors.get(id)
		if (!entry) return
		container.removeChild(entry.graphics)
		entry.graphics.destroy()
		anchors.delete(id)
	}

	function getAnchors(): GrappleAnchor[] {
		return Array.from(anchors.values()).map((e) => e.anchor)
	}

	function findClosest(from: Vec2, maxRange = GRAPPLE_RANGE): GrappleAnchor | null {
		let closest: GrappleAnchor | null = null
		let closestDist = maxRange * maxRange // compare squared distances

		for (const { anchor } of anchors.values()) {
			const dx = anchor.position.x - from.x
			const dy = anchor.position.y - from.y
			const distSq = dx * dx + dy * dy
			if (distSq < closestDist) {
				closestDist = distSq
				closest = anchor
			}
		}

		return closest
	}

	function drawTether(from: Vec2, to: Vec2): void {
		tetherGraphics.clear()
		tetherGraphics.setStrokeStyle({ width: 2, color: GRAPPLE_ROPE_COLOR, alpha: 0.7 })
		tetherGraphics.moveTo(from.x, from.y)
		tetherGraphics.lineTo(to.x, to.y)
		tetherGraphics.stroke()
	}

	function clearTether(): void {
		tetherGraphics.clear()
	}

	function clearAll(): void {
		for (const { graphics: gfx } of anchors.values()) {
			gfx.destroy()
		}
		anchors.clear()
		clearTether()
	}

	function destroy(): void {
		clearAll()
		tetherGraphics.destroy()
		container.destroy()
	}

	return { add, remove, getAnchors, findClosest, drawTether, clearTether, clearAll, destroy }
}
