import { describe, expect, expectTypeOf, it } from "vite-plus/test";

import { bindTo } from "../game";

describe("bindTo", () => {
  const system = {
    scale: 2,
    move(id: string, dx: number, dy: number) {
      return `${id}:${dx * this.scale},${dy * this.scale}`;
    },
    name: (id: string) => id.toUpperCase(),
  };

  it("binds only the named members, the id given and the system kept as this", () => {
    const bound = bindTo(system, "crate", ["move"]);
    expect(Object.keys(bound)).toEqual(["move"]);
    expect(bound.move(1, 3)).toBe("crate:2,6");
    expectTypeOf(bound.move).toEqualTypeOf<(dx: number, dy: number) => string>();
  });

  it("reads the member when called, so a later replacement is what runs", () => {
    const live = { ...system };
    const bound = bindTo(live, "crate", ["name"]);
    live.name = (id) => `${id}!`;
    expect(bound.name()).toBe("crate!");
  });
});
