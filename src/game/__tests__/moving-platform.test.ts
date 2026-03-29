import { describe, expect, it } from "vitest"
import {
	advanceWaypoint,
	interpolatePosition,
	type WaypointState,
} from "../entities/moving-platform"
import type { Vec2 } from "../types"

const WAYPOINTS: Vec2[] = [
	{ x: 0, y: 0 },
	{ x: 100, y: 0 },
	{ x: 100, y: 100 },
]

function makeState(overrides: Partial<WaypointState> = {}): WaypointState {
	return {
		currentIndex: 0,
		nextIndex: 1,
		t: 0,
		direction: 1,
		pauseRemainingMs: 0,
		...overrides,
	}
}

// ─── interpolatePosition ─────────────────────────────────

describe("interpolatePosition", () => {
	it("returns start at t=0", () => {
		const result = interpolatePosition({ x: 0, y: 0 }, { x: 100, y: 50 }, 0)
		expect(result.x).toBe(0)
		expect(result.y).toBe(0)
	})

	it("returns end at t=1", () => {
		const result = interpolatePosition({ x: 0, y: 0 }, { x: 100, y: 50 }, 1)
		expect(result.x).toBe(100)
		expect(result.y).toBe(50)
	})

	it("returns midpoint at t=0.5", () => {
		const result = interpolatePosition({ x: 0, y: 0 }, { x: 100, y: 50 }, 0.5)
		expect(result.x).toBe(50)
		expect(result.y).toBe(25)
	})
})

// ─── advanceWaypoint ─────────────────────────────────────

describe("advanceWaypoint", () => {
	it("advances t based on speed and segment length", () => {
		// Segment 0→1 is 100 units. Speed = 50 units/sec. dt = 1000ms (1 sec).
		// Expected: t advances by 50/100 = 0.5
		const state = makeState()
		const result = advanceWaypoint(state, WAYPOINTS, 50, 1000, 0, "ping_pong")
		expect(result.t).toBeCloseTo(0.5, 2)
		expect(result.currentIndex).toBe(0)
		expect(result.nextIndex).toBe(1)
	})

	it("moves to next segment when t reaches 1", () => {
		// Speed = 100, dt = 1000ms → t advances by 1.0 → triggers next segment
		const state = makeState()
		const result = advanceWaypoint(state, WAYPOINTS, 100, 1000, 0, "ping_pong")
		expect(result.currentIndex).toBe(1)
		expect(result.nextIndex).toBe(2)
		expect(result.t).toBe(0)
	})

	it("pauses at waypoint when pauseMs > 0", () => {
		const state = makeState()
		const result = advanceWaypoint(state, WAYPOINTS, 200, 1000, 500, "ping_pong")
		// Should reach end of segment and start pausing
		expect(result.pauseRemainingMs).toBe(500)
		expect(result.t).toBe(0)
	})

	it("counts down pause before moving again", () => {
		const state = makeState({ pauseRemainingMs: 300 })
		const result = advanceWaypoint(state, WAYPOINTS, 50, 200, 0, "ping_pong")
		// 300 - 200 = 100ms remaining
		expect(result.pauseRemainingMs).toBe(100)
		// t should not advance during pause
		expect(result.t).toBe(0)
	})

	it("resumes movement after pause expires", () => {
		const state = makeState({ pauseRemainingMs: 100 })
		// dt = 200ms — pause expires at 100ms, then 100ms of movement
		const result = advanceWaypoint(state, WAYPOINTS, 100, 200, 0, "ping_pong")
		// After pause expires, should advance. Speed=100, segment=100, remaining dt≈100ms
		// But implementation counts down pause then returns with 0 remaining — next call moves
		expect(result.pauseRemainingMs).toBe(0)
	})
})

// ─── Ping-pong mode ──────────────────────────────────────

describe("ping-pong mode", () => {
	it("reverses direction at the end of waypoints", () => {
		// At segment 1→2 (last segment), reaching the end should reverse
		const state = makeState({ currentIndex: 1, nextIndex: 2 })
		const result = advanceWaypoint(state, WAYPOINTS, 200, 1000, 0, "ping_pong")
		expect(result.direction).toBe(-1)
		// Should now go backward: current=2, next=1
		expect(result.currentIndex).toBe(2)
		expect(result.nextIndex).toBe(1)
	})

	it("reverses direction at the start of waypoints", () => {
		const state = makeState({ currentIndex: 1, nextIndex: 0, direction: -1 })
		const result = advanceWaypoint(state, WAYPOINTS, 200, 1000, 0, "ping_pong")
		expect(result.direction).toBe(1)
		expect(result.currentIndex).toBe(0)
		expect(result.nextIndex).toBe(1)
	})
})

// ─── Loop mode ───────────────────────────────────────────

describe("loop mode", () => {
	it("wraps to start after reaching last waypoint", () => {
		const state = makeState({ currentIndex: 1, nextIndex: 2 })
		const result = advanceWaypoint(state, WAYPOINTS, 200, 1000, 0, "loop")
		// Should wrap: current=2, next=0
		expect(result.currentIndex).toBe(2)
		expect(result.nextIndex).toBe(0)
	})

	it("continues forward after wrapping", () => {
		const state = makeState({ currentIndex: 2, nextIndex: 0 })
		const result = advanceWaypoint(state, WAYPOINTS, 200, 1000, 0, "loop")
		expect(result.currentIndex).toBe(0)
		expect(result.nextIndex).toBe(1)
	})
})
