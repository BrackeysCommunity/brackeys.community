import { describe, expect, it } from "vite-plus/test";

import {
  CLEARED_MEMBER_FILTERS,
  countActiveMemberFilters,
  memberFacetInput,
} from "@/components/members/members-filters";

describe("member facet input", () => {
  it("maps URL search params onto the shape listMembers takes", () => {
    const input = memberFacetInput({ q: " godot ", skills: [1, 2], roles: [3] });
    expect(input.search).toBe("godot");
    expect(input.skillIds).toEqual([1, 2]);
    expect(input.roleIds).toEqual([3]);
  });

  it("omits empty facet selections rather than sending empty arrays", () => {
    const input = memberFacetInput({});
    expect(input.skillIds).toBeUndefined();
    expect(input.roleIds).toBeUndefined();
  });

  it("sends matchAll only alongside two or more picked skills", () => {
    expect(memberFacetInput({ skills: [1, 2], matchAll: true }).matchAll).toBe(true);
    // On one skill the modes agree, and with none there's nothing to
    // modify — a stale flag in the URL must not fork the query cache.
    expect(memberFacetInput({ skills: [1], matchAll: true }).matchAll).toBeUndefined();
    expect(memberFacetInput({ matchAll: true }).matchAll).toBeUndefined();
    expect(memberFacetInput({ skills: [1, 2] }).matchAll).toBeUndefined();
  });

  it("counts matchAll as a modifier, not a constraint of its own", () => {
    expect(countActiveMemberFilters({ skills: [1, 2], matchAll: true })).toBe(2);
  });

  it("clears matchAll with the stack it modifies", () => {
    expect(CLEARED_MEMBER_FILTERS).toMatchObject({ skills: undefined, matchAll: undefined });
  });
});
