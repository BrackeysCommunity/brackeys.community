import { describe, expect, it } from "vite-plus/test";

import { EVENTS, FLOWS, flowStep } from "@/lib/analytics-events";

const names = Object.values(EVENTS);

/**
 * The taxonomy's value is that PostHog's event list stays browsable, and
 * that degrades one well-meaning addition at a time. These hold the shape.
 */
describe("event taxonomy", () => {
  it("names every event <domain>_<object>_<action> in snake_case", () => {
    for (const name of names) {
      expect(name, `${name} is not snake_case`).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/);
    }
  });

  it("groups every event under a known domain", () => {
    const domains = new Set(["auth", "collab", "team", "jam", "profile"]);
    for (const name of names) {
      expect(domains, `${name} introduces an unlisted domain`).toContain(name.split("_")[0]);
    }
  });

  it("has no duplicate wire names", () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it("never collides with PostHog's reserved `$`-prefixed namespace", () => {
    for (const name of names) expect(name.startsWith("$")).toBe(false);
  });
});

describe("flowStep", () => {
  it("carries the flow, the step, and a 1-based position", () => {
    expect(flowStep(FLOWS.collabPost, "roles", 4, 5)).toEqual({
      flow: "collab_post",
      step: "roles",
      step_index: 4,
      step_count: 5,
    });
  });
});
