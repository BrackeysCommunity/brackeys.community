/**
 * Deep links that open the Discord **app** rather than its web client.
 *
 * `discord://` is handed to the installed desktop client by the OS, so a
 * click lands on the real thing instead of a second, signed-out-looking web
 * Discord in a browser tab. The `-` in the authority position is Discord's
 * own placeholder for "no host, the path below is the route".
 *
 * **The trade-off, stated once here so call sites don't relitigate it:** a
 * `discord://` URL does nothing at all for someone without the desktop app,
 * where an `https://discord.com/…` URL would at least load the web client.
 * Every call site therefore carries a fallback that doesn't depend on the
 * link resolving — the handle on the clipboard, the message already visible
 * in the channel — and none of them is the only route to the thing.
 *
 * Invites are deliberately absent. `discord.gg/brackeys` stays `https`:
 * it is aimed at people who do not have the server, and often not the app.
 */

/** Someone's profile popout, by Discord user id. */
export function discordUserLink(discordUserId: string): string {
  return `discord://-/users/${discordUserId}`;
}

/** One message in one channel — jumps to it in place. */
export function discordMessageLink(guildId: string, channelId: string, messageId: string): string {
  return `discord://-/channels/${guildId}/${channelId}/${messageId}`;
}
