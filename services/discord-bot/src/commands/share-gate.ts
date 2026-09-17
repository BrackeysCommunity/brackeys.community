/**
 * Who may put a command's answer in front of the whole channel.
 *
 * `share: true` turns a private answer into a public post, which is the one
 * thing a member can make the bot do *to* a channel. Left open, a listing
 * command is a way to drop a wall of embeds into any conversation. So it is
 * staff's to use anywhere, and everyone's inside the bot channel — the room
 * that exists for exactly this.
 *
 * Both inputs are free: a guild interaction already carries the caller's
 * role ids and the channel it came from, so the gate costs no API call and
 * cannot be slow.
 *
 * Unconfigured (no role ids) means unrestricted, matching how the rest of
 * the service treats absent configuration — a deploy that hasn't been given
 * the ids should not silently stop staff from sharing.
 */

export interface ShareGateConfig {
  /** Roles that may share in any channel. Empty disables the gate. */
  roleIds: readonly string[];
  /** Where anyone may share. Null means nowhere is exempt. */
  botChannelId: string | null;
  /** How that channel is named in the refusal. */
  botChannelName: string;
}

export interface ShareRequest {
  /** Whether the caller actually asked for a public answer. */
  wanted: boolean;
  actorRoleIds: readonly string[];
  channelId: string | null;
}

export type ShareDecision =
  | { shared: boolean; denied: false }
  | { shared: false; denied: true; notice: string };

export function shareNotice(config: ShareGateConfig): string {
  return `Kept private — sharing to a channel is staff-only. Use #${config.botChannelName}.`;
}

export function decideShare(request: ShareRequest, config: ShareGateConfig): ShareDecision {
  if (!request.wanted) return { shared: false, denied: false };
  if (config.roleIds.length === 0) return { shared: true, denied: false };
  if (config.botChannelId != null && request.channelId === config.botChannelId) {
    return { shared: true, denied: false };
  }
  const privileged = request.actorRoleIds.some((id) => config.roleIds.includes(id));
  if (privileged) return { shared: true, denied: false };
  return { shared: false, denied: true, notice: shareNotice(config) };
}
