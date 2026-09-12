import { InboxIcon, InboxUnreadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { z } from "zod";

import { CATEGORY_ICON } from "@/components/notifications/notification-row";
import { NotificationsHero } from "@/components/notifications/NotificationsHero";
import {
  NotificationsInbox,
  type InboxFilter,
} from "@/components/notifications/NotificationsInbox";
import { Badge } from "@/components/ui/badge";
import { MicroLabel, Text } from "@/components/ui/typography";
import { useReducedMotion } from "@/lib/hooks/use-app-settings";
import { EASE_OUT } from "@/lib/motion";
import { NOTIFICATION_CATEGORY_LABEL } from "@/lib/notification-copy";
import { pageTitle } from "@/lib/site-meta";
import { TOGGLE_CUE } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";

// `view` survives only so the old `?view=preferences` links still resolve —
// the preferences themselves moved to /settings, and `beforeLoad` forwards
// anyone arriving on the retired value.
const searchSchema = z.object({
  view: z.enum(["inbox", "preferences"]).default("inbox"),
  filter: z
    .enum(["all", "unread", "collab", "teams", "jams", "comments", "moderation"])
    .default("all"),
});

const FILTERS: readonly InboxFilter[] = [
  "all",
  "unread",
  "collab",
  "teams",
  "jams",
  "comments",
  "moderation",
];

const FILTER_META: Record<InboxFilter, { label: string; hint: string; icon: IconSvgElement }> = {
  all: { label: "All", hint: "Everything, newest first", icon: InboxIcon },
  unread: { label: "Unread", hint: "What still needs a look", icon: InboxUnreadIcon },
  collab: {
    label: NOTIFICATION_CATEGORY_LABEL.collab,
    hint: "Applications and your posts",
    icon: CATEGORY_ICON.collab,
  },
  teams: {
    label: NOTIFICATION_CATEGORY_LABEL.teams,
    hint: "Invites and roster changes",
    icon: CATEGORY_ICON.teams,
  },
  jams: {
    label: NOTIFICATION_CATEGORY_LABEL.jams,
    hint: "Deadlines on jams you watch",
    icon: CATEGORY_ICON.jams,
  },
  comments: {
    label: NOTIFICATION_CATEGORY_LABEL.comments,
    hint: "Threads you follow",
    icon: CATEGORY_ICON.comments,
  },
  moderation: {
    label: NOTIFICATION_CATEGORY_LABEL.moderation,
    hint: "Reports and requests",
    icon: CATEGORY_ICON.moderation,
  },
};

function NotificationsRoute() {
  const { filter } = Route.useSearch();
  const reduced = useReducedMotion();

  const counts = useQuery(orpc.countNotifications.queryOptions({ input: {} }));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-6">
      <NotificationsHero unread={counts.data?.unread ?? 0} total={counts.data?.total ?? 0} />

      {/* Same shape as /settings and /admin: a rail beside the pane from
          `lg` up, a scrolling tab strip below it. */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[14rem_1fr] lg:items-start lg:gap-10">
        <InboxNav
          filter={filter}
          unread={counts.data?.unread}
          byCategory={counts.data?.byCategory}
        />

        {/* Keyed on the filter so React tears the old list down and the new
            one animates in on its own — entry-only, matching the settings
            pane. */}
        <motion.div
          key={filter}
          initial={reduced ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: EASE_OUT }}
          className="flex min-w-0 flex-col"
        >
          <NotificationsInbox filter={filter} />
        </motion.div>
      </div>
    </div>
  );
}

function InboxNav({
  filter,
  unread,
  byCategory,
}: {
  filter: InboxFilter;
  unread: number | undefined;
  byCategory: Partial<Record<InboxFilter, { unread: number }>> | undefined;
}) {
  return (
    <nav
      aria-label="Inbox filters"
      className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto border-b border-muted/30 px-1 lg:sticky lg:top-4 lg:mx-0 lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0 lg:px-0 lg:pr-2"
    >
      {FILTERS.map((id) => {
        const meta = FILTER_META[id];
        // Every row links to /notifications, so the router calls them all
        // active — the search param is what distinguishes them.
        const isActive = id === filter;
        // Badges count what's *unread* rather than what's there: the reason
        // to open a filter is the part you haven't read.
        const count =
          id === "all" ? 0 : id === "unread" ? (unread ?? 0) : (byCategory?.[id]?.unread ?? 0);
        return (
          <Link
            key={id}
            to="/notifications"
            search={(prev) => ({ ...prev, filter: id })}
            replace
            // Switching filters only changes the list — it animates itself,
            // and the hero and rail hold still.
            viewTransition={false}
            {...TOGGLE_CUE}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative flex items-center gap-2.5 rounded-t px-3 py-3 whitespace-nowrap transition-colors lg:rounded lg:rounded-l-none lg:pl-4",
              isActive
                ? "text-foreground lg:bg-muted/25"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <HugeiconsIcon icon={meta.icon} size={16} />
            <span className="flex flex-col items-start gap-0.5">
              <span className="flex items-center gap-1.5">
                <MicroLabel as="span" variant="inherit" className="uppercase">
                  {meta.label}
                </MicroLabel>
                {count > 0 && (
                  <Badge size="label" variant={isActive ? "default" : "secondary"}>
                    {count}
                  </Badge>
                )}
              </span>
              <Text as="span" size="xs" variant="muted" className="hidden lg:block">
                {meta.hint}
              </Text>
            </span>
            {isActive ? (
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary lg:inset-x-auto lg:inset-y-1 lg:left-0 lg:h-auto lg:w-0.5"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export const Route = createFileRoute("/notifications")({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => {
    if (search.view === "preferences") {
      throw redirect({ to: "/settings/notifications", replace: true });
    }
  },
  component: NotificationsRoute,
  head: () => ({ meta: [{ title: pageTitle("Inbox") }] }),
});
