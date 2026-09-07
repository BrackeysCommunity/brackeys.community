import type { PublicApi } from "../api.ts";
import { type Reply, textReply } from "../reply.ts";
import { collabBrowse, collabBrowsePage, collabPost, collabStats } from "./collab.ts";
import type { CommandContext } from "./context.ts";
import {
  COLLAB_TYPES,
  type CollabType,
  JAM_ENTRY_SORTS,
  type JamEntrySort,
  type PageState,
} from "./custom-id.ts";
import { jamEntries, jamEntriesPage, jamInfo, jamNow, jamResults } from "./jam.ts";
import { memberByDiscordId, memberByName } from "./member.ts";
import { ping } from "./ping.ts";
import { teamInfo } from "./team.ts";

/** Command and option names — the manifest and the adapter both read these. */
export const COMMAND = {
  jam: "jam",
  collab: "collab",
  member: "member",
  team: "team",
  ping: "ping",
} as const;

export const SUB = {
  jam: { now: "now", info: "info", entries: "entries", results: "results" },
  collab: { browse: "browse", post: "post", stats: "stats" },
} as const;

export const OPT = {
  jam: "jam",
  sort: "sort",
  search: "search",
  share: "share",
  type: "type",
  skill: "skill",
  role: "role",
  id: "id",
  user: "user",
  name: "name",
} as const;

/** The user context-menu entry; right-click on a member is how people will
 *  actually reach `/member`. */
export const PROFILE_CONTEXT_MENU = "Brackeys profile";

export type OptionValue = string | number | boolean;

/**
 * A command as plain data — what the adapter extracts from an interaction
 * before anything else runs, and what tests build by hand.
 */
export interface Invocation {
  command: string;
  subcommand?: string;
  options: Record<string, OptionValue | undefined>;
  /** The Discord id behind a `user` option or a user context menu. */
  targetUserId?: string;
}

/**
 * Decided *before* the reply is deferred: Discord fixes a message's
 * visibility at the first response. `/jam now` is the one command posted
 * for the channel; everything else is ephemeral unless `share: true`.
 */
export function replyVisibility(inv: Invocation): "public" | "ephemeral" {
  if (inv.command === COMMAND.jam && inv.subcommand === SUB.jam.now) return "public";
  if (inv.command === COMMAND.ping || inv.command === PROFILE_CONTEXT_MENU) return "ephemeral";
  return inv.options[OPT.share] === true ? "public" : "ephemeral";
}

export async function runInvocation(
  api: PublicApi,
  inv: Invocation,
  ctx: CommandContext,
): Promise<Reply> {
  const share = replyVisibility(inv) === "public";
  const str = (name: string) => {
    const v = inv.options[name];
    return typeof v === "string" ? v : undefined;
  };
  const int = (name: string) => {
    const v = inv.options[name];
    return typeof v === "number" && Number.isInteger(v) ? v : undefined;
  };

  switch (inv.command) {
    case COMMAND.ping:
      return ping(api, ctx);

    case COMMAND.jam: {
      const jam = str(OPT.jam) ?? "";
      switch (inv.subcommand) {
        case SUB.jam.now:
          return jamNow(api, ctx);
        case SUB.jam.info:
          return jamInfo(api, { jam, share }, ctx);
        case SUB.jam.entries:
          return jamEntries(
            api,
            { jam, sort: asEnum(str(OPT.sort), JAM_ENTRY_SORTS), search: str(OPT.search), share },
            ctx,
          );
        case SUB.jam.results:
          return jamResults(api, { jam, share }, ctx);
      }
      break;
    }

    case COMMAND.collab:
      switch (inv.subcommand) {
        case SUB.collab.browse:
          return collabBrowse(
            api,
            {
              type: asEnum(str(OPT.type), COLLAB_TYPES),
              skillId: int(OPT.skill),
              roleId: int(OPT.role),
              jam: str(OPT.jam),
              search: str(OPT.search),
              share,
            },
            ctx,
          );
        case SUB.collab.post: {
          const id = int(OPT.id);
          if (id == null || id < 1)
            return textReply("Give the post's number — it's in its brackeys.dev URL.");
          return collabPost(api, { id, share }, ctx);
        }
        case SUB.collab.stats:
          return collabStats(api, { share }, ctx);
      }
      break;

    case COMMAND.member: {
      const name = str(OPT.name)?.trim();
      if (inv.targetUserId && name) {
        return textReply(
          "Pick one: mention a member with `user`, or type a site name with `name`.",
        );
      }
      if (inv.targetUserId)
        return memberByDiscordId(api, { discordId: inv.targetUserId, share }, ctx);
      if (name) return memberByName(api, { name, share }, ctx);
      return textReply("Mention a member with `user`, or type part of their name with `name`.");
    }

    case PROFILE_CONTEXT_MENU:
      if (!inv.targetUserId) return textReply("No member selected.");
      return memberByDiscordId(api, { discordId: inv.targetUserId, share: false }, ctx);

    case COMMAND.team:
      return teamInfo(api, { team: str(OPT.name) ?? "", share }, ctx);
  }
  return textReply(
    "That command isn't wired up — the bot may be mid-deploy. Try again in a minute.",
  );
}

/** A button press: the state came out of its `custom_id`. */
export function runPage(
  api: PublicApi,
  state: PageState,
  ctx: CommandContext,
  ephemeral: boolean,
): Promise<Reply> {
  switch (state.kind) {
    case "jam_entries":
      return jamEntriesPage(api, state, ctx, ephemeral);
    case "collab_browse":
      return collabBrowsePage(api, state, ctx, ephemeral);
  }
}

function asEnum<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

export type { CollabType, JamEntrySort };
