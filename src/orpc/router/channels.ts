import { os } from "@orpc/server";
import * as z from "zod";

import { getGuildChannels, getGuildRoles, lookupGuildChannel } from "@/lib/discord";

/** The guild's public channels and active threads, for rendering `<#id>` tokens as names. */
export const listGuildChannels = os.route({ method: "GET" }).handler(() => getGuildChannels());

/** One `<#id>` the list doesn't have, usually an archived thread; null when it isn't public. */
export const resolveGuildChannel = os
  .route({ method: "GET" })
  .input(z.object({ id: z.string().regex(/^\d{17,20}$/) }))
  .handler(({ input }) => lookupGuildChannel(input.id));

/** The guild's roles, for rendering `<@&id>` tokens. */
export const listGuildRoles = os.route({ method: "GET" }).handler(() => getGuildRoles());
