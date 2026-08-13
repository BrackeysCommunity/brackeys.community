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
 */
describe("applyRoleOverrides", () => {
  it("grants Admin to a listed id holding no guild roles", () => {
    process.env.ADMIN_DISCORD_IDS = ID;
    expect(applyRoleOverrides(ID, [])).toEqual(["Admin"]);
  });

  it("keeps existing roles alongside the grant", () => {
    process.env.ADMIN_DISCORD_IDS = ID;
    expect(applyRoleOverrides(ID, ["Moderator"])).toEqual(["Moderator", "Admin"]);
  });

  it("does not duplicate an Admin the guild already granted", () => {
    process.env.ADMIN_DISCORD_IDS = ID;
    expect(applyRoleOverrides(ID, ["Admin"])).toEqual(["Admin"]);
  });

  it("leaves unlisted users untouched", () => {
    process.env.ADMIN_DISCORD_IDS = ID;
    expect(applyRoleOverrides(OTHER, ["Staff"])).toEqual(["Staff"]);
    expect(applyRoleOverrides(null, [])).toEqual([]);
  });

  it("parses a comma-separated list, tolerating whitespace and blanks", () => {
    process.env.ADMIN_DISCORD_IDS = ` ${OTHER} , ,${ID} `;
    expect(applyRoleOverrides(ID, [])).toEqual(["Admin"]);
    expect(applyRoleOverrides(OTHER, [])).toEqual(["Admin"]);
  });

  it("grants nothing when the variable is unset or empty", () => {
    delete process.env.ADMIN_DISCORD_IDS;
    expect(applyRoleOverrides(ID, [])).toEqual([]);
    process.env.ADMIN_DISCORD_IDS = "";
    expect(applyRoleOverrides(ID, [])).toEqual([]);
  });
});
