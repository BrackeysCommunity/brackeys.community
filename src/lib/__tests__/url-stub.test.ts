import { describe, expect, it } from "vite-plus/test";

import { discordUsernameToStub, STUB_REGEX } from "../url-stub";

describe("discordUsernameToStub", () => {
  it("passes a plain username through lowercased", () => {
    expect(discordUsernameToStub("yasahiro")).toBe("yasahiro");
    expect(discordUsernameToStub("Yasahiro")).toBe("yasahiro");
  });

  it("maps dots to hyphens", () => {
    expect(discordUsernameToStub("some.user")).toBe("some-user");
  });

  it("rejects usernames that cannot become a valid stub", () => {
    // Too short after the 3-char floor.
    expect(discordUsernameToStub("ab")).toBeNull();
    // A trailing dot would leave a trailing hyphen.
    expect(discordUsernameToStub("abc.")).toBeNull();
    expect(discordUsernameToStub("")).toBeNull();
  });

  it("only ever returns stubs the settings endpoint would accept", () => {
    for (const name of ["mika", "a.b.c", "GameDev_99", "..."]) {
      const stub = discordUsernameToStub(name);
      if (stub != null) expect(stub).toMatch(STUB_REGEX);
    }
  });
});
