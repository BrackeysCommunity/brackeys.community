import type * as React from "react";

import { discordInviteLink } from "@/lib/discord-links";
import { EVENTS, type DiscordInviteSource } from "@/lib/event-taxonomy";
import { SITE } from "@/lib/legal-meta";
import { captureEvent } from "@/lib/product-insights";
import { toast } from "@/lib/toast";

/**
 * The web fallback every invite carries. `discord://` does nothing at all
 * without the desktop app, so the toast's button is the way in for everyone
 * else — the `https` invite, in a new tab.
 */
function inviteFallbackToast(source: DiscordInviteSource) {
  captureEvent(EVENTS.discordInviteOpened, { source, method: "app" });
  toast("Opening Discord…", {
    description: "Nothing happened? Open the invite in your browser instead.",
    action: {
      label: "Open Discord",
      onClick: () => {
        captureEvent(EVENTS.discordInviteOpened, { source, method: "web" });
        window.open(SITE.discord, "_blank", "noopener,noreferrer");
      },
    },
  });
}

/** Imperative invite, for button-shaped triggers and command palette rows. */
export function openDiscordInvite(source: DiscordInviteSource) {
  window.location.assign(discordInviteLink());
  inviteFallbackToast(source);
}

/**
 * A real link to the server invite. It stays an `<a href>` — middle-click,
 * copy link and the status bar all see the invite — and raises the fallback
 * toast on the way out. No `target="_blank"`: a custom scheme in a new tab
 * leaves a blank one behind when the OS takes the handoff.
 */
export function DiscordInviteLink({
  source,
  onClick,
  children,
  ...props
}: Omit<React.ComponentProps<"a">, "href" | "target"> & { source: DiscordInviteSource }) {
  return (
    <a
      {...props}
      href={discordInviteLink()}
      onClick={(event) => {
        onClick?.(event);
        inviteFallbackToast(source);
      }}
    >
      {children}
    </a>
  );
}
