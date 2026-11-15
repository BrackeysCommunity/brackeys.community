// @vitest-environment node
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vite-plus/test";

import { deflateStored, zlibStream } from "../export/png-write";

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);

describe("deflateStored", () => {
  it.each([0, 1, 65_535, 65_536, 140_000])("round-trips %i bytes through zlib", (n) => {
    const raw = bytes(n);
    expect(new Uint8Array(inflateSync(zlibStream(deflateStored(raw), raw)))).toEqual(raw);
  });

  it("splits at 65535 bytes and marks only the final block last", () => {
    const out = deflateStored(bytes(65_536));
    expect(out.length).toBe(65_536 + 10);
    expect([...out.subarray(0, 5)]).toEqual([0, 0xff, 0xff, 0, 0]);
    expect([...out.subarray(65_540, 65_545)]).toEqual([1, 1, 0, 0xfe, 0xff]);
  });

  it("writes one empty final block for no input", () => {
    expect([...deflateStored(new Uint8Array(0))]).toEqual([1, 0, 0, 0xff, 0xff]);
  });
});
