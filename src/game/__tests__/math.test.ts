import { describe, expect, it } from "vitest"
import {
	addVec2,
	clamp,
	clampVec2,
	distanceVec2,
	lerp,
	lerpVec2,
	scaleVec2,
} from "../math"

describe("lerp", () => {
	it("returns a when t=0", () => {
		expect(lerp(10, 20, 0)).toBe(10)
	})

	it("returns b when t=1", () => {
		expect(lerp(10, 20, 1)).toBe(20)
	})

	it("returns midpoint when t=0.5", () => {
		expect(lerp(0, 100, 0.5)).toBe(50)
	})

	it("works with negative values", () => {
		expect(lerp(-10, 10, 0.5)).toBe(0)
	})

	it("extrapolates when t > 1", () => {
		expect(lerp(0, 10, 2)).toBe(20)
	})
})

describe("lerpVec2", () => {
	it("interpolates both components", () => {
		const result = lerpVec2({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)
		expect(result).toEqual({ x: 5, y: 10 })
	})

	it("returns a when t=0", () => {
		const a = { x: 5, y: 15 }
		const result = lerpVec2(a, { x: 100, y: 200 }, 0)
		expect(result).toEqual(a)
	})
})

describe("clamp", () => {
	it("returns value when in range", () => {
		expect(clamp(5, 0, 10)).toBe(5)
	})

	it("clamps to min", () => {
		expect(clamp(-5, 0, 10)).toBe(0)
	})

	it("clamps to max", () => {
		expect(clamp(15, 0, 10)).toBe(10)
	})

	it("handles min === max", () => {
		expect(clamp(5, 3, 3)).toBe(3)
	})
})

describe("clampVec2", () => {
	it("clamps both components independently", () => {
		const result = clampVec2(
			{ x: -5, y: 15 },
			{ x: 0, y: 0 },
			{ x: 10, y: 10 },
		)
		expect(result).toEqual({ x: 0, y: 10 })
	})

	it("returns input when already in bounds", () => {
		const result = clampVec2(
			{ x: 5, y: 5 },
			{ x: 0, y: 0 },
			{ x: 10, y: 10 },
		)
		expect(result).toEqual({ x: 5, y: 5 })
	})
})

describe("distanceVec2", () => {
	it("returns 0 for same point", () => {
		expect(distanceVec2({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0)
	})

	it("returns correct distance for 3-4-5 triangle", () => {
		expect(distanceVec2({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
	})
})

describe("addVec2", () => {
	it("adds components", () => {
		expect(addVec2({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 })
	})
})

describe("scaleVec2", () => {
	it("scales both components", () => {
		expect(scaleVec2({ x: 3, y: 4 }, 2)).toEqual({ x: 6, y: 8 })
	})

	it("handles zero scalar", () => {
		expect(scaleVec2({ x: 3, y: 4 }, 0)).toEqual({ x: 0, y: 0 })
	})
})
