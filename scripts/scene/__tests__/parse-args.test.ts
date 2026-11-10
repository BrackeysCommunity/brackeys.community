// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { COMMANDS, parseArgs } from "../commands";

describe("parseArgs", () => {
  it("collects repeatable flags into an array in flag order", () => {
    const r = parseArgs(COMMANDS.step, [
      "s",
      "--command",
      "3:end-turn",
      "--elapse=4:1000",
      '--command=5:move={"to":[1,2]}',
    ]);
    expect(r).toMatchObject({
      ok: true,
      args: {
        positionals: ["s"],
        flags: { command: ["3:end-turn", '5:move={"to":[1,2]}'], elapse: ["4:1000"] },
      },
    });
  });

  it("gives a one-element array for a single repeatable flag", () => {
    const r = parseArgs(COMMANDS.step, ["s", "--command", "1:a"]);
    expect(r).toMatchObject({ ok: true, args: { flags: { command: ["1:a"] } } });
  });

  it("keeps the last value of a non-repeatable flag", () => {
    const r = parseArgs(COMMANDS.step, ["s", "--ticks", "1", "--ticks", "9"]);
    expect(r).toMatchObject({ ok: true, args: { flags: { ticks: "9" } } });
  });

  it("rejects a repeatable flag on a command that doesn't take it", () => {
    expect(parseArgs(COMMANDS.grid, ["s", "--command", "1:a"])).toEqual({
      ok: false,
      error: "unknown flag --command",
    });
  });

  it("rejects a repeatable flag with no value", () => {
    expect(parseArgs(COMMANDS.step, ["s", "--command"])).toEqual({
      ok: false,
      error: "--command needs a value",
    });
  });
});
