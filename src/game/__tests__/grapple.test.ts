import { describe, expect, it } from "vite-plus/test";
import { initSwingState, stepSwing, getSwingReleaseVelocity } from "../entities/grapple-state";

describe("initSwingState", () => {
  it("computes correct rope length", () => {
    const state = initSwingState(
      { x: 100, y: 200 }, // player
      { x: 100, y: 100 }, // anchor directly above
      { x: 0, y: 0 },
    );
    expect(state.ropeLength).toBeCloseTo(100, 1);
  });

  it("angle is 0 when player is directly below anchor", () => {
    const state = initSwingState({ x: 100, y: 300 }, { x: 100, y: 100 }, { x: 0, y: 0 });
    expect(state.angle).toBeCloseTo(0, 3);
  });

  it("angle is positive when player is right of anchor", () => {
    const state = initSwingState({ x: 200, y: 200 }, { x: 100, y: 100 }, { x: 0, y: 0 });
    // Player is right and below — angle should be ~π/4 (45°)
    expect(state.angle).toBeGreaterThan(0);
    expect(state.angle).toBeCloseTo(Math.PI / 4, 1);
  });

  it("converts rightward velocity into positive angular velocity", () => {
    const state = initSwingState(
      { x: 100, y: 300 }, // directly below anchor
      { x: 100, y: 100 },
      { x: 300, y: 0 }, // moving right
    );
    // Rightward velocity at bottom of pendulum = clockwise = positive angular vel
    expect(state.angularVel).toBeGreaterThan(0);
  });

  it("converts leftward velocity into negative angular velocity", () => {
    const state = initSwingState({ x: 100, y: 300 }, { x: 100, y: 100 }, { x: -300, y: 0 });
    expect(state.angularVel).toBeLessThan(0);
  });
});

describe("stepSwing", () => {
  it("player remains at same distance from anchor", () => {
    const initial = initSwingState(
      { x: 200, y: 200 }, // offset from anchor
      { x: 100, y: 100 },
      { x: 0, y: 0 },
    );

    let state = initial;
    // Run 60 frames
    for (let i = 0; i < 60; i++) {
      const result = stepSwing(state, 1 / 60);
      state = result.state;

      // Distance should remain approximately equal to rope length
      const dx = result.position.x - state.anchorPos.x;
      const dy = result.position.y - state.anchorPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      expect(dist).toBeCloseTo(initial.ropeLength, 0);
    }
  });

  it("pendulum swings back and forth (angle changes sign)", () => {
    // Start offset to the right
    const initial = initSwingState({ x: 200, y: 200 }, { x: 100, y: 100 }, { x: 0, y: 0 });

    let state = initial;
    let sawNegative = false;
    let sawPositive = false;

    // Run a few seconds of simulation
    for (let i = 0; i < 300; i++) {
      const result = stepSwing(state, 1 / 60);
      state = result.state;
      if (state.angle > 0.1) sawPositive = true;
      if (state.angle < -0.1) sawNegative = true;
    }

    // Pendulum should have swung to both sides
    expect(sawPositive).toBe(true);
    expect(sawNegative).toBe(true);
  });

  it("velocity is tangent to the swing arc", () => {
    const initial = initSwingState({ x: 200, y: 200 }, { x: 100, y: 100 }, { x: 100, y: 0 });

    const result = stepSwing(initial, 1 / 60);
    const { position, velocity } = result;

    // Velocity should be perpendicular to the rope vector
    const ropeX = position.x - initial.anchorPos.x;
    const ropeY = position.y - initial.anchorPos.y;
    // Dot product of velocity and rope should be ~0
    const dot = velocity.x * ropeX + velocity.y * ropeY;
    const ropeMag = Math.sqrt(ropeX * ropeX + ropeY * ropeY);
    const velMag = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
    if (velMag > 0.01) {
      expect(Math.abs(dot) / (ropeMag * velMag)).toBeCloseTo(0, 1);
    }
  });
});

describe("getSwingReleaseVelocity", () => {
  it("returns non-zero velocity when swinging", () => {
    const state = initSwingState({ x: 200, y: 200 }, { x: 100, y: 100 }, { x: 300, y: 0 });

    // Step a few frames to build up swing
    let current = state;
    for (let i = 0; i < 30; i++) {
      const result = stepSwing(current, 1 / 60);
      current = result.state;
    }

    const release = getSwingReleaseVelocity(current);
    const speed = Math.sqrt(release.x * release.x + release.y * release.y);
    expect(speed).toBeGreaterThan(10);
  });

  it("has minimum swing speed even with zero initial velocity", () => {
    const state = initSwingState(
      { x: 100, y: 300 }, // directly below
      { x: 100, y: 100 },
      { x: 0, y: 0 }, // no velocity
    );

    const release = getSwingReleaseVelocity(state);
    const speed = Math.sqrt(release.x * release.x + release.y * release.y);
    // Minimum angular velocity ensures meaningful swing even from standstill
    expect(speed).toBeGreaterThan(100);
  });
});
