import { describe, expect, test } from "bun:test";

import { RefTable, fitLinks, numberLinks, resolveLinks, storeLinks } from "./refs.ts";

const A = "1300000000000000001";
const B = "1300000000000000002";
const url = (id: string) => `https://discord.com/channels/1/2/${id}`;

describe("refs", () => {
  test("number the same id once, in the order seen", () => {
    const refs = new RefTable();
    expect([refs.number(A), refs.number(B), refs.number(A)]).toEqual([1, 2, 1]);
    expect(refs.id(2)).toBe(B);
    expect(refs.id(3)).toBeUndefined();
  });

  test("survive a cache round trip with new numbers", () => {
    const first = new RefTable();
    first.number(A);
    first.number(B);
    const stored = storeLinks("[voting can't fix it](#2), [nope](#7)", first);
    expect(stored).toBe(`[voting can't fix it](<m:${B}>), nope`);

    const second = new RefTable();
    second.number(A);
    expect(numberLinks(stored, second)).toBe("[voting can't fix it](#2), nope");
    expect(resolveLinks("[voting can't fix it](#2)", second, url)).toBe(
      `[voting can't fix it](${url(B)})`,
    );
  });

  test("leave other markdown links and bracketed text alone", () => {
    const refs = new RefTable();
    refs.number(A);
    expect(resolveLinks("[docs](https://example.com) and [maybe] (#1)", refs, url)).toBe(
      "[docs](https://example.com) and [maybe] (#1)",
    );
  });

  test("never show a bare number as link text", () => {
    const refs = new RefTable();
    refs.number(A);
    expect(resolveLinks("asked ([#1](#1))", refs, url)).toBe(`asked ([message](${url(A)}))`);
  });

  test("fit by unlinking from the end, never cutting words", () => {
    const text = `start [one](${url(A)}) middle [two](${url(B)}) end`;
    const fitted = fitLinks(text, text.length - 10);
    expect(fitted).toBe(`start [one](${url(A)}) middle two end`);
    expect(fitLinks("short", 100)).toBe("short");
  });
});
