import type { Container } from "pixi.js"
import { clampVec2, lerpVec2 } from "./math"
import type { CameraConfig, Vec2 } from "./types"

export type Camera = {
	update: (dt: number, targetPos: Vec2) => void
	getPosition: () => Vec2
	getViewport: () => { x: number; y: number; width: number; height: number }
	setBounds: (min: Vec2, max: Vec2) => void
	setZoom: (zoom: number) => void
	destroy: () => void
}

export function createCamera(
	worldContainer: Container,
	screenWidth: number,
	screenHeight: number,
	config: CameraConfig,
): Camera {
	let position: Vec2 = { x: 0, y: 0 }
	let zoom = 1
	let bounds = { min: { ...config.bounds.min }, max: { ...config.bounds.max } }
	let width = screenWidth
	let height = screenHeight

	function update(_dt: number, targetPos: Vec2): void {
		// Lerp toward target (dt-independent via fixed timestep — lerpSpeed is per-tick)
		position = lerpVec2(position, targetPos, config.lerpSpeed)

		// Clamp to world bounds, keeping the camera viewport inside.
		// If viewport is larger than world on an axis, center on that axis instead.
		const halfW = (width / zoom) / 2
		const halfH = (height / zoom) / 2

		const worldW = bounds.max.x - bounds.min.x
		const worldH = bounds.max.y - bounds.min.y

		const clampMin = {
			x: worldW <= width / zoom ? (bounds.min.x + bounds.max.x) / 2 : bounds.min.x + halfW,
			y: worldH <= height / zoom ? (bounds.min.y + bounds.max.y) / 2 : bounds.min.y + halfH,
		}
		const clampMax = {
			x: worldW <= width / zoom ? (bounds.min.x + bounds.max.x) / 2 : bounds.max.x - halfW,
			y: worldH <= height / zoom ? (bounds.min.y + bounds.max.y) / 2 : bounds.max.y - halfH,
		}

		position = clampVec2(position, clampMin, clampMax)

		// Apply to world container — camera position is inverted (camera moves right → world moves left)
		worldContainer.position.set(
			-position.x * zoom + width / 2,
			-position.y * zoom + height / 2,
		)
		worldContainer.scale.set(zoom)
	}

	function getPosition(): Vec2 {
		return { ...position }
	}

	function getViewport() {
		const halfW = (width / zoom) / 2
		const halfH = (height / zoom) / 2
		return {
			x: position.x - halfW,
			y: position.y - halfH,
			width: width / zoom,
			height: height / zoom,
		}
	}

	function setBounds(min: Vec2, max: Vec2): void {
		bounds = { min: { ...min }, max: { ...max } }
	}

	function setZoom(z: number): void {
		zoom = Math.max(0.1, Math.min(5, z))
	}

	function destroy(): void {
		// No resources to release — camera is pure math + container reference
	}

	return { update, getPosition, getViewport, setBounds, setZoom, destroy }
}
