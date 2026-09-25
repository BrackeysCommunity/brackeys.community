import { os } from "@orpc/server";
import { inArray, sql } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import { developerProfiles, profileUrlStubs } from "@/db/schema";
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
