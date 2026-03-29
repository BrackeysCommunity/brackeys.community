import { Container, Graphics, Text, TextStyle } from "pixi.js"

// ─── Config ──────────────────────────────────────────────

const MINOR_INTERVAL = 64
const MAJOR_INTERVAL = 256
const VIEWPORT_MARGIN = 256

const MINOR_COLOR = 0x444466
const MINOR_ALPHA = 0.15
const MINOR_WIDTH = 1

const MAJOR_COLOR = 0x6666aa
const MAJOR_ALPHA = 0.3
const MAJOR_WIDTH = 2

const ORIGIN_X_COLOR = 0xff4444
const ORIGIN_Y_COLOR = 0x44ff44
const ORIGIN_ALPHA = 0.6
const ORIGIN_WIDTH = 2

const LABEL_STYLE = new TextStyle({
	fontFamily: "monospace",
	fontSize: 10,
	fill: 0x8888bb,
})

// ─── Types ───────────────────────────────────────────────

type Viewport = { x: number; y: number; width: number; height: number }

export type GridOverlay = {
	update: (viewport: Viewport) => void
	setVisible: (visible: boolean) => void
	destroy: () => void
	container: Container
}

// ─── Factory ─────────────────────────────────────────────

export function createGridOverlay(): GridOverlay {
	const container = new Container()
	container.label = "debug-grid"

	const graphics = new Graphics()
	container.addChild(graphics)

	const labelContainer = new Container()
	labelContainer.label = "debug-grid-labels"
	container.addChild(labelContainer)

	// Pool of reusable text objects to avoid GC churn
	const labelPool: Text[] = []
	let lastViewportKey = ""

	function getLabel(index: number): Text {
		if (index < labelPool.length) {
			labelPool[index].visible = true
			return labelPool[index]
		}
		const text = new Text({ text: "", style: LABEL_STYLE })
		text.alpha = 0.5
		labelPool.push(text)
		labelContainer.addChild(text)
		return text
	}

	function hideUnusedLabels(usedCount: number): void {
		for (let i = usedCount; i < labelPool.length; i++) {
			labelPool[i].visible = false
		}
	}

	function update(viewport: Viewport): void {
		// Skip redraw if viewport hasn't changed meaningfully
		const key = `${Math.floor(viewport.x / MINOR_INTERVAL)},${Math.floor(viewport.y / MINOR_INTERVAL)},${Math.floor(viewport.width)},${Math.floor(viewport.height)}`
		if (key === lastViewportKey) return
		lastViewportKey = key

		graphics.clear()

		const left = viewport.x - VIEWPORT_MARGIN
		const right = viewport.x + viewport.width + VIEWPORT_MARGIN
		const top = viewport.y - VIEWPORT_MARGIN
		const bottom = viewport.y + viewport.height + VIEWPORT_MARGIN

		// ── Minor grid lines (single batched stroke) ────
		const minorStartX =
			Math.floor(left / MINOR_INTERVAL) * MINOR_INTERVAL
		const minorStartY =
			Math.floor(top / MINOR_INTERVAL) * MINOR_INTERVAL

		graphics.setStrokeStyle({ width: MINOR_WIDTH, color: MINOR_COLOR, alpha: MINOR_ALPHA })

		for (let x = minorStartX; x <= right; x += MINOR_INTERVAL) {
			if (x % MAJOR_INTERVAL === 0) continue
			graphics.moveTo(x, top)
			graphics.lineTo(x, bottom)
		}

		for (let y = minorStartY; y <= bottom; y += MINOR_INTERVAL) {
			if (y % MAJOR_INTERVAL === 0) continue
			graphics.moveTo(left, y)
			graphics.lineTo(right, y)
		}

		graphics.stroke()

		// ── Major grid lines (single batched stroke) ─────
		const majorStartX =
			Math.floor(left / MAJOR_INTERVAL) * MAJOR_INTERVAL
		const majorStartY =
			Math.floor(top / MAJOR_INTERVAL) * MAJOR_INTERVAL

		graphics.setStrokeStyle({ width: MAJOR_WIDTH, color: MAJOR_COLOR, alpha: MAJOR_ALPHA })

		for (let x = majorStartX; x <= right; x += MAJOR_INTERVAL) {
			if (x === 0) continue
			graphics.moveTo(x, top)
			graphics.lineTo(x, bottom)
		}

		for (let y = majorStartY; y <= bottom; y += MAJOR_INTERVAL) {
			if (y === 0) continue
			graphics.moveTo(left, y)
			graphics.lineTo(right, y)
		}

		graphics.stroke()

		// ── Origin axes ──────────────────────────────────
		if (top <= 0 && bottom >= 0) {
			graphics.setStrokeStyle({ width: ORIGIN_WIDTH, color: ORIGIN_X_COLOR, alpha: ORIGIN_ALPHA })
			graphics.moveTo(left, 0)
			graphics.lineTo(right, 0)
			graphics.stroke()
		}

		if (left <= 0 && right >= 0) {
			graphics.setStrokeStyle({ width: ORIGIN_WIDTH, color: ORIGIN_Y_COLOR, alpha: ORIGIN_ALPHA })
			graphics.moveTo(0, top)
			graphics.lineTo(0, bottom)
			graphics.stroke()
		}

		// ── Scale labels at major intersections ──────────
		let labelIndex = 0

		for (let x = majorStartX; x <= right; x += MAJOR_INTERVAL) {
			for (let y = majorStartY; y <= bottom; y += MAJOR_INTERVAL) {
				// Only label every other intersection to reduce clutter
				if (x === 0 && y === 0) {
					const label = getLabel(labelIndex++)
					label.text = "0,0"
					label.position.set(x + 4, y + 2)
					continue
				}

				const label = getLabel(labelIndex++)
				label.text = `${x},${y}`
				label.position.set(x + 4, y + 2)
			}
		}

		hideUnusedLabels(labelIndex)
	}

	function setVisible(visible: boolean): void {
		container.visible = visible
	}

	function destroy(): void {
		for (const label of labelPool) {
			label.destroy()
		}
		labelPool.length = 0
		graphics.destroy()
		labelContainer.destroy()
		container.destroy()
	}

	return { update, setVisible, destroy, container }
}
