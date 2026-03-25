import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { createGameLoop } from "../loop"

// Mock rAF/cAF — we drive the loop manually via the captured callback
let rafCallback: ((time: number) => void) | null = null
let rafId = 1

beforeEach(() => {
	rafCallback = null
	rafId = 1

	vi.stubGlobal("requestAnimationFrame", (cb: (time: number) => void) => {
		rafCallback = cb
		return rafId++
	})

	vi.stubGlobal("cancelAnimationFrame", vi.fn())
})

afterEach(() => {
	vi.restoreAllMocks()
})

/** Helper: advance the loop by calling the rAF callback at the given timestamp */
function tick(time: number): void {
	const cb = rafCallback
	if (cb) {
		rafCallback = null
		cb(time)
	}
}

describe("createGameLoop", () => {
	it("calls onTick with the correct fixed timestep", () => {
		const onTick = vi.fn()
		const onRender = vi.fn()
		const loop = createGameLoop({ tickRate: 60, onTick, onRender })

		loop.start()

		// Frame 1: initializes lastTime, no ticks yet
		tick(0)
		expect(onTick).not.toHaveBeenCalled()

		// Frame 2: 16.67ms later — exactly 1 tick at 60Hz
		tick(16.667)
		expect(onTick).toHaveBeenCalledTimes(1)
		expect(onTick).toHaveBeenCalledWith(1000 / 60)

		loop.stop()
	})

	it("accumulates multiple ticks for large deltas", () => {
		const onTick = vi.fn()
		const onRender = vi.fn()
		const loop = createGameLoop({ tickRate: 60, onTick, onRender })

		loop.start()
		tick(0) // init

		// 51ms delta → 3 ticks at ~16.67ms each (3 × 16.67 = 50.01 < 51)
		tick(51)
		expect(onTick).toHaveBeenCalledTimes(3)

		loop.stop()
	})

	it("calls onRender with alpha in [0, 1) range", () => {
		const onTick = vi.fn()
		const onRender = vi.fn()
		const loop = createGameLoop({ tickRate: 60, onTick, onRender })

		loop.start()
		tick(0)

		// 20ms delta: 1 tick (16.67ms), remainder ~3.33ms → alpha ≈ 0.2
		tick(20)
		expect(onRender).toHaveBeenCalled()
		const alpha = onRender.mock.calls[0][0]
		expect(alpha).toBeGreaterThanOrEqual(0)
		expect(alpha).toBeLessThan(1)

		loop.stop()
	})

	it("clamps large deltas to prevent spiral of death", () => {
		const onTick = vi.fn()
		const onRender = vi.fn()
		const loop = createGameLoop({ tickRate: 60, onTick, onRender })

		loop.start()
		tick(0)

		// 5 second gap (e.g., tab was hidden) — should be clamped to 250ms
		// 250ms / 16.67ms ≈ 15 ticks max
		tick(5000)
		expect(onTick.mock.calls.length).toBeLessThanOrEqual(15)

		loop.stop()
	})

	it("stop() prevents further ticks", () => {
		const onTick = vi.fn()
		const onRender = vi.fn()
		const loop = createGameLoop({ tickRate: 60, onTick, onRender })

		loop.start()
		tick(0)
		tick(16.667)
		expect(onTick).toHaveBeenCalledTimes(1)

		loop.stop()
		expect(loop.isRunning()).toBe(false)

		// Even if we somehow get another frame callback, it should bail
		tick(33.334)
		expect(onTick).toHaveBeenCalledTimes(1) // no more ticks
	})

	it("isRunning() reflects state correctly", () => {
		const loop = createGameLoop({
			tickRate: 60,
			onTick: vi.fn(),
			onRender: vi.fn(),
		})

		expect(loop.isRunning()).toBe(false)
		loop.start()
		expect(loop.isRunning()).toBe(true)
		loop.stop()
		expect(loop.isRunning()).toBe(false)
	})

	it("start() is idempotent", () => {
		const loop = createGameLoop({
			tickRate: 60,
			onTick: vi.fn(),
			onRender: vi.fn(),
		})

		loop.start()
		loop.start() // should not start a second loop
		expect(loop.isRunning()).toBe(true)

		loop.stop()
	})

	it("getFPS returns 0 before enough frames have elapsed", () => {
		const loop = createGameLoop({
			tickRate: 60,
			onTick: vi.fn(),
			onRender: vi.fn(),
		})

		loop.start()
		tick(0)
		tick(16.667)

		// FPS counter hasn't hit 1 second window yet
		expect(loop.getFPS()).toBe(0)

		loop.stop()
	})
})
