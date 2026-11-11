import { describe, expect, it } from "vite-plus/test";

import { pointerBit, POINTER_BUTTONS } from "../input-codes";

describe("pointerBit", () => {
  it("is the DOM `buttons` bit of each pointer button", () => {
    expect(POINTER_BUTTONS.map(pointerBit)).toEqual([1, 2, 4]);
    expect(pointerBit("middle")).toBe(4);
    expect(pointerBit("secondary")).toBe(2);
  });
});
