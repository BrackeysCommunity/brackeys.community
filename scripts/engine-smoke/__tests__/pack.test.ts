import { existsSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import { describeFailure, run, VP } from "../pack";

describe("run", () => {
  test("uses the repo's own vp, which needs no PATH entry", () => {
    expect(existsSync(VP)).toBe(true);
  });

  test("names a spawn error instead of a null exit", () => {
    expect(() => run("jams-no-such-command", [])).toThrow(/jams-no-such-command failed: .*ENOENT/);
  });

  test("names the signal that killed the child", () => {
    expect(() => run("sh", ["-c", "kill -TERM $$"])).toThrow(
      /sh -c kill -TERM \$\$ was killed by SIGTERM/,
    );
  });

  test("reports the exit code and output of a failed command", () => {
    expect(() => run("sh", ["-c", "echo out; echo err >&2; exit 3"])).toThrow(
      /exited 3\nout\n\nerr/,
    );
  });

  test("describeFailure prefers the spawn error, then the signal", () => {
    expect(
      describeFailure("x", {
        status: null,
        signal: "SIGKILL",
        error: new Error("spawnSync x ENOBUFS"),
      }),
    ).toMatch(/^x failed: spawnSync x ENOBUFS/);
    expect(describeFailure("x", { status: null, signal: "SIGKILL" })).toMatch(
      /^x was killed by SIGKILL/,
    );
  });
});
