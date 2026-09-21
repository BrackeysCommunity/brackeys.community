import { afterEach, describe, expect, it } from "vite-plus/test";

import { applyRoleOverrides } from "@/lib/discord";

const ID = "111111111111111111";
const OTHER = "222222222222222222";

const original = process.env.ADMIN_DISCORD_IDS;
afterEach(() => {
  if (original === undefined) delete process.env.ADMIN_DISCORD_IDS;
  else process.env.ADMIN_DISCORD_IDS = original;
});

/**
 * The `ADMIN_DISCORD_IDS` break-glass. Read from env at call time (not
 * module load) so a deploy-time variable takes effect, and unioned with the
 * synced guild roles rather than replacing them.
 *
 * The list grants two names: "Admin", which the gates read, and "Dev",
 * which nothing reads but `guildRankOf` — the two travel together, so an
 * id added during an outage gets the chip as well as the access.
 */
describe("applyRoleOverrides", () => {
  it("grants Admin and Dev to a listed id holding no guild roles", () => {
    process.env.ADMIN_DISCORD_IDS = ID;
    expect(applyRoleOverrides(ID, [])).toEqual(["Admin", "Dev"]);
  });

  it("keeps existing roles alongside the grant", () => {
    process.env.ADMIN_DISCORD_IDS = ID;
    expect(applyRoleOverrides(ID, ["Moderator"])).toEqual(["Moderator", "Admin", "Dev"]);
  });

  it("does not duplicate a name the guild already granted", () => {
    process.env.ADMIN_DISCORD_IDS = ID;
    expect(applyRoleOverrides(ID, ["Admin"])).toEqual(["Admin", "Dev"]);
    expect(applyRoleOverrides(ID, ["Admin", "Dev"])).toEqual(["Admin", "Dev"]);
  });

  it("leaves unlisted users untouched", () => {
    process.env.ADMIN_DISCORD_IDS = ID;
    expect(applyRoleOverrides(OTHER, ["Staff"])).toEqual(["Staff"]);
    expect(applyRoleOverrides(null, [])).toEqual([]);
  });

  it("parses a comma-separated list, tolerating whitespace and blanks", () => {
    process.env.ADMIN_DISCORD_IDS = ` ${OTHER} , ,${ID} `;
    expect(applyRoleOverrides(ID, [])).toEqual(["Admin", "Dev"]);
    expect(applyRoleOverrides(OTHER, [])).toEqual(["Admin", "Dev"]);
  });

  it("grants nothing when the variable is unset or empty", () => {
    delete process.env.ADMIN_DISCORD_IDS;
    expect(applyRoleOverrides(ID, [])).toEqual([]);
    process.env.ADMIN_DISCORD_IDS = "";
    expect(applyRoleOverrides(ID, [])).toEqual([]);
  });
});
