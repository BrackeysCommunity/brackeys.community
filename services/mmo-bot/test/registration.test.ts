import { expect, mock, test } from "bun:test";

import {
  syncGlobalCommands,
  syncGuildCommands,
} from "../../../packages/discord-kit/src/register.ts";
import { commandScope, guildIds } from "../src/config.ts";
import { ADMINISTRATOR, MANIFEST, MODERATE_MEMBERS, REPORT } from "../src/manifest.ts";
import { GLOBAL, register, registerGuilds, registerPlan } from "../src/register.ts";

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
      // Discord's rule for a slash command's name, in the lower case it asks for.
      expect(c.name).toMatch(/^[-_a-z0-9]{1,32}$/);
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

test("MMO_COMMANDS is guild unless it says global, and nothing else", () => {
  expect(commandScope({})).toBe("guild");
  expect(commandScope({ MMO_COMMANDS: " global " })).toBe("global");
  expect(commandScope({ MMO_COMMANDS: "guild" })).toBe("guild");
  expect(() => commandScope({ MMO_COMMANDS: "everywhere" })).toThrow("everywhere");
  expect(guildIds("", {})).toEqual([]);
});

/** A REST that holds commands per route, as Discord does, and counts each PUT. */
function fakeDiscord(start: Record<string, unknown[]> = {}) {
  const routes = new Map<string, unknown[]>(Object.entries(start));
  const puts: string[] = [];
  return {
    routes,
    puts,
    rest: {
      get: mock(async (route: string) =>
        (routes.get(route) ?? []).map((c, i) => ({
          id: String(i),
          version: "1",
          ...(c as object),
        })),
      ),
      put: mock(async (route: string, { body }: { body: unknown }) => {
        puts.push(route);
        routes.set(route, [...(body as unknown[])]);
      }),
    },
  };
}

test("global commands are diffed like a guild's: put once, then left alone unless forced", async () => {
  const d = fakeDiscord();
  expect(await syncGlobalCommands(d.rest, "app", MANIFEST)).toBe("updated");
  expect(d.puts).toEqual(["/applications/app/commands"]);
  expect(await syncGlobalCommands(d.rest, "app", MANIFEST)).toBe("unchanged");
  expect(d.puts).toHaveLength(1);
  expect(await syncGlobalCommands(d.rest, "app", MANIFEST, { force: true })).toBe("updated");
  expect(d.puts).toHaveLength(2);
  // A changed description is a change.
  const changed = MANIFEST.map((c, i) => (i === 0 ? { ...c, description: "Other words" } : c));
  expect(await syncGlobalCommands(d.rest, "app", changed)).toBe("updated");
  expect(d.routes.get("/applications/app/commands")).toEqual(changed);
});

test("the Activity's entry point stays out of the diff and is sent back with every global PUT", async () => {
  const entry = {
    type: 4,
    name: "launch",
    description: "Open the Activity",
    handler: 2,
    integration_types: [0],
    contexts: [0],
  };
  const d = fakeDiscord({ "/applications/app/commands": [entry] });
  expect(await syncGlobalCommands(d.rest, "app", MANIFEST)).toBe("updated");
  const held = d.routes.get("/applications/app/commands") as Record<string, unknown>[];
  expect(held.slice(0, MANIFEST.length)).toEqual([...MANIFEST]);
  expect(held.at(-1)).toEqual({ id: "0", ...entry });
  // The manifest and the entry point as Discord holds them: no change.
  expect(await syncGlobalCommands(d.rest, "app", MANIFEST)).toBe("unchanged");
  expect(await syncGlobalCommands(d.rest, "app", MANIFEST, { force: true })).toBe("updated");
  expect((d.routes.get("/applications/app/commands") as { type: number }[]).at(-1)!.type).toBe(4);
  expect(d.puts).toHaveLength(2);
});

test("the global scope registers once for every server, and touches no guild", async () => {
  const d = fakeDiscord();
  const config = { applicationId: "app", guildIds: ["111", "222"] };
  const lines: string[] = [];
  const out = await register(d.rest, config, { scope: "global" }, (l) => lines.push(l));
  expect([...out.entries()]).toEqual([[GLOBAL, "updated"]]);
  expect(d.puts).toEqual(["/applications/app/commands"]);
  expect((await register(d.rest, config, { scope: "global" }, () => {})).get(GLOBAL)).toBe(
    "unchanged",
  );
  expect(lines.some((l) => l.includes("global"))).toBe(true);
});

test("the guild scope registers to each guild and nothing globally", async () => {
  const d = fakeDiscord();
  const out = await register(
    d.rest,
    { applicationId: "app", guildIds: ["111", "222"] },
    { scope: "guild" },
    () => {},
  );
  expect([...out.keys()]).toEqual(["111", "222"]);
  expect(d.puts).toEqual([
    "/applications/app/guilds/111/commands",
    "/applications/app/guilds/222/commands",
  ]);
});

test("--clear-guilds empties the guild copies beside the global commands, once", async () => {
  const d = fakeDiscord({
    "/applications/app/guilds/111/commands": [...MANIFEST],
    "/applications/app/guilds/222/commands": [],
  });
  const config = { applicationId: "app", guildIds: ["111", "222"] };
  const plan = registerPlan(["--global", "--clear-guilds"], "guild");
  expect(plan).toEqual({ scope: "global", force: false, clearGuilds: true });
  const out = await register(d.rest, config, plan, () => {});
  expect(out.get(GLOBAL)).toBe("updated");
  expect(out.get("111")).toBe("updated");
  // A guild already empty is not put again.
  expect(out.get("222")).toBe("unchanged");
  expect(d.routes.get("/applications/app/guilds/111/commands")).toEqual([]);
  expect(d.routes.get("/applications/app/commands")).toEqual([...MANIFEST]);
  expect(d.puts).toEqual(["/applications/app/commands", "/applications/app/guilds/111/commands"]);
  // In the guild scope clearing replaces registration: no guild gets the manifest back.
  const again = await register(d.rest, config, registerPlan(["--clear-guilds"], "guild"), () => {});
  expect([...again.values()]).toEqual(["unchanged", "unchanged"]);
  expect(d.routes.get("/applications/app/guilds/111/commands")).toEqual([]);
});

test("register takes only its three flags, and MMO_COMMANDS when --global is absent", () => {
  expect(registerPlan([], "global")).toEqual({ scope: "global", force: false, clearGuilds: false });
  expect(registerPlan(["--force"], "guild")).toEqual({
    scope: "guild",
    force: true,
    clearGuilds: false,
  });
  expect(() => registerPlan(["--globl"], "guild")).toThrow("--globl");
});

test("a failed global registration is reported and the guild clearing still runs", async () => {
  const put = mock(async (route: string, _body: unknown) => {
    if (route === "/applications/app/commands") throw new Error("rate limited");
  });
  const rest = { get: mock(async () => [...MANIFEST]), put };
  const lines: string[] = [];
  const out = await register(
    rest,
    { applicationId: "app", guildIds: ["111"] },
    { scope: "global", force: true, clearGuilds: true },
    (l) => lines.push(l),
  );
  expect(out.get(GLOBAL)).toBeInstanceOf(Error);
  expect(out.get("111")).toBe("updated");
  expect(lines.some((l) => l.includes("global failed: rate limited"))).toBe(true);
});
