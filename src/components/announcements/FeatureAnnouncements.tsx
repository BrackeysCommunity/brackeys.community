import { useRouterState } from "@tanstack/react-router";
import { AnimatePresence } from "framer-motion";
import { useEffect } from "react";

import {
  type AnnouncementHistory,
  closeAnnouncement,
  markAnnouncementSeen,
  useAnnouncementHistory,
} from "@/components/announcements/announcement-history";
import {
  type Announcement,
  ANNOUNCEMENTS,
  DEFAULT_SHOW_FOR_DAYS,
} from "@/components/announcements/announcements";
import { FeatureBanner } from "@/components/announcements/FeatureBanner";
import { SpotlightOverlay } from "@/components/announcements/SpotlightOverlay";
import { authClient } from "@/lib/auth-client";
import { EVENTS } from "@/lib/event-taxonomy";
import type { FeatureFlagValues } from "@/lib/flags";
import { DAY_MS } from "@/lib/format-time";
import useDateNow from "@/lib/hooks/use-date-now";
import { useFlags } from "@/lib/hooks/use-flag";
import { useIsHydrated } from "@/lib/hooks/use-is-hydrated";
import { captureEvent } from "@/lib/product-insights";
import { cn } from "@/lib/utils";

export interface AnnouncementContext {
  history: AnnouncementHistory;
  flags: FeatureFlagValues;
  signedIn: boolean;
  pathname: string;
  now: number;
}

/** The announcement to show, if any. Registry order is priority. */
export function pickAnnouncement(
  announcements: readonly Announcement[],
  ctx: AnnouncementContext,
): Announcement | undefined {
  return announcements.find((a) => {
    const record = ctx.history[a.id];
    const lifetime = (a.showForDays ?? DEFAULT_SHOW_FOR_DAYS) * DAY_MS;
    return (
      !record?.closed &&
      (!record || ctx.now < record.firstSeen + lifetime) &&
      (!a.flag || ctx.flags[a.flag]) &&
      (a.audience !== "signed-in" || ctx.signedIn) &&
      (!a.until || ctx.now < Date.parse(a.until)) &&
      !a.hiddenOn?.some((p) => ctx.pathname === p || ctx.pathname.startsWith(`${p}/`))
    );
  });
}

/**
 * The floating new-feature banner, one at a time. Client-only: its history
 * live in this browser and most announcements wait on the session.
 */
export function FeatureAnnouncements({ mobile }: { mobile: boolean }) {
  const hydrated = useIsHydrated();
  const history = useAnnouncementHistory();
  const flags = useFlags();
  const { data: session, isPending } = authClient.useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const now = useDateNow();

  const announcement =
    hydrated && !isPending
      ? pickAnnouncement(ANNOUNCEMENTS, {
          history,
          flags,
          signedIn: !!session?.user,
          pathname,
          now,
        })
      : undefined;

  const shownId = announcement?.id;
  useEffect(() => {
    if (shownId) markAnnouncementSeen(shownId, Date.now());
  }, [shownId]);

  return (
    <div
      className={cn(
        "pointer-events-none fixed z-61 flex",
        mobile
          ? "inset-x-3 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] justify-center"
          : "bottom-6 left-6",
      )}
    >
      <AnimatePresence>
        {announcement ? (
          <FeatureBanner
            key={announcement.id}
            announcement={announcement}
            onDismiss={() => {
              captureEvent(EVENTS.announcementDismissed, { announcement: announcement.id });
              closeAnnouncement(announcement.id, Date.now());
            }}
            onFollow={() => {
              captureEvent(EVENTS.announcementCtaClicked, { announcement: announcement.id });
              closeAnnouncement(announcement.id, Date.now());
            }}
          />
        ) : null}
      </AnimatePresence>
      {hydrated ? <SpotlightOverlay /> : null}
    </div>
  );
}
