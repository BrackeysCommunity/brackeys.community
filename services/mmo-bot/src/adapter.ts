import {
  type ButtonInteraction,
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  DiscordAPIError,
  type GuildMemberRoleManager,
  type Interaction,
  type InteractionEditReplyOptions,
  type MessageContextMenuCommandInteraction,
  MessageFlags,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
  type PrimaryEntryPointCommandInteraction,
  RESTJSONErrorCodes,
  type StringSelectMenuInteraction,
  SnowflakeUtil,
  ThreadAutoArchiveDuration,
} from "discord.js";

import { describe, toMessage, toModal } from "../../../packages/discord-kit/src/index.ts";
import { type Card, render } from "./card.ts";
import type { Budget } from "./cooldown.ts";
import {
  answer,
  type Answer,
  type Ctx,
  launchFor,
  modalFor,
  type Press,
  roleFor,
  wantsGuildLists,
} from "./flow.ts";
import type { ForumSink } from "./forum.ts";
import { refOf, staffOf } from "./house.ts";
import type { ChannelSink } from "./hunts.ts";
import { decodeId } from "./ids.ts";
import { REPORT } from "./manifest.ts";
import type { PartyMode, PartyNote, ThreadSink } from "./party.ts";
import type { GuildThing } from "./screens/house.ts";
import { withThreadSoon } from "./screens/party.ts";
import { WorldUnavailableError } from "./world.ts";

/**
 * The one file that touches discord.js interactions. Every press is
 * answered through its own interaction: a defer inside three seconds,
 * then an edit of the same ephemeral card. A hub older than
 * 14 minutes is past what its token can edit, so the next press retires it
 * and answers with a fresh hub (GDD 17.3). A press that asks for text
 * opens a modal instead, which cannot follow a defer; its submit is
 * answered like a press. A press that leads into the Activity is answered
 * with the launch, which like a modal must be the first response. A press
 * on a card everyone sees, a party thread's or the game channel's, is
 * answered with a card of the presser's own, never by editing the shared
 * one. The Raid alarms button toggles the alarm role on its presser and
 * is answered here, never by the flow.
 */

export const STALE_LINE =
  "That button belongs to an older version of the game. Open your hub again with /play.";
export const MOVED_LINE = "-# This hub moved to your newest one, below.";
export const SLOW_LINE =
  "Easy: that is more presses than the game takes in a few seconds. Try again in a moment.";
export const LAUNCH_LINE = "The Activity would not open just now. Try again in a moment.";
export const DOWN_LINE =
  "The world service is not answering just now. Your last action is safe; try again in a minute.";
export const HUB_TTL_MS = 14 * 60_000;
export const ALARM_ON =
  "Raid alarms are on: a raid's start in the events channel mentions you. Press again to turn them off.";
export const ALARM_OFF = "Raid alarms are off. Press again to turn them back on.";
export const ALARM_NONE = "Raid alarms are not set up on this server.";
export const ALARM_FAILED =
  "Your Raid alarms role could not be changed just now. An admin may need to give the bot Manage Roles.";

export interface AdapterOptions {
  ctx: Ctx;
  budget: Budget;
  /** Fetches a picture's bytes by media key. */
  media: (key: string) => Promise<Uint8Array>;
  /** Told when a press queued a long action, for the completion notice. */
  onLong?: (user: string, character: string) => void;
  /** Told of a press about a party, for its thread; says whether the party plays there yet. */
  onParty?: (note: PartyNote) => Promise<PartyMode>;
  /** The role the Raid alarms button toggles (MMO_EVENTS_ALARM_ROLE). */
  alarmRole?: string;
  /** The roles a server's settings count as staff, beside Moderate Members (GDD 14.1). */
  staffRoles?: (guild: string) => Promise<readonly string[]>;
  /** The alarm roles a server's settings name; the button toggles the first, else alarmRole. */
  alarmRoles?: (guild: string) => Promise<readonly string[]>;
  log?: (line: string) => void;
  now?: () => number;
}

export function createHandler(opts: AdapterOptions) {
  const {
    ctx,
    budget,
    media,
    onLong,
    onParty,
    alarmRole,
    staffRoles,
    alarmRoles,
    log = console.log,
    now = Date.now,
  } = opts;

  /** The alarm role of a server: the first its settings name, else the bot's own. */
  async function alarmOf(guild: string | null): Promise<string | undefined> {
    if (!guild || !alarmRoles) return alarmRole;
    const named = await alarmRoles(guild).catch((e: unknown) => {
      log(`[role] alarm roles of ${guild}: ${describe(e)}`);
      return [] as readonly string[];
    });
    return named[0] ?? alarmRole;
  }

  /** Who an interaction is from, marked staff where its server counts them so. */
  async function from(i: Asked): Promise<ReturnType<typeof who>> {
    const w = who(i);
    if (!w.guild) return w;
    const staff = async () => {
      if (i.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) return true;
      if (w.admin || !staffRoles) return false;
      const named = await staffRoles(w.guild!).catch((e: unknown) => {
        log(`[staff] roles of ${w.guild}: ${describe(e)}`);
        return [] as readonly string[];
      });
      return staffOf({ staffRoles: [...named] }, false, memberRoles(i));
    };
    return (await staff()) ? { ...w, staff: true } : w;
  }

  const messageOf = (a: Answer) => cardMessage(a.card, media, log);

  /** A short ephemeral reply; a failed reply is logged, never left unhandled. */
  async function say(i: Asked | Launches, content: string) {
    await i
      .reply({ content, flags: MessageFlags.Ephemeral })
      .catch((e: unknown) => log(`[reply] ${describe(e)}`));
  }

  /** Answers with the Activity launch; a refused launch is said, never swapped for a card. */
  async function launch(i: Launches, what: string) {
    try {
      await i.launchActivity();
    } catch (e) {
      log(`[launch] ${what} failed: ${describe(e)}`);
      await say(i, LAUNCH_LINE);
    }
  }

  async function run(press: Press): Promise<InteractionEditReplyOptions> {
    const a = await answer(ctx, press);
    if (a.long && a.character) onLong?.(press.user, a.character);
    if (a.party && onParty) {
      const mode = await onParty(a.party).catch((e: unknown) => {
        log(`[party] ${a.party?.party}: ${describe(e)}`);
        return "none" as const;
      });
      if (mode === "soon") a.card = withThreadSoon(a.card);
    }
    return messageOf(a);
  }

  /** Toggles a role on the presser and says which way it went. */
  async function toggleRole(i: ButtonInteraction, role: string | undefined) {
    if (!role || !i.guildId) return say(i, ALARM_NONE);
    try {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const roles = await rolesOf(i);
      const had = roles.cache.has(role);
      await (had ? roles.remove(role) : roles.add(role));
      await i.editReply({ content: had ? ALARM_OFF : ALARM_ON });
    } catch (e) {
      log(`[role] ${role} for ${i.user.id} failed: ${describe(e)}`);
      await i.editReply({ content: ALARM_FAILED }).catch(() => {});
    }
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
          ...(await from(i)),
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

  async function onComponent(i: Pressed) {
    const id = decodeId(i.customId);
    if (!id) return say(i, STALE_LINE);
    const gate = await budget.take(i.user.id);
    if (!gate.allowed) return say(i, SLOW_LINE);
    if (i.isButton() && roleFor(id) === "alarm") return toggleRole(i, await alarmOf(i.guildId));
    if (i.isButton() && launchFor(id)) return launch(i, i.customId);
    const modal = i.isButton() ? modalFor(id) : null;
    if (modal && !i.isModalSubmit())
      return void (await i
        .showModal(toModal(modal) as never)
        .catch((e: unknown) => log(`[modal] ${i.customId} failed: ${describe(e)}`)));
    const press: Press = {
      ...(await from(i)),
      id,
      values: i.isStringSelectMenu() ? i.values : [],
      fields: i.isModalSubmit() ? textOf(i) : undefined,
      ...(wantsGuildLists(id) ? guildLists(i) : {}),
    };
    // A modal opened from a card answers by editing that card.
    if (i.isModalSubmit() && !i.isFromMessage()) return say(i, STALE_LINE);
    if (shared(i)) return ownCard(i, press);
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

  /** A press on a card everyone sees: a card of the presser's own, with their own version, leaves the shared one as it is. */
  async function ownCard(i: Pressed, press: Press) {
    try {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await i.editReply(await run(press));
    } catch (e) {
      log(`[press] ${i.customId} failed: ${describe(e)}`);
      await i.editReply({ content: failureText(e), embeds: [], components: [] }).catch(() => {});
    }
  }

  /** Report on a message's menu: only the game's own cards, answered with the reasons to pick. */
  async function onReport(i: MessageContextMenuCommandInteraction) {
    const gate = await budget.take(i.user.id);
    if (!gate.allowed) return say(i, SLOW_LINE);
    const m = i.targetMessage;
    if (m.author.id !== i.client.user.id) return say(i, REPORT_OTHERS);
    try {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await i.editReply(
        await run({
          ...(await from(i)),
          command: REPORT,
          report: reportedOf(firstCustomId(m.components), m.channelId, m.id),
        }),
      );
    } catch (e) {
      log(`[report] ${m.id} failed: ${describe(e)}`);
      await i.editReply({ content: failureText(e), embeds: [], components: [] }).catch(() => {});
    }
  }

  return async function handle(i: Interaction): Promise<void> {
    if (i.isPrimaryEntryPointCommand()) return launch(i, `/${i.commandName}`);
    if (i.isChatInputCommand()) return onCommand(i);
    if (i.isButton() || i.isStringSelectMenu() || i.isModalSubmit()) return onComponent(i);
    if (i.isMessageContextMenuCommand()) return onReport(i);
  };
}

type Pressed = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;
type Launches = ButtonInteraction | PrimaryEntryPointCommandInteraction;
type Asked = ChatInputCommandInteraction | MessageContextMenuCommandInteraction | Pressed;

export const REPORT_OTHERS =
  "Report works on the game's own cards; report anything else to the server's moderators.";

/** Who an interaction is from: the player, the server, whether they administer it, and the channel a thread would open under. */
function who(
  i: Asked,
): Pick<Press, "user" | "guild" | "guildName" | "interaction" | "admin" | "staff" | "channel"> {
  const ch = i.channel;
  return {
    user: i.user.id,
    guild: i.guildId ?? undefined,
    guildName: i.guild?.name,
    interaction: i.id,
    admin: i.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false,
    channel: (ch?.isThread() ? ch.parentId : i.channelId) ?? undefined,
  };
}

/** The member's role ids, whether the interaction carries the member whole or as raw JSON. */
function memberRoles(i: Asked): string[] {
  const m = i.member;
  if (!m) return [];
  return Array.isArray(m.roles) ? [...m.roles] : [...m.roles.cache.keys()];
}

/** structural: a select lists at most this many channels or roles. */
const LISTED_MOST = 25;

/** The guild's channels the game may post in, and its roles a member can hold, for the settings card. */
function guildLists(i: Asked): Pick<Press, "channels" | "roles"> {
  const g = i.guild;
  if (!g) return {};
  const postable = new Set<ChannelType>([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildForum,
  ]);
  const channels: GuildThing[] = [...g.channels.cache.values()]
    .filter((c) => postable.has(c.type))
    .sort((a, b) => ("rawPosition" in a && "rawPosition" in b ? a.rawPosition - b.rawPosition : 0))
    .slice(0, LISTED_MOST)
    .map((c) => ({ id: c.id, name: c.name }));
  const roles: GuildThing[] = [...g.roles.cache.values()]
    .filter((r) => r.id !== g.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .slice(0, LISTED_MOST)
    .map((r) => ({ id: r.id, name: r.name }));
  return { channels, roles };
}

/** The first custom id on a message's components, if it has any. */
function firstCustomId(rows: readonly unknown[]): string | undefined {
  for (const row of rows as { components?: { customId?: string | null }[] }[])
    for (const c of row.components ?? []) if (c.customId) return c.customId;
  return undefined;
}

/** What a reported card names: a ref read from its first custom id, else the post itself. */
export function reportedOf(customId: string | undefined, channel: string, message: string): string {
  const id = customId ? decodeId(customId) : null;
  return (id && refOf(id)) || `p/${channel}/${message}`;
}

/** The presser's roles; a member the interaction carries only as raw JSON is fetched. */
async function rolesOf(i: ButtonInteraction): Promise<GuildMemberRoleManager> {
  const m = i.member;
  if (m && !Array.isArray(m.roles)) return m.roles;
  const guild = i.guild ?? (await i.client.guilds.fetch(i.guildId!));
  return (await guild.members.fetch(i.user.id)).roles;
}

/** Whether a press came from a message everyone in its channel sees, rather than the presser's own ephemeral card. */
function shared(i: Pressed): boolean {
  const flags = i.message?.flags;
  return !!flags && !flags.has(MessageFlags.Ephemeral);
}

/** A submitted modal's text, by input id. */
function textOf(i: ModalSubmitInteraction): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, f] of i.fields.fields)
    if ("value" in f && typeof f.value === "string") out[id] = f.value;
  return out;
}

/** A role mentioned at a message's head; ping says whether this send may notify it. */
interface Mention {
  role: string;
  ping: boolean;
}

/** A card as a message. A picture the world no longer holds drops out rather than failing the card. */
async function cardMessage(
  card: Card,
  media: (key: string) => Promise<Uint8Array>,
  log: (line: string) => void,
  mention?: Mention,
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
  const content = mention ? `<@&${mention.role}>\n${r.message.content ?? ""}` : r.message.content;
  return toMessage({
    ...r.message,
    content,
    embeds,
    files: got,
    mentionRoles: mention?.ping ? [mention.role] : undefined,
  }) as unknown as InteractionEditReplyOptions;
}

/** Errors that mean a forum post can no longer take replies, so a new one is opened. */
const POST_GONE: ReadonlySet<unknown> = new Set([
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.UnknownMessage,
  RESTJSONErrorCodes.InvalidActionOnArchivedThread,
  RESTJSONErrorCodes.ThreadLocked,
  RESTJSONErrorCodes.MissingAccess,
]);

function postGone(e: unknown): boolean {
  return e instanceof DiscordAPIError && POST_GONE.has(e.code);
}

function archived(e: unknown): boolean {
  return (
    e instanceof DiscordAPIError && e.code === RESTJSONErrorCodes.InvalidActionOnArchivedThread
  );
}

/** A forum channel as a sink for cards (GDD 17.2): posts opened, replied to and edited. */
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
      const th = await client.channels.fetch(post).catch((e: unknown) => {
        if (postGone(e)) return null;
        throw e;
      });
      if (!th?.isThread()) return false;
      try {
        await th.send((await cardMessage(card, media, log)) as never);
      } catch (e) {
        if (postGone(e)) return false;
        throw e;
      }
      return true;
    },
    async edit(post, card, title) {
      const th = await client.channels.fetch(post).catch((e: unknown) => {
        if (postGone(e)) return null;
        throw e;
      });
      if (!th?.isThread()) return false;
      const message = (await cardMessage(card, media, log)) as never;
      try {
        const first = await th.fetchStarterMessage();
        if (!first) return false;
        try {
          await first.edit(message);
        } catch (e) {
          // An archived thread is still the goal's post: it is opened
          // again and edited, where a reply would have reopened it.
          if (!archived(e)) throw e;
          await th.setArchived(false);
          await first.edit(message);
        }
        if (title) await th.setName(title);
      } catch (e) {
        if (postGone(e)) return false;
        throw e;
      }
      return true;
    },
  };
}

/** Errors that mean a private thread may not be opened here, so a public one is. */
const NO_PRIVATE: ReadonlySet<unknown> = new Set([
  RESTJSONErrorCodes.MissingPermissions,
  RESTJSONErrorCodes.MissingAccess,
  RESTJSONErrorCodes.CannotExecuteActionOnThisChannelType,
]);

/** A channel's threads as a party's sink (GDD 7.5): private where allowed, else public, with the members added. */
export function threadSink(
  client: Client,
  media: (key: string) => Promise<Uint8Array>,
  log: (line: string) => void = console.log,
): ThreadSink {
  const thread = async (id: string) => {
    const th = await client.channels.fetch(id).catch((e: unknown) => {
      if (postGone(e)) return null;
      throw e;
    });
    return th?.isThread() ? th : null;
  };
  type Thread = NonNullable<Awaited<ReturnType<typeof thread>>>;
  const addAll = async (th: Thread, members: string[]) => {
    for (const m of members)
      await th.members.add(m).catch((e: unknown) => log(`[party] adding ${m}: ${describe(e)}`));
  };
  /** Runs a write on a thread, opening it again first if it was archived; false when it is gone. */
  const onThread = async (id: string, f: (th: Thread) => Promise<unknown>) => {
    const th = await thread(id);
    if (!th) return false;
    try {
      if (th.archived) await th.setArchived(false);
      await f(th);
    } catch (e) {
      if (postGone(e)) return false;
      throw e;
    }
    return true;
  };
  return {
    async open(channel, name, card, members) {
      const ch = await client.channels.fetch(channel);
      if (ch?.type !== ChannelType.GuildText) throw new Error(`${channel} is not a text channel`);
      const options = { name, autoArchiveDuration: ThreadAutoArchiveDuration.OneDay };
      let th;
      try {
        th = await ch.threads.create({
          ...options,
          type: ChannelType.PrivateThread,
          invitable: false,
        });
      } catch (e) {
        if (!(e instanceof DiscordAPIError) || !NO_PRIVATE.has(e.code)) throw e;
        log(`[party] a private thread was refused in ${channel}; opening a public one`);
        th = await ch.threads.create({ ...options, type: ChannelType.PublicThread });
      }
      await addAll(th, members);
      const msg = await th.send((await cardMessage(card, media, log)) as never);
      return { thread: th.id, card: msg.id };
    },
    add: (id, members) => onThread(id, (th) => addAll(th, members)),
    edit: (id, message, card) =>
      onThread(id, async (th) => {
        const msg = await th.messages.fetch(message);
        await msg.edit((await cardMessage(card, media, log)) as never);
      }),
    post: (id, card) =>
      onThread(id, async (th) => th.send((await cardMessage(card, media, log)) as never)),
    async archive(id) {
      const th = await thread(id);
      if (th && !th.archived)
        await th
          .setArchived(true)
          .catch((e: unknown) => log(`[party] archiving ${id}: ${describe(e)}`));
    },
  };
}

/** A text channel as a poster's sink (GDD 7.6, 17.2): cards posted and edited in place. */
export function channelSink(
  client: Client,
  channelId: string,
  media: (key: string) => Promise<Uint8Array>,
  log: (line: string) => void = console.log,
): ChannelSink {
  const channel = async () => {
    const ch = await client.channels.fetch(channelId);
    if (!ch?.isSendable() || !("messages" in ch))
      throw new Error(`${channelId} is not a channel the bot can post in`);
    return ch;
  };
  return {
    async post(card, mentionRole) {
      const mention = mentionRole ? { role: mentionRole, ping: true } : undefined;
      const msg = await (
        await channel()
      ).send((await cardMessage(card, media, log, mention)) as never);
      return msg.id;
    },
    async edit(message, card, mentionRole) {
      const mention = mentionRole ? { role: mentionRole, ping: false } : undefined;
      try {
        const msg = await (await channel()).messages.fetch(message);
        await msg.edit((await cardMessage(card, media, log, mention)) as never);
      } catch (e) {
        if (postGone(e)) return false;
        throw e;
      }
      return true;
    },
  };
}

/**
 * The bot's own channel for a kind in one guild, where its settings map
 * none: an id the guild holds, or a channel of that name in it.
 */
export async function guildChannel(
  client: Client,
  guild: string,
  ref: string | undefined,
): Promise<string | undefined> {
  if (!ref) return undefined;
  if (/^\d{1,20}$/.test(ref)) {
    const ch = await client.channels.fetch(ref).catch(() => null);
    return ch && "guildId" in ch && ch.guildId === guild ? ch.id : undefined;
  }
  const g = client.guilds.cache.get(guild);
  const name = ref.replace(/^#/, "");
  return g?.channels.cache.find((c) => c.name === name && c.isSendable())?.id;
}
