import { describe, expect, it } from "vite-plus/test";

import { guildRankOf, isStaffRank } from "../guild-rank";

describe("guildRankOf", () => {
  it("is null without a ranked role", () => {
    expect(guildRankOf(null)).toBeNull();
    expect(guildRankOf([])).toBeNull();
    expect(guildRankOf(["Booster"])).toBeNull();
  });

  it("names the highest rank held", () => {
    expect(guildRankOf(["BIP"])).toBe("bip");
    expect(guildRankOf(["BIP", "Guru"])).toBe("guru");
    expect(guildRankOf(["Guru", "Staff"])).toBe("staff");
    expect(guildRankOf(["Staff", "Moderator"])).toBe("moderator");
    expect(guildRankOf(["Moderator", "Admin", "Guru"])).toBe("admin");
  });

  it("separates staff from community ranks", () => {
    expect(isStaffRank("moderator")).toBe(true);
    expect(isStaffRank("guru")).toBe(false);
    expect(isStaffRank("bip")).toBe(false);
  });
});
