import { useRouterState } from "@tanstack/react-router";
import { AnimatePresence } from "framer-motion";
import { useEffect } from "react";

import {
  type AnnouncementHistory,
  closeAnnouncement,
  markAnnouncementSeen,
  syncAnnouncementHistory,
  useAnnouncementHistory,
  useSyncedAccount,
} from "@/components/announcements/announcement-history";
import {
  type Banner,
  BANNER_COLLECTIONS,
  type BannerCollection,
  DEFAULT_SHOW_FOR_DAYS,
} from "@/components/announcements/announcements";
import { CookieBanner } from "@/components/announcements/CookieBanner";
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

export interface BannerContext {
  history: AnnouncementHistory;
  flags: FeatureFlagValues;
  signedIn: boolean;
  pathname: string;
  now: number;
}

function isEligible(b: Banner, ctx: BannerContext): boolean {
  const record = ctx.history[b.id];
  const lifetime = (b.showForDays ?? DEFAULT_SHOW_FOR_DAYS) * DAY_MS;
  return (
    !record?.closed &&
    (!record || ctx.now < record.firstSeen + lifetime) &&
    (!b.flag || ctx.flags[b.flag]) &&
    (b.audience !== "signed-in" || ctx.signedIn) &&
    (!b.until || ctx.now < Date.parse(b.until)) &&
    !b.hiddenOn?.some((p) => ctx.pathname === p || ctx.pathname.startsWith(`${p}/`))
  );
}

const byPriority = (a: { priority?: number }, b: { priority?: number }) =>
  (b.priority ?? 0) - (a.priority ?? 0);

/** The banner to show, if any: highest collection first, then highest banner within it. */
export function pickBanner(
  collections: readonly BannerCollection[],
  ctx: BannerContext,
): Banner | undefined {
  for (const collection of [...collections].sort(byPriority)) {
    const banner = [...collection.banners].sort(byPriority).find((b) => isEligible(b, ctx));
    if (banner) return banner;
  }
  return undefined;
}

/**
 * The floating banner, one at a time. Client-only: its history lives in this
 * browser and some banners wait on the session.
 */
export function BannerSlot({ mobile }: { mobile: boolean }) {
  const hydrated = useIsHydrated();
  const history = useAnnouncementHistory();
  const flags = useFlags();
  const { data: session, isPending } = authClient.useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const now = useDateNow();
  const userId = session?.user?.id ?? null;
  const syncedAccount = useSyncedAccount();

  useEffect(() => {
    if (!isPending) void syncAnnouncementHistory(userId);
  }, [isPending, userId]);

  // A signed-in viewer waits for the account's history, or a new device would
  // flash a banner already closed elsewhere.
  const banner =
    hydrated && !isPending && (!userId || syncedAccount === userId)
      ? pickBanner(BANNER_COLLECTIONS, {
          history,
          flags,
          signedIn: !!userId,
          pathname,
          now,
        })
      : undefined;

  const shownId = banner?.id;
  useEffect(() => {
    if (shownId) markAnnouncementSeen(shownId, Date.now());
  }, [shownId]);

  const handlers = banner
    ? {
        onDismiss: () => {
          captureEvent(EVENTS.announcementDismissed, { announcement: banner.id });
          closeAnnouncement(banner.id, Date.now());
        },
        onFollow: () => {
          captureEvent(EVENTS.announcementCtaClicked, { announcement: banner.id });
          closeAnnouncement(banner.id, Date.now());
        },
      }
    : undefined;

  return (
    <div
      className={cn(
        "pointer-events-none fixed z-61 flex",
        mobile
          ? "inset-x-3 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] justify-center"
          : "right-6 bottom-6 justify-end",
      )}
    >
      <AnimatePresence>
        {banner && handlers ? (
          banner.kind === "feature" ? (
            <FeatureBanner key={banner.id} announcement={banner} {...handlers} />
          ) : (
            <CookieBanner key={banner.id} {...handlers} />
          )
        ) : null}
      </AnimatePresence>
      {hydrated ? <SpotlightOverlay /> : null}
    </div>
  );
}
