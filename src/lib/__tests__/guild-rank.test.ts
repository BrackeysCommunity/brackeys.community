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
    expect(guildRankOf(["Admin", "Dev", "Brackeys Team"])).toBe("brackeys");
    // The override wins over every staff role its holder also carries —
    // including the Admin granted by the same list.
    expect(guildRankOf(["BIP", "Admin", "Dev"])).toBe("dev");
    expect(guildRankOf(["BIP", "Guru"])).toBe("guru");
    expect(guildRankOf(["Guru", "Staff"])).toBe("staff");
    expect(guildRankOf(["Staff", "Moderator"])).toBe("moderator");
    expect(guildRankOf(["Moderator", "Admin", "Guru"])).toBe("admin");
  });

  it("separates staff from community ranks", () => {
    expect(isStaffRank("brackeys")).toBe(true);
    expect(isStaffRank("dev")).toBe(true);
    expect(isStaffRank("moderator")).toBe(true);
    expect(isStaffRank("guru")).toBe(false);
    expect(isStaffRank("bip")).toBe(false);
  });
});
