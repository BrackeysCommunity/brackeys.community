import type * as api from "./api.ts";
import type { ForumStore } from "./forum.ts";
import type { Houses } from "./house.ts";
import { type ChannelSink, pollEvery } from "./hunts.ts";
import { postOnce } from "./live.ts";
import { logRowCard } from "./screens/house.ts";
import type { World } from "./world.ts";

/**
 * The log channel (GDD 14.8, 17.2): every row of a server's public log,
 * posted once each in the order the world wrote them, into the channel
 * its settings map, or the bot's own log channel where they map none. A
 * cursor per guild marks the last row posted, set before each post so a
 * crash never posts a row twice.
 */

export const LOG_POLL_MS = 15_000;

/** Pages of a guild's log read in one poll; the rest wait for the next. */
const PAGES = 5;

export class LogPoster {
  constructor(
    private readonly world: Pick<World, "houseLog">,
    private readonly houses: Pick<Houses, "houseOf" | "channelOf">,
    private readonly store: ForumStore,
    private readonly sinkOf: (channel: string) => ChannelSink,
    private readonly guilds: readonly string[],
    /** The bot's own log channel in a guild, where its settings map none. */
    private readonly fallback: (guild: string) => Promise<string | undefined> = async () =>
      undefined,
    private readonly prefix = "mmo-bot:log:",
    private readonly log: (line: string) => void = console.log,
  ) {}

  private key(guild: string): string {
    return `${this.prefix}${guild}:last`;
  }

  /** Posts every guild's rows not yet posted; returns how many it posted. */
  async poll(): Promise<number> {
    let posted = 0;
    for (const guild of this.guilds) {
      try {
        posted += await this.pollGuild(guild);
      } catch (e) {
        this.log(`[log] ${guild}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return posted;
  }

  private async pollGuild(guild: string): Promise<number> {
    const read = this.world.houseLog;
    if (!read) return 0;
    const channel = (await this.houses.channelOf(guild, "log")) ?? (await this.fallback(guild));
    if (!channel) return 0;
    const sink = this.sinkOf(channel);
    const key = this.key(guild);
    let last = Number((await this.store.get(key)) ?? 0);
    let house: api.House | null | undefined;
    let posted = 0;
    for (let i = 0; i < PAGES; i++) {
      const from = last;
      const page = await read(guild, last);
      for (const row of page.rows) {
        if (row.id <= last || row.server !== guild) continue;
        house ??= await this.houses.houseOf(guild);
        const prev = String(last);
        await postOnce(
          this.store,
          key,
          String(row.id),
          () => sink.post(logRowCard(row, house ?? undefined)),
          () => this.store.set(key, prev),
        );
        posted++;
        last = row.id;
      }
      if (page.next > last) {
        // Rows of another server, or none at all, still move the mark on.
        last = page.next;
        await this.store.set(key, String(last));
      }
      if (last === from) break;
    }
    return posted;
  }

  start(): () => void {
    return pollEvery(LOG_POLL_MS, () => this.poll(), this.log, "log");
  }
}
