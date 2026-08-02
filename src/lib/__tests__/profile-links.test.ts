import { describe, expect, it } from "vite-plus/test";

import { profileLinkParams, profileSlug } from "../profile-links";

describe("profileSlug", () => {
  it("prefers a claimed vanity stub", () => {
    expect(profileSlug({ id: "u_123", urlStub: "mika" })).toBe("mika");
  });

  it("falls back to the id when no stub is set", () => {
    expect(profileSlug({ id: "u_123", urlStub: null })).toBe("u_123");
    expect(profileSlug({ id: "u_123" })).toBe("u_123");
  });

  it("treats an empty stub as unclaimed", () => {
    // `/profile/` would not resolve; the id always does.
    expect(profileSlug({ id: "u_123", urlStub: "" })).toBe("u_123");
  });
});

describe("profileLinkParams", () => {
  it("wraps the slug as router params", () => {
    expect(profileLinkParams({ id: "u_123", urlStub: "mika" })).toEqual({ userId: "mika" });
  });
});
