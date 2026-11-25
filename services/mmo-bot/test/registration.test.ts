import { expect, mock, test } from "bun:test";

import { syncGuildCommands } from "../../../packages/discord-kit/src/register.ts";
import { guildIds } from "../src/config.ts";
import { ADMINISTRATOR, MANIFEST, MODERATE_MEMBERS, REPORT } from "../src/manifest.ts";
import { registerGuilds } from "../src/register.ts";

test("Discord's metadata and command ordering do not trigger a guild update", async () => {
  const remote = MANIFEST.map((cmd, i) => ({
    ...cmd,
    id: String(i),
    version: "2",
    options: [],
    nsfw: false,
  })).reverse();
  const rest = { get: mock(async () => remote), put: mock(async () => {}) };
  const options = { applicationId: "app", guildId: "guild", commands: MANIFEST };
  expect(await syncGuildCommands(rest, options)).toBe("unchanged");
  expect(rest.get).toHaveBeenCalledWith("/applications/app/guilds/guild/commands");
  expect(rest.put).not.toHaveBeenCalled();
  remote[0]!.description = MANIFEST[0].description;
  expect(await syncGuildCommands(rest, options)).toBe("updated");
  expect(rest.put).toHaveBeenCalledWith("/applications/app/guilds/guild/commands", {
    body: MANIFEST,
  });
});

test("a failed command lookup propagates without overwriting the guild manifest", async () => {
  const rest = {
    get: mock(async () => {
      throw new Error("unavailable");
    }),
    put: mock(async () => {}),
  };
  await expect(
    syncGuildCommands(rest, { applicationId: "app", guildId: "guild", commands: MANIFEST }),
  ).rejects.toThrow("unavailable");
  expect(rest.put).not.toHaveBeenCalled();
});

test("every command is registered within what Discord takes for its type", () => {
  const names = MANIFEST.map((c) => c.name);
  expect(names).toContain("chronicle");
  expect(new Set(names).size).toBe(names.length);
  for (const c of MANIFEST) {
    if (c.type === 1) {
      expect(c.name).toMatch(/^[a-z]{1,32}$/);
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.description.length).toBeLessThanOrEqual(100);
    } else {
      // A message command's name shows on the menu as it is; Discord takes no description.
      expect(c.type).toBe(3);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.name.length).toBeLessThanOrEqual(32);
      expect(c.description).toBe("");
    }
  }
});

test("/staff opens to Moderate Members, /admin to Administrator, and Report to everyone", () => {
  const perms = (name: string) => {
    const c = MANIFEST.find((x) => x.name === name);
    return c && "default_member_permissions" in c ? c.default_member_permissions : undefined;
  };
  expect(perms("staff")).toBe(MODERATE_MEMBERS);
  expect(perms("admin")).toBe(ADMINISTRATOR);
  // Discord's flags: Administrator is bit 3, Moderate Members bit 40.
  expect(ADMINISTRATOR).toBe("8");
  expect(MODERATE_MEMBERS).toBe("1099511627776");
  expect(MANIFEST.find((x) => x.name === REPORT)?.type).toBe(3);
  expect(perms(REPORT)).toBeUndefined();
  for (const c of MANIFEST.filter((x) => !["staff", "admin"].includes(x.name)))
    expect(perms(c.name)).toBeUndefined();
});

test("the commands are registered to every guild named, and one guild's failure leaves the rest", async () => {
  const put = mock(async (_route: string, _body: unknown) => {});
  const rest = {
    get: mock(async (route: string) => {
      if (route.includes("/guilds/bad/")) throw new Error("missing access");
      return [];
    }),
    put,
  };
  const lines: string[] = [];
  const out = await registerGuilds(
    rest,
    { applicationId: "app", guildIds: ["one", "bad", "two"] },
    false,
    (l) => lines.push(l),
  );
  expect([...out.keys()]).toEqual(["one", "bad", "two"]);
  expect(out.get("one")).toBe("updated");
  expect(out.get("two")).toBe("updated");
  expect(out.get("bad")).toBeInstanceOf(Error);
  expect(put.mock.calls.map((c) => c[0])).toEqual([
    "/applications/app/guilds/one/commands",
    "/applications/app/guilds/two/commands",
  ]);
  expect(lines.some((l) => l.includes("bad") && l.includes("missing access"))).toBe(true);
  // An unchanged guild is left alone; force puts it anyway.
  const current = { get: mock(async () => [...MANIFEST]), put: mock(async () => {}) };
  expect(
    (
      await registerGuilds(current, { applicationId: "app", guildIds: ["one"] }, false, () => {})
    ).get("one"),
  ).toBe("unchanged");
  expect(
    (
      await registerGuilds(current, { applicationId: "app", guildIds: ["one"] }, true, () => {})
    ).get("one"),
  ).toBe("updated");
});

test("MMO_GUILD_IDS names the guilds once each, in order; unset, the primary guild alone", () => {
  expect(guildIds("111", {})).toEqual(["111"]);
  expect(guildIds("111", { MMO_GUILD_IDS: " 222, 333 ,222,," })).toEqual(["222", "333"]);
  expect(() => guildIds("111", { MMO_GUILD_IDS: "222,general" })).toThrow("general");
});
