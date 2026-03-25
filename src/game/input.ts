import type { InputAction, InputBinding } from "./types"
import { DEFAULT_BINDINGS } from "./types"

export type InputSystem = {
	attach: (target: HTMLElement | Window) => void
	detach: () => void
	poll: (tick: number) => InputAction[]
	getMousePosition: () => { x: number; y: number }
	isKeyDown: (key: string) => boolean
	destroy: () => void
}

export function createInputSystem(
	bindings: InputBinding[] = DEFAULT_BINDINGS,
): InputSystem {
	const actionQueue: InputAction[] = []
	const keysDown = new Set<string>()
	const mousePosition = { x: 0, y: 0 }

	// Build a reverse lookup: key → action
	const keyToActions = new Map<string, string[]>()
	for (const binding of bindings) {
		for (const key of binding.keys) {
			const existing = keyToActions.get(key) ?? []
			existing.push(binding.action)
			keyToActions.set(key, existing)
		}
	}

	let cleanupFns: (() => void)[] = []

	function handleKeyDown(e: KeyboardEvent): void {
		// Ignore repeats — we only care about the initial press
		if (e.repeat) return

		const key = e.key
		keysDown.add(key)

		const actions = keyToActions.get(key)
		if (actions) {
			for (const action of actions) {
				actionQueue.push({
					action,
					pressed: true,
					tick: 0, // filled in by poll()
					timestamp: e.timeStamp,
				})
			}
			// Prevent default for bound keys (stop arrow keys scrolling, space jumping page)
			e.preventDefault()
		}
	}

	function handleKeyUp(e: KeyboardEvent): void {
		const key = e.key
		keysDown.delete(key)

		const actions = keyToActions.get(key)
		if (actions) {
			for (const action of actions) {
				actionQueue.push({
					action,
					pressed: false,
					tick: 0,
					timestamp: e.timeStamp,
				})
			}
		}
	}

	function handleMouseMove(e: MouseEvent): void {
		mousePosition.x = e.clientX
		mousePosition.y = e.clientY
	}

	function attach(target: HTMLElement | Window): void {
		// Clean up any previous listeners
		detach()

		target.addEventListener("keydown", handleKeyDown as EventListener)
		target.addEventListener("keyup", handleKeyUp as EventListener)
		target.addEventListener("mousemove", handleMouseMove as EventListener)

		cleanupFns.push(() => {
			target.removeEventListener("keydown", handleKeyDown as EventListener)
			target.removeEventListener("keyup", handleKeyUp as EventListener)
			target.removeEventListener(
				"mousemove",
				handleMouseMove as EventListener,
			)
		})
	}

	function detach(): void {
		for (const cleanup of cleanupFns) {
			cleanup()
		}
		cleanupFns = []
	}

	function poll(tick: number): InputAction[] {
		// Drain the queue and stamp the current tick
		const actions = actionQueue.splice(0)
		for (const action of actions) {
			action.tick = tick
		}
		return actions
	}

	function getMousePosition(): { x: number; y: number } {
		return { ...mousePosition }
	}

	function isKeyDown(key: string): boolean {
		return keysDown.has(key)
	}

	function destroy(): void {
		detach()
		actionQueue.length = 0
		keysDown.clear()
	}

	return { attach, detach, poll, getMousePosition, isKeyDown, destroy }
}
