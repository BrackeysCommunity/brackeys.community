import { describe, expect, it } from "vite-plus/test";

import { findTrigger } from "@/lib/textarea-autocomplete";

const at = (text: string) => findTrigger(text, text.length);

describe("findTrigger", () => {
  it("opens on a colon and two letters", () => {
    expect(at("so :fi")).toEqual({ kind: "emoji", query: "fi", start: 3 });
    expect(at(":fi")).toEqual({ kind: "emoji", query: "fi", start: 0 });
    expect(at("so :f")).toBeNull();
  });

  it("finds the word at the caret, not the end", () => {
    expect(findTrigger("a :fir b", 6)).toEqual({ kind: "emoji", query: "fir", start: 2 });
  });

  it("ignores colons glued to a word, times and URLs", () => {
    expect(at("12:30")).toBeNull();
    expect(at("https://example")).toBeNull();
    expect(at("note:todo")).toBeNull();
  });

  it("closes once the name is finished", () => {
    expect(at("so :fire:")).toBeNull();
  });

  it("offers mentions after a boundary", () => {
    expect(at("hey @jo")).toEqual({ kind: "mention", query: "jo", start: 4 });
    expect(at("me@mail")).toBeNull();
  });

  it("stays quiet inside inline code", () => {
    expect(at("run `:fi")).toBeNull();
    expect(at("`x` :fi")).toEqual({ kind: "emoji", query: "fi", start: 4 });
  });
});
