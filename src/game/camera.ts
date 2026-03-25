import type { Container } from "pixi.js"
import { clampVec2, lerpVec2 } from "./math"
import type { CameraConfig, Vec2 } from "./types"
import { VIRTUAL_HEIGHT } from "./types"

export type Camera = {
	update: (dt: number, targetPos: Vec2) => void
	getPosition: () => Vec2
	getViewport: () => { x: number; y: number; width: number; height: number }
	getDisplayScale: () => number
	setBounds: (min: Vec2, max: Vec2) => void
	setZoom: (zoom: number) => void
	resize: (displayWidth: number, displayHeight: number) => void
	destroy: () => void
}

export function createCamera(
	worldContainer: Container,
	displayWidth: number,
	displayHeight: number,
	config: CameraConfig,
): Camera {
	let position: Vec2 = { x: 0, y: 0 }
	let zoom = 1
	let bounds = { min: { ...config.bounds.min }, max: { ...config.bounds.max } }

	// Expand-viewport scaling: height is anchored to VIRTUAL_HEIGHT,
	// width expands based on display aspect ratio.
	let displayScale = displayHeight / VIRTUAL_HEIGHT
	let viewW = displayWidth / displayScale
	let viewH = VIRTUAL_HEIGHT

	function recomputeScale(dw: number, dh: number): void {
		displayScale = dh / VIRTUAL_HEIGHT
		viewW = dw / displayScale
		viewH = VIRTUAL_HEIGHT
	}

	function update(_dt: number, targetPos: Vec2): void {
		position = lerpVec2(position, targetPos, config.lerpSpeed)

		const effectiveScale = displayScale * zoom
		const halfW = viewW / (2 * zoom)
		const halfH = viewH / (2 * zoom)

		const worldW = bounds.max.x - bounds.min.x
		const worldH = bounds.max.y - bounds.min.y

		const clampMin = {
			x: worldW <= viewW / zoom ? (bounds.min.x + bounds.max.x) / 2 : bounds.min.x + halfW,
			y: worldH <= viewH / zoom ? (bounds.min.y + bounds.max.y) / 2 : bounds.min.y + halfH,
		}
		const clampMax = {
			x: worldW <= viewW / zoom ? (bounds.min.x + bounds.max.x) / 2 : bounds.max.x - halfW,
			y: worldH <= viewH / zoom ? (bounds.min.y + bounds.max.y) / 2 : bounds.max.y - halfH,
		}

		position = clampVec2(position, clampMin, clampMax)

		// Apply to world container — scale maps game units to display pixels
		worldContainer.position.set(
			-position.x * effectiveScale + (displayScale * viewW) / 2,
			-position.y * effectiveScale + (displayScale * viewH) / 2,
		)
		worldContainer.scale.set(effectiveScale)
	}

	function getPosition(): Vec2 {
		return { ...position }
	}

	function getViewport() {
		const halfW = viewW / (2 * zoom)
		const halfH = viewH / (2 * zoom)
		return {
			x: position.x - halfW,
			y: position.y - halfH,
			width: viewW / zoom,
			height: viewH / zoom,
		}
	}

	function getDisplayScale(): number {
		return displayScale
	}

	function setBounds(min: Vec2, max: Vec2): void {
		bounds = { min: { ...min }, max: { ...max } }
	}

	function setZoom(z: number): void {
		zoom = Math.max(0.1, Math.min(5, z))
	}

	function resize(dw: number, dh: number): void {
		recomputeScale(dw, dh)
	}

	function destroy(): void {
		// No resources to release
	}

	return { update, getPosition, getViewport, getDisplayScale, setBounds, setZoom, resize, destroy }
}
