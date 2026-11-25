import type { Redis } from "ioredis";

import type * as api from "./api.ts";
import { fields, type Id } from "./ids.ts";
import { HELD_KEY, type HeldName } from "./narration/names.ts";
import { SWITCH_KEY } from "./narration/switch.ts";
import type { World } from "./world.ts";

/**
 * Each server's house as the bot keeps it (GDD 14): a short cache of the
 * world's read, the staff rule a member is judged by, the channels and
 * roles its settings map, and the narration switch its settings drive.
 * The world stays the authority: the bot only marks who speaks as staff.
 */

/** How long one read of a house is trusted; a write from the bot drops it at once. */
export const HOUSE_TTL_MS = 60_000;

/** The channels a server may map (GDD 14.7). */
export const CHANNEL_KINDS = ["chronicle", "events", "market", "board", "log"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

const MINUTES_PER_DAY = 24 * 60;

/** Whether a member speaks as staff: Moderate Members, or a role the server's settings name. */
export function staffOf(
  settings: api.HouseSettings | undefined,
  moderates: boolean,
  roles: readonly string[],
): boolean {
  if (moderates) return true;
  const staff = new Set(settings?.staffRoles ?? []);
  return roles.some((r) => staff.has(r));
}

/** Whether a time falls in a server's quiet hours, minutes past midnight UTC; equal ends are never quiet. */
export function quietNow(settings: api.HouseSettings | undefined, nowMs: number): boolean {
  const from = settings?.quietFrom ?? 0;
  const to = settings?.quietTo ?? 0;
  if (from === to) return false;
  const m = Math.floor(nowMs / 60_000) % MINUTES_PER_DAY;
  return from < to ? m >= from && m < to : m >= from || m < to;
}

/** The role an alarm mentions: the first the server's settings name, else the fallback. */
export function alarmRoleOf(
  settings: api.HouseSettings | undefined,
  fallback: string | undefined,
): string | undefined {
  return settings?.alarmRoles?.[0] ?? fallback;
}

/** The channel id a server's settings map to a kind, if any. */
export function channelIn(settings: api.HouseSettings | undefined, kind: ChannelKind) {
  return settings?.channels?.find((c) => c.kind === kind)?.id;
}

const NAME_SUBJECTS: Record<string, string> = { k: "kind", p: "promotion", d: "dungeon" };

/**
 * The name ref a card's custom id points at, for a report (GDD 14.6): the
 * goal, guild, member, dungeon, kind or promotion the card is about, or
 * null when its first button names none of them.
 */
export function refOf(id: Id): string | null {
  const t = id.target;
  const head = t.split(":")[0] ?? "";
  switch (id.action) {
    case "goal":
    case "g-haul":
    case "g-wd":
    case "s-back":
    case "s-decl":
      return t && !["mine", "met"].includes(t) && !t.includes(":") ? `goal:${t}` : null;
    case "g-pledge":
    case "g-deliver":
      return head ? `goal:${head}` : null;
    case "gld-join":
      return t ? `guild:${t}` : null;
    case "gld-act": {
      const f = fields(t, ":", 3);
      return f ? `character:${f[1]}` : null;
    }
    case "d-name":
    case "d-named":
      return fields(t, ",", 2) ? `dungeon:${t}` : null;
    case "pr-name":
    case "pr-named":
      return t ? `promotion:${t}` : null;
    case "kn-name":
    case "kn-own":
    case "kn-named": {
      const subject = NAME_SUBJECTS[head];
      const row = t.slice(head.length + 1);
      return subject && row ? `${subject}:${row}` : null;
    }
    default:
      return null;
  }
}

/** Writes the per-server narration switch (`server:<guild>`). */
export type SwitchWriter = (guild: string, on: boolean) => Promise<void>;

/** The switch writer over the bot's Redis: the hash scripts/narration-switch.ts sets by hand. */
export function redisSwitchWriter(redis: Pick<Redis, "hset">): SwitchWriter {
  return async (guild, on) => {
    await redis.hset(SWITCH_KEY, `server:${guild}`, on ? "on" : "off");
  };
}

/** A name the screen held for this guild, as the queue lists it. */
export interface HeldEntry extends HeldName {
  /** A short key for the entry, which its dismiss button carries. */
  key: string;
}

/** The held names of a guild (GDD 14.6): listed for its staff, and dismissed one by one. */
export interface HeldNames {
  list(guild: string): Promise<HeldEntry[]>;
  /** Drops one held name; false when it is no longer held. */
  dismiss(guild: string, key: string): Promise<boolean>;
}

/** structural: a held entry's key is this many hex digits of its hash. */
const HELD_KEY_DIGITS = 8;

/** A held entry's key: FNV-1a over its stored text, so a dismiss names exactly one entry. */
export function heldKeyOf(raw: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(HELD_KEY_DIGITS, "0");
}

/** Held names from the stored list's entries: this guild's only, newest first. */
export function heldOf(raws: readonly string[], guild: string): HeldEntry[] {
  const out: HeldEntry[] = [];
  for (const raw of raws) {
    try {
      const h = JSON.parse(raw) as HeldName;
      if (guild && h.guild === guild) out.push({ ...h, key: heldKeyOf(raw) });
    } catch {
      // Skipped here; the held-names script lists unreadable entries.
    }
  }
  return out;
}

/** The held list in the bot's Redis, the list the narration's screen pushes to. */
export function redisHeldNames(redis: Pick<Redis, "lrange" | "lrem">): HeldNames {
  return {
    async list(guild) {
      return heldOf(await redis.lrange(HELD_KEY, 0, -1), guild);
    },
    async dismiss(guild, key) {
      const raw = (await redis.lrange(HELD_KEY, 0, -1)).find(
        (r) => heldKeyOf(r) === key && heldOf([r], guild).length > 0,
      );
      return raw !== undefined && (await redis.lrem(HELD_KEY, 1, raw)) > 0;
    },
  };
}

/** A held list in memory, for tests and a bot without Redis. */
export function memoryHeldNames(raws: string[] = []): HeldNames & { raws: string[] } {
  return {
    raws,
    async list(guild) {
      return heldOf(raws, guild);
    },
    async dismiss(guild, key) {
      const i = raws.findIndex((r) => heldKeyOf(r) === key && heldOf([r], guild).length > 0);
      if (i < 0) return false;
      raws.splice(i, 1);
      return true;
    },
  };
}

/** What the flow tells the house after a write, and where it reads held names. */
export interface HouseHooks {
  /** A house write landed: the cached read is dropped, and the narration switch follows Narrated. */
  wrote(guild: string, before?: api.HouseSettings, after?: api.HouseSettings): Promise<void>;
  held?: HeldNames;
}

export interface HousesOptions {
  ttlMs?: number;
  now?: () => number;
  /** Writes the narration switch; without it a changed Narrated writes nothing. */
  writeSwitch?: SwitchWriter;
  held?: HeldNames;
  log?: (line: string) => void;
}

/** Every guild's house, read through a short cache. */
export class Houses implements HouseHooks {
  private readonly cache = new Map<string, { at: number; house: api.House | null }>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  readonly held?: HeldNames;

  constructor(
    private readonly world: Pick<World, "house">,
    private readonly opts: HousesOptions = {},
  ) {
    this.ttlMs = opts.ttlMs ?? HOUSE_TTL_MS;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? console.warn;
    this.held = opts.held;
  }

  /** A guild's house, null when the world serves none for it; a failed read keeps the last one. */
  async houseOf(guild: string): Promise<api.House | null> {
    if (!guild || !this.world.house) return null;
    const hit = this.cache.get(guild);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.house;
    try {
      const r = await this.world.house(guild);
      const house = r.ok ? r.reply : null;
      this.cache.set(guild, { at: this.now(), house });
      return house;
    } catch (e) {
      this.log(`[house] ${guild}: ${e instanceof Error ? e.message : String(e)}`);
      return hit?.house ?? null;
    }
  }

  forget(guild: string): void {
    this.cache.delete(guild);
  }

  async channelOf(guild: string, kind: ChannelKind): Promise<string | undefined> {
    return channelIn((await this.houseOf(guild))?.settings, kind);
  }

  async staffRolesOf(guild: string): Promise<string[]> {
    return (await this.houseOf(guild))?.settings.staffRoles ?? [];
  }

  async alarmRolesOf(guild: string): Promise<string[]> {
    return (await this.houseOf(guild))?.settings.alarmRoles ?? [];
  }

  async wrote(guild: string, before?: api.HouseSettings, after?: api.HouseSettings) {
    this.forget(guild);
    if (!after || !this.opts.writeSwitch) return;
    const on = !!after.narrated;
    if (!!before?.narrated === on) return;
    try {
      await this.opts.writeSwitch(guild, on);
    } catch (e) {
      this.log(
        `[house] the narration switch for ${guild} was not written: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
