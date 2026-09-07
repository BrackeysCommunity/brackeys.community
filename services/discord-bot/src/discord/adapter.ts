import {
  ActionRowBuilder,
  type APIEmbed,
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  type ButtonInteraction,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type CommandInteractionOption,
  DiscordAPIError,
  type Interaction,
  type InteractionEditReplyOptions,
  MessageFlags,
  type UserContextMenuCommandInteraction,
} from "discord.js";

import { EVENTS } from "../../../../src/lib/event-taxonomy.ts";
import type { ServiceTelemetry } from "../../../../src/lib/service-telemetry.ts";
import { type ApiOutcome, ApiUnavailableError, type PublicApi } from "../api.ts";
import type { CommandContext } from "../commands/context.ts";
import { decodeCustomId } from "../commands/custom-id.ts";
import {
  COMMAND,
  type Invocation,
  OPT,
  PROFILE_CONTEXT_MENU,
  replyVisibility,
  runInvocation,
  runPage,
} from "../commands/dispatch.ts";
import type { Cooldown } from "../cooldown.ts";
import type { Choice, Memo } from "../memo.ts";
import type { Button, Embed, Reply } from "../reply.ts";

/**
 * The one file that touches discord.js interaction objects. It turns an
 * interaction into a plain `Invocation`, defers, runs the command, and
 * writes the `Reply` descriptor back — plus the three failure modes the
 * plan names: the outage line when the API is down, "run the command
 * again" for a stale button, and a loud log (never a retry) on 403.
 */

export const OUTAGE_LINE = "brackeys.dev isn't reachable right now — try again in a minute.";
export const STALE_BUTTON_LINE =
  "That button is from an older version of the bot — run the command again.";
export const COOLDOWN_LINE =
  "Easy — you're sending commands faster than the site can answer. Try again in a few seconds.";

export interface AdapterOptions {
  api: PublicApi;
  memo: Memo;
  cooldown: Cooldown;
  telemetry: ServiceTelemetry;
  appUrl: string;
  hostName: string;
  now?: () => Date;
  log?: (line: string) => void;
}

export function createInteractionHandler(options: AdapterOptions) {
  const {
    api,
    memo,
    cooldown,
    telemetry,
    appUrl,
    hostName,
    now = () => new Date(),
    log = console.log,
  } = options;

  const context = (): CommandContext => ({
    now: now(),
    appUrl,
    hostName,
    names: { skill: memo.skillName, role: memo.roleName },
  });

  async function onChatInput(interaction: ChatInputCommandInteraction) {
    const inv = toInvocation(interaction);
    await runCommand(
      interaction,
      inv,
      `${inv.command}${inv.subcommand ? ` ${inv.subcommand}` : ""}`,
    );
  }

  async function onUserContextMenu(interaction: UserContextMenuCommandInteraction) {
    const inv: Invocation = {
      command: PROFILE_CONTEXT_MENU,
      options: {},
      targetUserId: interaction.targetId,
    };
    await runCommand(interaction, inv, "member (context menu)");
  }

  async function runCommand(
    interaction: ChatInputCommandInteraction | UserContextMenuCommandInteraction,
    inv: Invocation,
    label: string,
  ) {
    const startedAt = performance.now();
    const visibility = replyVisibility(inv);
    const props = {
      command: inv.command === PROFILE_CONTEXT_MENU ? COMMAND.member : inv.command,
      subcommand: inv.command === PROFILE_CONTEXT_MENU ? "context_menu" : inv.subcommand,
      visibility,
    };

    const gate = cooldown.check(interaction.user.id);
    if (!gate.allowed) {
      await interaction.reply({ content: COOLDOWN_LINE, flags: MessageFlags.Ephemeral });
      telemetry.capture(EVENTS.botCommandFailed, {
        ...props,
        api_outcome: "cooldown",
        latency_ms: 0,
      });
      return;
    }

    let outcome: ApiOutcome = "error";
    try {
      // Defer first, always: a cold origin must never race the 3 s window.
      await interaction.deferReply(
        visibility === "ephemeral" ? { flags: MessageFlags.Ephemeral } : {},
      );
      const reply = await runInvocation(api, inv, context());
      outcome = reply.outcome;
      await interaction.editReply(toMessage(reply));
      telemetry.capture(EVENTS.botCommandInvoked, {
        ...props,
        api_outcome: outcome,
        latency_ms: elapsed(startedAt),
      });
    } catch (error) {
      outcome = error instanceof ApiUnavailableError ? error.outcome : "error";
      log(`[command] ${label} failed (${outcome}): ${describe(error)}`);
      if (!(error instanceof ApiUnavailableError)) {
        telemetry.captureException(error, { ...props, scope: "command" });
      }
      telemetry.capture(EVENTS.botCommandFailed, {
        ...props,
        api_outcome: outcome,
        latency_ms: elapsed(startedAt),
      });
      await answerFailure(interaction, visibility, error);
    }
  }

  /**
   * The outage line is always ephemeral. After a public defer that means
   * removing the placeholder and following up privately — a channel never
   * sees the bot fail on someone's behalf.
   */
  async function answerFailure(
    interaction:
      | ChatInputCommandInteraction
      | UserContextMenuCommandInteraction
      | ButtonInteraction,
    visibility: "public" | "ephemeral",
    error: unknown,
  ) {
    if (isForbidden(error)) {
      // 403s count toward the invalid-request ban that took sign-in down in
      // July. State, not a retry: log it where someone will see it and stop.
      log(`[command] 403 from Discord — not retrying: ${describe(error)}`);
      return;
    }
    const content =
      error instanceof ApiUnavailableError
        ? OUTAGE_LINE
        : "Something went wrong on our side. Try again in a minute.";
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      } else if (visibility === "ephemeral") {
        await interaction.editReply({ content, embeds: [], components: [] });
      } else {
        await interaction.deleteReply().catch(() => {});
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      }
    } catch (replyError) {
      log(`[command] could not deliver failure line: ${describe(replyError)}`);
    }
  }

  async function onAutocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);
    const query = String(focused.value ?? "");
    let choices: Choice[] = [];
    if (focused.name === OPT.jam) choices = memo.jamChoices(query);
    else if (focused.name === OPT.skill) choices = memo.skillChoices(query);
    else if (focused.name === OPT.role) choices = memo.roleChoices(query);
    else if (focused.name === OPT.name && interaction.commandName === COMMAND.team) {
      choices = memo.teamChoices(query);
    }
    try {
      await interaction.respond(choices);
    } catch (error) {
      // Past the 3 s window, or the user moved on. Nothing to recover.
      log(
        `[autocomplete] ${interaction.commandName}.${focused.name} respond failed: ${describe(error)}`,
      );
    }
  }

  async function onButton(interaction: ButtonInteraction) {
    const state = decodeCustomId(interaction.customId);
    if (!state) {
      await interaction.reply({ content: STALE_BUTTON_LINE, flags: MessageFlags.Ephemeral });
      return;
    }
    const gate = cooldown.check(interaction.user.id);
    if (!gate.allowed) {
      await interaction.reply({ content: COOLDOWN_LINE, flags: MessageFlags.Ephemeral });
      return;
    }
    const startedAt = performance.now();
    const ephemeral = interaction.message.flags.has(MessageFlags.Ephemeral);
    const props = {
      command: state.kind,
      subcommand: "page",
      visibility: ephemeral ? "ephemeral" : "public",
    };
    try {
      await interaction.deferUpdate();
      const reply = await runPage(api, state, context(), ephemeral);
      await interaction.editReply(toMessage(reply));
      telemetry.capture(EVENTS.botCommandInvoked, {
        ...props,
        api_outcome: reply.outcome,
        latency_ms: elapsed(startedAt),
      });
    } catch (error) {
      const outcome = error instanceof ApiUnavailableError ? error.outcome : "error";
      log(`[button] ${state.kind} failed (${outcome}): ${describe(error)}`);
      if (!(error instanceof ApiUnavailableError))
        telemetry.captureException(error, { ...props, scope: "button" });
      telemetry.capture(EVENTS.botCommandFailed, {
        ...props,
        api_outcome: outcome,
        latency_ms: elapsed(startedAt),
      });
      if (isForbidden(error)) {
        log(`[button] 403 from Discord — not retrying: ${describe(error)}`);
        return;
      }
      // A page turn that fails leaves the previous page in place and says so.
      await interaction
        .followUp({
          content:
            error instanceof ApiUnavailableError
              ? OUTAGE_LINE
              : "Couldn't turn the page — try again.",
          flags: MessageFlags.Ephemeral,
        })
        .catch((e: unknown) => log(`[button] could not deliver failure line: ${describe(e)}`));
    }
  }

  return async function handleInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isChatInputCommand()) return onChatInput(interaction);
    if (interaction.isAutocomplete()) return onAutocomplete(interaction);
    if (interaction.isButton()) return onButton(interaction);
    if (interaction.isUserContextMenuCommand()) return onUserContextMenu(interaction);
  };
}

/** Options as plain values. One level of subcommand; the manifest has no groups. */
export function toInvocation(interaction: ChatInputCommandInteraction): Invocation {
  const inv: Invocation = { command: interaction.commandName, options: {} };
  let list: readonly CommandInteractionOption[] = interaction.options.data;
  const head = list[0];
  if (head?.type === ApplicationCommandOptionType.Subcommand) {
    inv.subcommand = head.name;
    list = head.options ?? [];
  }
  for (const opt of list) {
    if (opt.type === ApplicationCommandOptionType.User) {
      inv.targetUserId = String(opt.value);
      inv.options[opt.name] = String(opt.value);
    } else if (
      typeof opt.value === "string" ||
      typeof opt.value === "number" ||
      typeof opt.value === "boolean"
    ) {
      inv.options[opt.name] = opt.value;
    }
  }
  return inv;
}

export function toMessage(reply: Reply): InteractionEditReplyOptions {
  return {
    content: reply.content ?? "",
    embeds: reply.embeds.map(toApiEmbed),
    components: toRows(reply.buttons),
    // Never ping anyone from a bot answer, whatever a title contains.
    allowedMentions: { parse: [] },
  };
}

function toApiEmbed(embed: Embed): APIEmbed {
  return {
    title: embed.title,
    url: embed.url,
    description: embed.description,
    color: embed.color,
    fields: embed.fields,
    image: embed.image ? { url: embed.image } : undefined,
    thumbnail: embed.thumbnail ? { url: embed.thumbnail } : undefined,
    footer: embed.footer ? { text: embed.footer } : undefined,
    author: embed.author
      ? { name: embed.author.name, url: embed.author.url, icon_url: embed.author.iconUrl }
      : undefined,
  };
}

/** Five buttons to a row, five rows to a message. */
function toRows(buttons: Button[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length && rows.length < 5; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const button of buttons.slice(i, i + 5)) {
      const b = new ButtonBuilder().setLabel(button.label.slice(0, 80));
      if (button.kind === "link") b.setStyle(ButtonStyle.Link).setURL(button.url);
      else
        b.setStyle(ButtonStyle.Secondary)
          .setCustomId(button.customId)
          .setDisabled(button.disabled ?? false);
      row.addComponents(b);
    }
    rows.push(row);
  }
  return rows;
}

function isForbidden(error: unknown): boolean {
  return error instanceof DiscordAPIError && error.status === 403;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
