import {
  type ButtonInteraction,
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type InteractionEditReplyOptions,
  MessageFlags,
  type StringSelectMenuInteraction,
  SnowflakeUtil,
} from "discord.js";

import { describe, toMessage } from "../../../packages/discord-kit/src/index.ts";
import { type Card, render } from "./card.ts";
import type { Budget } from "./cooldown.ts";
import { answer, type Answer, type Ctx, type Press } from "./flow.ts";
import type { ForumSink } from "./forum.ts";
import { decodeId } from "./ids.ts";
import { WorldUnavailableError } from "./world.ts";

/**
 * The one file that touches discord.js interactions. Every press is
 * answered through its own interaction: a defer inside three seconds,
 * then an edit of the same ephemeral card. A hub older than
 * 14 minutes is past what its token can edit, so the next press retires it
 * and answers with a fresh hub (GDD 17.3).
 */

export const STALE_LINE =
  "That button belongs to an older version of the game. Open your hub again with /play.";
export const MOVED_LINE = "-# This hub moved to your newest one, below.";
export const SLOW_LINE =
  "Easy: that is more presses than the game takes in a few seconds. Try again in a moment.";
export const DOWN_LINE =
  "The world service is not answering just now. Your last action is safe; try again in a minute.";
export const HUB_TTL_MS = 14 * 60_000;

export interface AdapterOptions {
  ctx: Ctx;
  budget: Budget;
  /** Fetches a picture's bytes by media key. */
  media: (key: string) => Promise<Uint8Array>;
  /** Told when a press queued a long action, for the completion notice. */
  onLong?: (user: string, character: string) => void;
  log?: (line: string) => void;
  now?: () => number;
}

export function createHandler(opts: AdapterOptions) {
  const { ctx, budget, media, onLong, log = console.log, now = Date.now } = opts;

  const messageOf = (a: Answer) => cardMessage(a.card, media, log);

  /** A short ephemeral reply; a failed reply is logged, never left unhandled. */
  async function say(
    i: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
    content: string,
  ) {
    await i
      .reply({ content, flags: MessageFlags.Ephemeral })
      .catch((e: unknown) => log(`[reply] ${describe(e)}`));
  }

  async function run(press: Press): Promise<InteractionEditReplyOptions> {
    const a = await answer(ctx, press);
    if (a.long && a.character) onLong?.(press.user, a.character);
    return messageOf(a);
  }

  const failureText = (error: unknown) =>
    error instanceof WorldUnavailableError ? DOWN_LINE : `Something went wrong: ${describe(error)}`;

  async function onCommand(i: ChatInputCommandInteraction) {
    const gate = await budget.take(i.user.id);
    if (!gate.allowed) return say(i, SLOW_LINE);
    try {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await i.editReply(
        await run({
          user: i.user.id,
          guild: i.guildId ?? undefined,
          interaction: i.id,
          command: i.commandName,
        }),
      );
    } catch (e) {
      log(`[command] /${i.commandName} failed: ${describe(e)}`);
      await i
        .editReply({
          content: failureText(e),
          embeds: [],
          components: [],
        })
        .catch(() => {});
    }
  }

  async function onComponent(i: ButtonInteraction | StringSelectMenuInteraction) {
    const id = decodeId(i.customId);
    if (!id) return say(i, STALE_LINE);
    const gate = await budget.take(i.user.id);
    if (!gate.allowed) return say(i, SLOW_LINE);
    const press: Press = {
      user: i.user.id,
      guild: i.guildId ?? undefined,
      interaction: i.id,
      id,
      values: i.isStringSelectMenu() ? i.values : [],
    };
    const age = now() - Number(SnowflakeUtil.timestampFrom(i.message.id));
    try {
      if (age > HUB_TTL_MS) {
        // The press's own token can still edit the old card: retire it, and
        // answer with a fresh hub whose token has 15 minutes ahead of it.
        await i.update({ content: MOVED_LINE, embeds: [], components: [], files: [] });
        await i.followUp({ ...(await run(press)), flags: MessageFlags.Ephemeral } as never);
        return;
      }
      await i.deferUpdate();
      await i.editReply(await run(press));
    } catch (e) {
      log(`[press] ${i.customId} failed: ${describe(e)}`);
      await i
        .followUp({
          content: failureText(e),
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
  }

  return async function handle(i: Interaction): Promise<void> {
    if (i.isPrimaryEntryPointCommand())
      return void (await i.launchActivity().catch((e: unknown) => log(`[launch] ${describe(e)}`)));
    if (i.isChatInputCommand()) return onCommand(i);
    if (i.isButton() || i.isStringSelectMenu()) return onComponent(i);
  };
}

/** A card as a message. A picture the world no longer holds drops out rather than failing the card. */
async function cardMessage(
  card: Card,
  media: (key: string) => Promise<Uint8Array>,
  log: (line: string) => void,
): Promise<InteractionEditReplyOptions> {
  const r = render(card);
  const files = await Promise.all(
    r.media.map(async (m) => {
      try {
        return { name: m.name, data: await media(m.key), description: m.alt };
      } catch (e) {
        if (e instanceof WorldUnavailableError) throw e;
        log(`[media] ${m.key}: ${describe(e)}`);
        return null;
      }
    }),
  );
  const got = files.filter((f) => f !== null);
  const missing = new Set(r.media.filter((_, i) => !files[i]).map((m) => `attachment://${m.name}`));
  const embeds = r.message.embeds.map((e) => ({
    ...e,
    image: e.image && missing.has(e.image) ? undefined : e.image,
    thumbnail: e.thumbnail && missing.has(e.thumbnail) ? undefined : e.thumbnail,
  }));
  return toMessage({ ...r.message, embeds, files: got }) as unknown as InteractionEditReplyOptions;
}

/** The market forum's posts (GDD 17.2): one forum post per settlement, a reply per world day. */
export function forumSink(
  client: Client,
  channelId: string,
  media: (key: string) => Promise<Uint8Array>,
  log: (line: string) => void = console.log,
): ForumSink {
  return {
    async open(title, card) {
      const ch = await client.channels.fetch(channelId);
      if (ch?.type !== ChannelType.GuildForum)
        throw new Error(`${channelId} is not a forum channel`);
      const thread = await ch.threads.create({
        name: title,
        message: (await cardMessage(card, media, log)) as never,
      });
      return thread.id;
    },
    async reply(post, card) {
      const th = await client.channels.fetch(post);
      if (!th?.isThread()) throw new Error(`${post} is not a forum post`);
      await th.send((await cardMessage(card, media, log)) as never);
    },
  };
}
