import { describe, expect, it } from "vite-plus/test";

import { stackOverlap, viewerStackOverlap } from "@/lib/stack-overlap";

const STACK = [
  { id: 1, name: "Godot" },
  { id: 2, name: "Pixel Art" },
  { id: 3, name: "Sound Design" },
];

describe("stackOverlap", () => {
  it("splits a stack into matched and missing, preserving stack order", () => {
    expect(stackOverlap(STACK, new Set([1, 3]))).toEqual({
      matched: ["Godot", "Sound Design"],
      missing: ["Pixel Art"],
      total: 3,
    });
  });

  it("counts total from the stack, not from the viewer's skills", () => {
    // Skills the post doesn't ask for must not inflate the denominator.
    const overlap = stackOverlap(STACK, new Set([1, 2, 3, 99, 100]));
    expect(overlap.total).toBe(3);
    expect(overlap.matched).toHaveLength(3);
  });

  it("treats an unknown skill set as matching nothing", () => {
    expect(stackOverlap(STACK, undefined)).toEqual({
      matched: [],
      missing: ["Godot", "Pixel Art", "Sound Design"],
      total: 3,
    });
  });
});

/**
 * These three null cases are the contract between the board (which applies
 * the rule in the browser against an anonymous, edge-cached `listPosts`) and
 * `getPost` (which still applies it on the server). If they diverge, a post
 * gains or loses its badge as the viewer clicks from card to detail.
 */
describe("viewerStackOverlap", () => {
  const base = { stack: STACK, viewerSkillIds: new Set([1]), authorId: "author" };

  it("returns null for a signed-out viewer", () => {
    expect(viewerStackOverlap({ ...base, viewerId: null })).toBeNull();
    expect(viewerStackOverlap({ ...base, viewerId: undefined })).toBeNull();
  });

  it("returns null on the viewer's own post", () => {
    expect(viewerStackOverlap({ ...base, viewerId: "author" })).toBeNull();
  });

  it("returns null when the post lists no stack", () => {
    expect(viewerStackOverlap({ ...base, stack: [], viewerId: "someone" })).toBeNull();
  });

  it("returns the overlap for a signed-in viewer on someone else's post", () => {
    expect(viewerStackOverlap({ ...base, viewerId: "someone" })).toEqual({
      matched: ["Godot"],
      missing: ["Pixel Art", "Sound Design"],
      total: 3,
    });
  });

  it("still reports a zero-match overlap rather than null", () => {
    // The badge component hides 0/N itself; conflating "no match" with
    // "not applicable" here would lose that distinction for other callers.
    const overlap = viewerStackOverlap({
      ...base,
      viewerSkillIds: new Set([99]),
      viewerId: "someone",
    });
    expect(overlap).not.toBeNull();
    expect(overlap?.matched).toEqual([]);
    expect(overlap?.total).toBe(3);
  });
});
