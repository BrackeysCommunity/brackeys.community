// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { missingKeyNotice, runnerKey } from "../engine-perf";

describe("engine:perf's runner key", () => {
  it("names the runtime that ran it, Bun's own major rather than the Node version it reports", () => {
    expect(runnerKey("x64", { node: "24.3.0", bun: "1.4.4" })).toBe("x64/bun1");
    expect(runnerKey("arm64", { node: "26.1.0" })).toBe("arm64/node26");
  });

  it("says loudly on CI that a runner with no baseline checks nothing", () => {
    const notice = missingKeyNotice("x64/bun1");
    expect(notice).toContain("NO BASELINE for x64/bun1");
    expect(notice).toContain("checks nothing");
    expect(notice.split("\n")).toHaveLength(4);
  });
});
