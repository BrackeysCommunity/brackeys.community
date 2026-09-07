import { type REST, type RESTPostAPIApplicationCommandsJSONBody, Routes } from "discord.js";

/**
 * Guild command registration with a diff in front of it.
 *
 * A bulk PUT counts one create per command against the 200-per-day guild
 * budget, so a crash loop that re-PUTs on every boot spends it by lunch.
 * The service GETs what the guild has, normalises both sides to the
 * fields *we* set, and PUTs only when they differ — five restarts, one PUT.
 */

type Json = Record<string, unknown>;

interface NormalOption {
  type: number;
  name: string;
  description: string;
  required: boolean;
  autocomplete: boolean;
  choices: { name: string; value: string | number }[];
  options: NormalOption[];
  min_value: number | null;
  max_value: number | null;
  min_length: number | null;
  max_length: number | null;
}

interface NormalCommand {
  type: number;
  name: string;
  description: string;
  default_member_permissions: string | null;
  nsfw: boolean;
  options: NormalOption[];
}

function normalizeOption(raw: Json): NormalOption {
  return {
    type: Number(raw.type),
    name: String(raw.name),
    description: String(raw.description ?? ""),
    required: Boolean(raw.required),
    autocomplete: Boolean(raw.autocomplete),
    choices: ((raw.choices as Json[] | undefined) ?? []).map((c) => ({
      name: String(c.name),
      value: c.value as string | number,
    })),
    options: ((raw.options as Json[] | undefined) ?? []).map(normalizeOption),
    min_value: numberOrNull(raw.min_value),
    max_value: numberOrNull(raw.max_value),
    min_length: numberOrNull(raw.min_length),
    max_length: numberOrNull(raw.max_length),
  };
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

/**
 * Only the fields the manifest sets take part in the comparison. Discord
 * echoes plenty we never send (`id`, `version`, `integration_types`,
 * `dm_permission`, localisations…); diffing on those would make every
 * boot look like a change.
 */
export function normalizeCommands(commands: readonly unknown[]): NormalCommand[] {
  return (commands as Json[])
    .map((raw) => ({
      type: Number(raw.type ?? 1),
      name: String(raw.name),
      description: String(raw.description ?? ""),
      default_member_permissions:
        raw.default_member_permissions == null ? null : String(raw.default_member_permissions),
      nsfw: Boolean(raw.nsfw),
      options: ((raw.options as Json[] | undefined) ?? []).map(normalizeOption),
    }))
    .sort((a, b) => a.type - b.type || a.name.localeCompare(b.name));
}

export function commandsDiffer(local: readonly unknown[], remote: readonly unknown[]): boolean {
  return JSON.stringify(normalizeCommands(local)) !== JSON.stringify(normalizeCommands(remote));
}

export interface SyncOptions {
  applicationId: string;
  guildId: string;
  commands: RESTPostAPIApplicationCommandsJSONBody[];
  /** Skip the diff and PUT regardless — the `register --force` escape hatch. */
  force?: boolean;
  log?: (line: string) => void;
}

export type SyncResult = "unchanged" | "updated";

export async function syncGuildCommands(rest: REST, options: SyncOptions): Promise<SyncResult> {
  const { applicationId, guildId, commands, force = false, log = () => {} } = options;
  const route = Routes.applicationGuildCommands(applicationId, guildId);

  if (!force) {
    const remote = (await rest.get(route)) as unknown[];
    if (!commandsDiffer(commands, remote)) {
      log(`[register] ${remote.length} guild commands already current`);
      return "unchanged";
    }
    log(
      `[register] guild has ${remote.length} commands, manifest has ${commands.length} — updating`,
    );
  }

  await rest.put(route, { body: commands });
  log(`[register] registered ${commands.length} guild commands`);
  return "updated";
}
