import { os } from "@orpc/server";

import { getGuildChannels } from "@/lib/discord";

/** The guild's public channels, for rendering `<#id>` tokens as names. */
export const listGuildChannels = os.route({ method: "GET" }).handler(() => getGuildChannels());
