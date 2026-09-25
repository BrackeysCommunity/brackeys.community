import { os } from "@orpc/server";

import { getGuildEmojis } from "@/lib/discord";

/** The guild's custom emojis for the `:` picker and the renderer. */
export const listGuildEmojis = os.route({ method: "GET" }).handler(() => getGuildEmojis());
