import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { authClient } from "@/lib/auth-client";
import {
  announceDiscordAppSignin,
  onDiscordAppSignin,
  readDiscordAppReturn,
} from "@/lib/discord-app-login";
import { toast } from "@/lib/toast";

/**
 * Both ends of a desktop-client sign-in (`@/lib/discord-app-login`).
 *
 * The tab the client opens lands here carrying the return marker: it tells
 * the other tabs a session now exists and tries to close itself. The
 * redirect chain leaves it with a single history entry, which is the one
 * case browsers let a page close — where that is refused it stays put,
 * signed in, with a note. The tab the person started from hears the
 * announcement and refetches, so it is signed in by the time focus returns.
 */
export function DiscordAppReturn() {
  const { data: session, isPending, refetch } = authClient.useSession();
  const router = useRouter();
  const returned = useRef<boolean | null>(null);

  useEffect(() => {
    if (returned.current !== null) return;
    const read = readDiscordAppReturn(window.location.href);
    returned.current = read.returned;
    if (read.returned) router.history.replace(read.href, window.history.state);
  }, [router]);

  useEffect(() => {
    if (!returned.current || isPending || !session?.user) return;
    returned.current = false;
    announceDiscordAppSignin();
    window.close();
    const note = setTimeout(() => {
      toast.success("Signed in", {
        description: "You can close this tab and pick up where you left off.",
      });
    }, 300);
    return () => clearTimeout(note);
  }, [session, isPending]);

  useEffect(() => onDiscordAppSignin(() => void refetch()), [refetch]);

  return null;
}
