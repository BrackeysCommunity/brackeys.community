import { DiscordIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

/**
 * A deep link into Discord's DM with one person. The sanctioned replacement
 * for in-app messaging, which was cut deliberately
 * (`docs/plans/11-social-comment-threads.md` §"Direct messages: cut") — so
 * this button is the whole "two matched people can now talk" story and wants
 * to look the same everywhere it appears.
 *
 * **The link is not guaranteed to land.** `discord.com/users/<id>` resolves
 * to a profile popout in the app and in a signed-in web client, and to
 * nothing useful anywhere else — a browser with no Discord session, or a
 * viewer who shares no server with the person. That is the whole of "the
 * message button leads nowhere", so the button no longer pretends
 * otherwise: it says it opens Discord, and it puts the handle on the
 * clipboard on the way out, which is what someone needs when the popout
 * doesn't appear.
 *
 * Renders nothing without a `discordId`, so every call site can hand over a
 * nullable id without guarding first.
 */
export function DiscordMessageButton({
  discordId,
  discordUsername,
  label = "MESSAGE",
  size = "sm",
  className,
  personLabel,
}: {
  discordId: string | null | undefined;
  /** Their Discord handle, copied on click as the fallback for when the
   * deep link doesn't resolve. Omit and the button is a plain link. */
  discordUsername?: string | null;
  label?: string;
  size?: "xs" | "sm";
  className?: string;
  /** Who this messages, for screen readers — e.g. "@ada". */
  personLabel?: string;
}) {
  if (!discordId) return null;

  const who = personLabel ?? (discordUsername ? `@${discordUsername}` : null);
  const description = who ? `Opens Discord — ${who}` : "Opens Discord in a new tab";

  const onCopyHandle = () => {
    if (!discordUsername) return;
    void navigator.clipboard?.writeText(discordUsername);
    toast.success(`@${discordUsername} copied`, {
      description: "Search it in Discord if the link doesn't open their profile.",
    });
  };

  return (
    <Button
      variant="outline"
      size={size}
      className={className}
      nativeButton={false}
      render={
        <a
          href={`https://discord.com/users/${discordId}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={who ? `Message ${who} on Discord` : "Message on Discord"}
          title={description}
          onClick={onCopyHandle}
        />
      }
    >
      <HugeiconsIcon icon={DiscordIcon} size={size === "xs" ? 11 : 14} />
      <span className="tracking-widest">{label}</span>
    </Button>
  );
}
