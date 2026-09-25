import { DiscordIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { Store, useStore } from "@tanstack/react-store";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { openDiscordInvite } from "@/components/ui/discord-invite-link";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Text } from "@/components/ui/typography";
import { activeUserStore, updateActiveUserProfile } from "@/lib/active-user-store";
import { signInWithDiscord } from "@/lib/auth-client";
import { authStore } from "@/lib/auth-store";
import { errorMessage } from "@/lib/error-message";
import { EVENTS } from "@/lib/event-taxonomy";
import { isNotGuildMemberError } from "@/lib/guild-gate";
import { captureEvent } from "@/lib/product-insights";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";

/** What the viewer tried to do — the telemetry's `action`. */
export type GuildGateAction =
  | "compose"
  | "post"
  | "comment"
  | "like"
  | "save"
  | "upload"
  | "edit"
  | "delete"
  | "follow"
  | "solve"
  | "share";

type Blocked = { action: GuildGateAction; run: () => void };

/**
 * One blocked action at a time, app-wide, so any control can raise the
 * modal and the single `GuildGateModal` the forum layout mounts answers it.
 */
const gateStore = new Store<{ blocked: Blocked | null }>({ blocked: null });

function openGate(blocked: Blocked) {
  captureEvent(EVENTS.forumGuildGateShown, { action: blocked.action, signedIn: true });
  gateStore.setState(() => ({ blocked }));
}

/**
 * The client half of the guild bar. Every forum write goes through
 * `guard`: signed out, it signs in; signed in but outside the Brackeys
 * Discord, the Join Discord modal opens instead and runs the action once
 * a re-check passes. Controls stay enabled for everyone — clicking one is
 * how a non-member finds the way in.
 *
 * The server is the real gate. `onServerRefusal` catches the FORBIDDEN a
 * member gets after leaving the server mid-session and turns it into the
 * same modal; it returns false for any other error, which the caller
 * handles as usual.
 */
export function useGuildGate() {
  const { session } = useStore(authStore);
  const signedIn = Boolean(session?.user);
  const inGuild = useStore(activeUserStore, (s) => s.profile?.inGuild);

  const guard = useCallback(
    (action: GuildGateAction, run: () => void) => {
      if (!signedIn) {
        void signInWithDiscord("forum");
        return;
      }
      // `undefined` is a profile still loading: let it through and leave
      // the answer to the server.
      if (inGuild === false) {
        openGate({ action, run });
        return;
      }
      run();
    },
    [signedIn, inGuild],
  );

  const onServerRefusal = useCallback(
    (error: unknown, action: GuildGateAction, retry: () => void): boolean => {
      if (!isNotGuildMemberError(error)) return false;
      updateActiveUserProfile({ inGuild: false });
      openGate({ action, run: retry });
      return true;
    },
    [],
  );

  return { guard, onServerRefusal, signedIn };
}

/** Mounted once, by the forum layout. */
export function GuildGateModal() {
  const blocked = useStore(gateStore, (s) => s.blocked);
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);

  const close = () => gateStore.setState(() => ({ blocked: null }));

  const recheck = async () => {
    if (!blocked) return;
    setChecking(true);
    try {
      const { inGuild } = await client.refreshGuildMembership({});
      if (!inGuild) {
        toast.error("Still not seeing you in the server.", {
          description: "Joined just now? Give Discord a few seconds, then check again.",
        });
        return;
      }
      updateActiveUserProfile({ inGuild: true });
      void queryClient.invalidateQueries({ queryKey: orpc.getMyProfile.key() });
      captureEvent(EVENTS.forumGuildGateResolved, { action: blocked.action });
      close();
      blocked.run();
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't check right now — try again."));
    } finally {
      setChecking(false);
    }
  };

  return (
    <ResponsiveModal
      open={blocked !== null}
      onClose={close}
      title="Join the Brackeys Discord to post"
      description="Posting in the forum is for members of the Brackeys Discord server."
      footer={
        <div className="flex flex-wrap justify-end gap-2 border-t border-muted/40 px-5 py-4">
          <Button variant="outline" size="sm" onClick={recheck} disabled={checking}>
            I&apos;ve joined, check again
          </Button>
          <Button
            size="sm"
            className="tracking-widest"
            onClick={() => openDiscordInvite("forum_gate")}
          >
            <HugeiconsIcon icon={DiscordIcon} size={14} />
            JOIN THE SERVER
          </Button>
        </div>
      }
    >
      <div className="px-5 pb-5">
        <Text size="sm" variant="muted">
          Posting, commenting and reacting are for members of the Brackeys Discord server. Reading
          stays open to everyone — and whatever you were writing is still here when you get back.
        </Text>
      </div>
    </ResponsiveModal>
  );
}
