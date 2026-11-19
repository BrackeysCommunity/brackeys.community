import {
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type InteractionEditReplyOptions,
  MessageFlags,
  type StringSelectMenuInteraction,
  SnowflakeUtil,
} from "discord.js";

import { toMessage } from "../../../packages/discord-kit/src/index.ts";
import { render } from "./card.ts";
import type { Budget } from "./cooldown.ts";
import { answer, type Answer, type Ctx, type Press } from "./flow.ts";
import { decodeId } from "./ids.ts";
import { WorldUnavailableError } from "./world.ts";

/**
 * The one file that touches discord.js interactions. Every press is
 * answered through its own interaction (spike D rule 1): a defer inside
 * three seconds, then an edit of the same ephemeral card. A hub older than
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

  async function messageOf(a: Answer): Promise<InteractionEditReplyOptions> {
    const r = render(a.card);
    const files = await Promise.all(
      r.media.map(async (m) => ({ name: m.name, data: await media(m.key), description: m.alt })),
    );
    return toMessage({ ...r.message, files }) as unknown as InteractionEditReplyOptions;
  }

  async function run(press: Press): Promise<InteractionEditReplyOptions> {
    const a = await answer(ctx, press);
    if (a.long && a.character) onLong?.(press.user, a.character);
    return messageOf(a);
  }

  async function onCommand(i: ChatInputCommandInteraction) {
    const gate = await budget.take(i.user.id);
    if (!gate.allowed) return void i.reply({ content: SLOW_LINE, flags: MessageFlags.Ephemeral });
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    try {
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
          content:
            e instanceof WorldUnavailableError ? DOWN_LINE : `Something went wrong: ${describe(e)}`,
          embeds: [],
          components: [],
        })
        .catch(() => {});
    }
  }

  async function onComponent(i: ButtonInteraction | StringSelectMenuInteraction) {
    const id = decodeId(i.customId);
    if (!id) return void i.reply({ content: STALE_LINE, flags: MessageFlags.Ephemeral });
    const gate = await budget.take(i.user.id);
    if (!gate.allowed) return void i.reply({ content: SLOW_LINE, flags: MessageFlags.Ephemeral });
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
          content:
            e instanceof WorldUnavailableError ? DOWN_LINE : `Something went wrong: ${describe(e)}`,
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

export function describe(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}
