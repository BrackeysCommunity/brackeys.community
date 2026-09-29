import { os } from "@orpc/server";
import { inArray, sql } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import { developerProfiles, profileUrlStubs } from "@/db/schema";
import { lookupGuildMemberName } from "@/lib/discord";
import type { DiscordUserName } from "@/lib/discord-mentions";
import { memberName } from "@/lib/member-name";
import { profileStubJoin } from "@/orpc/profile-projection";

/**
 * Display names for `@handle` mentions, so a body that stores the stable
 * handle can show the name people know. Handles nobody owns are absent.
 */
export const resolveMentions = os
  .route({ method: "GET" })
  .input(
    z.object({
      handles: z
        .array(
          z
            .string()
            .trim()
            .toLowerCase()
            .regex(/^[a-z0-9_-]{2,32}$/),
        )
        .min(1)
        .max(50),
    }),
  )
  .handler(async ({ input }) => {
    const rows = await db
      .select({
        handle: profileUrlStubs.stub,
        guildNickname: developerProfiles.guildNickname,
        discordUsername: developerProfiles.discordUsername,
        avatarUrl: developerProfiles.avatarUrl,
      })
      .from(profileUrlStubs)
      .innerJoin(developerProfiles, profileStubJoin)
      .where(inArray(sql`lower(${profileUrlStubs.stub})`, [...new Set(input.handles)]));
    return rows.map(({ handle, avatarUrl, ...names }) => ({
      handle: handle.toLowerCase(),
      displayName: memberName(names, handle),
      avatarUrl,
    }));
  });

/**
 * Names for Discord `<@id>` mentions: the site profile when they have one,
 * otherwise their name in the guild. Ids that are neither are absent.
 */
export const resolveDiscordUsers = os
  .route({ method: "GET" })
  .input(
    z.object({
      ids: z
        .array(z.string().regex(/^\d{17,20}$/))
        .min(1)
        .max(50),
    }),
  )
  .handler(async ({ input }): Promise<DiscordUserName[]> => {
    const ids = [...new Set(input.ids)];
    const rows = await db
      .select({
        discordId: developerProfiles.discordId,
        handle: profileUrlStubs.stub,
        guildNickname: developerProfiles.guildNickname,
        discordUsername: developerProfiles.discordUsername,
        avatarUrl: developerProfiles.avatarUrl,
      })
      .from(developerProfiles)
      .leftJoin(profileUrlStubs, profileStubJoin)
      .where(inArray(developerProfiles.discordId, ids));
    const found: DiscordUserName[] = rows.map(({ discordId, handle, avatarUrl, ...names }) => ({
      discordId: discordId!,
      handle: handle?.toLowerCase() ?? null,
      displayName: memberName(names, handle ?? "unknown-user"),
      avatarUrl,
    }));
    const onSite = new Set(found.map((f) => f.discordId));
    const members = await Promise.all(
      ids.filter((id) => !onSite.has(id)).map((id) => lookupGuildMemberName(id)),
    );
    for (const member of members) if (member) found.push({ ...member, handle: null });
    return found;
  });
