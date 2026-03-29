import type { DebugMode } from "../types"
import { DEBUG_MODES } from "../types"

const STORAGE_KEY = "debug-overlay-mode"
const TOGGLE_KEY = "F3"

export type DebugPanel = {
	getMode: () => DebugMode
	destroy: () => void
}

export function createDebugPanel(
	target: HTMLElement | Window,
	onModeChange: (mode: DebugMode) => void,
): DebugPanel {
	// Restore from localStorage
	let currentIndex = 0
	try {
		const stored = localStorage.getItem(STORAGE_KEY) as DebugMode | null
		if (stored) {
			const idx = DEBUG_MODES.indexOf(stored)
			if (idx >= 0) currentIndex = idx
		}
	} catch {
		// localStorage may be unavailable
	}

	// Fire initial mode
	onModeChange(DEBUG_MODES[currentIndex])

	function handleKeyDown(e: KeyboardEvent): void {
		if (e.key !== TOGGLE_KEY) return
		e.preventDefault()

		currentIndex = (currentIndex + 1) % DEBUG_MODES.length
		const mode = DEBUG_MODES[currentIndex]

		try {
			localStorage.setItem(STORAGE_KEY, mode)
		} catch {
			// ignore
		}

		onModeChange(mode)
	}

	target.addEventListener("keydown", handleKeyDown as EventListener)

	function getMode(): DebugMode {
		return DEBUG_MODES[currentIndex]
	}

	function destroy(): void {
		target.removeEventListener("keydown", handleKeyDown as EventListener)
	}

	return { getMode, destroy }
}
