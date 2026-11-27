import { describe, expect, test } from "vite-plus/test";

import {
  canonical,
  cacheKey,
  capKey,
  capOf,
  capPattern,
  costKey,
  digestOf,
  failKey,
} from "../src/index.ts";
import { toyInput, toyUse } from "./toy.ts";

describe("canonical", () => {
  test("key order does not matter, array order does", () => {
    const a = { b: [3, { y: 1, x: 2 }], a: "s", c: { e: true, d: null } };
    const b = { c: { d: null, e: true }, a: "s", b: [3, { x: 2, y: 1 }] };
    expect(canonical(a)).toBe(canonical(b));
    expect(canonical(a)).toBe('{"a":"s","b":[3,{"x":2,"y":1}],"c":{"d":null,"e":true}}');
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
  });

  test("undefined fields drop, odd numbers settle", () => {
    expect(canonical({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonical([undefined, -0, Number.NaN, Infinity])).toBe("[null,0,null,null]");
    expect(canonical("é\n")).toBe(JSON.stringify("é\n"));
    expect(() => canonical({ a: 1n })).toThrow(TypeError);
  });

  test("it is stable across runs", () => {
    expect(digestOf({})).toBe("44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
    expect(digestOf({ b: 2, a: 1 })).toBe(digestOf({ a: 1, b: 2 }));
    expect(digestOf({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("keys", () => {
  test("the cache key names the version, use, model and digest", () => {
    const spec = toyUse();
    const key = cacheKey(spec, toyInput());
    expect(key).toBe(`mmo-narr:v1:chronicle:claude-haiku-5-5:${digestOf(spec.input(toyInput()))}`);
    expect(cacheKey({ ...spec, version: 2 }, toyInput())).not.toBe(key);
    expect(cacheKey(spec, toyInput(), "claude-sonnet-5-5")).not.toBe(key);
    expect(cacheKey(spec, toyInput("again"))).not.toBe(key);
    expect(cacheKey(toyUse("stage"), toyInput())).not.toBe(key);
  });

  test("fail, cap and cost keys", () => {
    expect(failKey("mmo-narr:v1:stage:m:abc")).toBe("mmo-narr:fail:v1:stage:m:abc");
    expect(capKey("voice", "u1", 7)).toBe("mmo-narr:cap:voice:u1:7");
    expect(costKey(7)).toBe("mmo-narr:cost:7");
  });

  test("capOf reads a cap key back and refuses anything else", () => {
    expect(capOf(capKey("voice", "u1", 7))).toEqual({ use: "voice", who: "u1", day: 7 });
    expect(capOf(capKey("recap", "npc-9", 0))).toEqual({ use: "recap", who: "npc-9", day: 0 });
    expect(capOf("mmo-narr:cost:7")).toBeNull();
    expect(capOf("mmo-narr:last:npc-7:u1")).toBeNull();
    expect(capOf("mmo-narr:cap:voice:u1:x7")).toBeNull();
    expect(capOf("mmo-narr:cap:u1:7")).toBeNull();
    expect(capPattern("u1")).toBe("mmo-narr:cap:*:u1:*");
  });
});
