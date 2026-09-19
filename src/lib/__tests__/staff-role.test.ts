import { describe, expect, it } from "vite-plus/test";

import { staffRoleOf } from "../staff-role";

describe("staffRoleOf", () => {
  it("is null without a staff role", () => {
    expect(staffRoleOf(null)).toBeNull();
    expect(staffRoleOf([])).toBeNull();
    expect(staffRoleOf(["Booster"])).toBeNull();
  });

  it("names the highest role held", () => {
    expect(staffRoleOf(["Staff"])).toBe("staff");
    expect(staffRoleOf(["Staff", "Moderator"])).toBe("moderator");
    expect(staffRoleOf(["Moderator", "Admin", "Staff"])).toBe("admin");
  });
});
