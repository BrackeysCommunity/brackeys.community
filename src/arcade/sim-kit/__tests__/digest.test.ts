import { describe, expect, it } from "vite-plus/test";

import { canonicalize, digest32, digestOf } from "../digest.ts";

describe("canonicalize", () => {
  it("sorts object keys so key order cannot change a digest", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("keeps array order, which is the spin's stage order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });

  it("drops undefined fields rather than encoding them", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("encodes the primitives a spin summary carries", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(false)).toBe("false");
    expect(canonicalize(-7)).toBe("-7");
    expect(canonicalize("17")).toBe('"17"');
  });

  it("refuses a float, because one in a summary is a determinism bug", () => {
    expect(() => canonicalize({ payout: 1.5 })).toThrow(TypeError);
    expect(() => canonicalize([0.1])).toThrow(TypeError);
  });

  it("refuses a value it cannot encode", () => {
    expect(() => canonicalize(() => 1)).toThrow(TypeError);
  });

  it("nests", () => {
    expect(canonicalize({ pockets: [[17, 3_000_000]], net: -5 })).toBe(
      '{"net":-5,"pockets":[[17,3000000]]}',
    );
  });
});

describe("digest32", () => {
  it("is stable", () => {
    expect(digest32("en-prison")).toBe(digest32("en-prison"));
  });

  it("returns a uint32", () => {
    const h = digest32("some canonical spin summary");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffff_ffff);
  });

  it("separates strings that differ by one character", () => {
    expect(digest32("17")).not.toBe(digest32("18"));
  });
});

describe("digestOf", () => {
  it("ignores key order", () => {
    expect(digestOf({ net: 1, stake: 2 })).toBe(digestOf({ stake: 2, net: 1 }));
  });

  it("separates a winning summary from a losing one", () => {
    expect(digestOf({ net: 35 })).not.toBe(digestOf({ net: -1 }));
  });
});
