import { expect, mock, test } from "bun:test";

import { syncGuildCommands } from "../../../packages/discord-kit/src/register.ts";
import { MANIFEST } from "../src/manifest.ts";

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

test("/chronicle is registered beside the others, each within what Discord takes", () => {
  const names = MANIFEST.map((c) => c.name);
  expect(names).toContain("chronicle");
  expect(new Set(names).size).toBe(names.length);
  for (const c of MANIFEST) {
    expect(c.name).toMatch(/^[a-z]{1,32}$/);
    expect(c.description.length).toBeLessThanOrEqual(100);
  }
});
