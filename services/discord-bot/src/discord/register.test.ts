import { describe, expect, test } from "bun:test";

import { buildManifest } from "../commands/manifest.ts";
import { commandsDiffer, normalizeCommands, syncGuildCommands } from "./register.ts";

/** What Discord hands back for a registered command: our fields plus its own. */
function asRemote(command: Record<string, unknown>, i: number) {
  const decorate = (option: Record<string, unknown>): Record<string, unknown> => ({
    ...option,
    required: option.required ?? false,
    options: (option.options as Record<string, unknown>[] | undefined)?.map(decorate),
  });
  return {
    id: `1000${i}`,
    application_id: "100000000000000001",
    guild_id: "100000000000000002",
    version: `2000${i}`,
    default_permission: true,
    dm_permission: true,
    integration_types: [0],
    contexts: null,
    nsfw: false,
    name_localizations: null,
    description_localizations: null,
    ...command,
    type: command.type ?? 1,
    options: (command.options as Record<string, unknown>[] | undefined)?.map(decorate),
  };
}

describe("registration diff", () => {
  const manifest = buildManifest("brackeys.test") as unknown as Record<string, unknown>[];

  test("the manifest equals its own Discord echo, in any order", () => {
    const remote = manifest.map(asRemote).reverse();
    expect(commandsDiffer(manifest, remote)).toBe(false);
  });

  test("a changed description, a new option, or a missing command is a difference", () => {
    const remote = manifest.map(asRemote);
    const tweaked = structuredClone(remote);
    (tweaked[0] as Record<string, unknown>).description = "something else";
    expect(commandsDiffer(manifest, tweaked)).toBe(true);
    expect(commandsDiffer(manifest, remote.slice(1))).toBe(true);
    const extra = structuredClone(remote);
    ((extra[0] as { options: unknown[] }).options as unknown[]).push({
      type: 3,
      name: "x",
      description: "y",
    });
    expect(commandsDiffer(manifest, extra)).toBe(true);
  });

  test("normalisation keeps only fields the manifest controls", () => {
    const [normal] = normalizeCommands([asRemote({ name: "ping", description: "p" }, 0)]);
    expect(Object.keys(normal!).sort()).toEqual(
      ["default_member_permissions", "description", "name", "nsfw", "options", "type"].sort(),
    );
  });
});

describe("syncGuildCommands", () => {
  const options = { applicationId: "100000000000000001", guildId: "100000000000000002" };

  function fakeRest(remote: unknown[]) {
    const puts: unknown[] = [];
    const rest = {
      get: async () => remote,
      put: async (_route: string, { body }: { body: unknown }) => {
        puts.push(body);
        return body;
      },
    };
    return { rest: rest as unknown as import("discord.js").REST, puts };
  }

  test("five boots against a current guild make zero PUTs", async () => {
    const commands = buildManifest("brackeys.test");
    const { rest, puts } = fakeRest(
      (commands as unknown as Record<string, unknown>[]).map(asRemote),
    );
    for (let i = 0; i < 5; i++) {
      expect(await syncGuildCommands(rest, { ...options, commands })).toBe("unchanged");
    }
    expect(puts).toHaveLength(0);
  });

  test("a stale guild gets exactly one PUT of the whole manifest", async () => {
    const commands = buildManifest("brackeys.test");
    const { rest, puts } = fakeRest([]);
    expect(await syncGuildCommands(rest, { ...options, commands })).toBe("updated");
    expect(puts).toEqual([commands]);
  });

  test("--force skips the diff", async () => {
    const commands = buildManifest("brackeys.test");
    const { rest, puts } = fakeRest(
      (commands as unknown as Record<string, unknown>[]).map(asRemote),
    );
    expect(await syncGuildCommands(rest, { ...options, commands, force: true })).toBe("updated");
    expect(puts).toHaveLength(1);
  });
});
