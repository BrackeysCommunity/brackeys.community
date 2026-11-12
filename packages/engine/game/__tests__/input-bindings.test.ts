import { describe, expect, it } from "vite-plus/test";

import { declaredBindings, keysProblems } from "../input-bindings";
import { KEY_TO_CODE } from "../input-codes";

describe("keysProblems", () => {
  it("accepts every key the table knows", () => {
    expect(keysProblems({ keys: Object.keys(KEY_TO_CODE) })).toEqual([]);
  });

  it("refuses an unknown key with a guess: another case, or the key a code name types", () => {
    expect(keysProblems({ keys: ["arrowup", "space", "Hyper", 7] })).toEqual([
      {
        code: "binding-unknown",
        message: 'unknown 0.x key "arrowup"; did you mean "ArrowUp"?',
        path: "/keys/0",
        expected: "a US-layout KeyboardEvent.key the key table knows",
        got: '"arrowup"',
        hint: 'did you mean "ArrowUp"?',
      },
      {
        code: "binding-unknown",
        message: 'unknown 0.x key "space"; did you mean " "?',
        path: "/keys/1",
        expected: "a US-layout KeyboardEvent.key the key table knows",
        got: '"space"',
        hint: 'did you mean " "? Or bind { "device": "key", "code": "Space" }.',
      },
      {
        code: "binding-unknown",
        message: 'unknown 0.x key "Hyper"',
        path: "/keys/2",
        expected: "a US-layout KeyboardEvent.key the key table knows",
        got: '"Hyper"',
        hint: 'Bind keys by code instead: { "device": "key", "code": "KeyA" }.',
      },
      {
        code: "binding-unknown",
        message: "unknown 0.x key 7",
        path: "/keys/3",
        expected: "a US-layout KeyboardEvent.key the key table knows",
        got: "7",
        hint: 'Bind keys by code instead: { "device": "key", "code": "KeyA" }.',
      },
    ]);
  });

  it("reads keys only when the action has no bindings", () => {
    expect(keysProblems({ keys: ["nope"], bindings: [] })).toEqual([]);
  });

  it("is a refusal only: an unknown key still declares no binding", () => {
    expect(declaredBindings({ keys: ["space", " "] })).toEqual([{ device: "key", code: "Space" }]);
  });
});
