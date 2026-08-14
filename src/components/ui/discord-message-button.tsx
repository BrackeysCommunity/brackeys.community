import { DiscordIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";

/**
 * A deep link into Discord's DM with one person. The sanctioned replacement
 * for in-app messaging, which was cut deliberately
 * (`docs/plans/11-social-comment-threads.md` §"Direct messages: cut") — so
 * this button is the whole "two matched people can now talk" story and wants
 * to look the same everywhere it appears.
 *
 * Renders nothing without a `discordId`, so every call site can hand over a
 * nullable id without guarding first.
 */
export function DiscordMessageButton({
  discordId,
  label = "MESSAGE",
  size = "sm",
  className,
  personLabel,
}: {
  discordId: string | null | undefined;
  label?: string;
  size?: "xs" | "sm";
  className?: string;
  /** Who this messages, for screen readers — e.g. "@ada". */
  personLabel?: string;
}) {
  if (!discordId) return null;

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
          aria-label={personLabel ? `Message ${personLabel} on Discord` : "Message on Discord"}
        />
      }
    >
      <HugeiconsIcon icon={DiscordIcon} size={size === "xs" ? 11 : 14} />
      <span className="tracking-widest">{label}</span>
    </Button>
  );
}
