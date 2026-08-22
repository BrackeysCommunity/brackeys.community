import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { z } from "zod";

import { NotificationsHero } from "@/components/notifications/NotificationsHero";
import {
  NotificationsInbox,
  type InboxFilter,
} from "@/components/notifications/NotificationsInbox";
import { UnderlineTabs, type UnderlineTab } from "@/components/ui/underline-tabs";
import { useReducedMotion } from "@/lib/hooks/use-app-settings";
import { EASE_OUT } from "@/lib/motion";
import { invalidateNotifications } from "@/lib/notification-queries";
import { pageTitle } from "@/lib/site-meta";
import { client, orpc } from "@/orpc/client";

// `view` survives only so the old `?view=preferences` links still resolve —
// the preferences themselves moved to /settings, and `beforeLoad` forwards
// anyone arriving on the retired value.
const searchSchema = z.object({
  view: z.enum(["inbox", "preferences"]).default("inbox"),
  filter: z
    .enum(["all", "unread", "collab", "teams", "jams", "comments", "moderation"])
    .default("all"),
});

const TABS: { key: InboxFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "collab", label: "Collab" },
  { key: "teams", label: "Teams" },
  { key: "jams", label: "Jams" },
  { key: "comments", label: "Comments" },
  { key: "moderation", label: "Moderation" },
];

function NotificationsRoute() {
  const { filter } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reduced = useReducedMotion();

  const counts = useQuery(orpc.countNotifications.queryOptions({ input: {} }));

  const { mutate: markAllRead, isPending: markAllReadPending } = useMutation({
    mutationFn: () => client.markAllRead({}),
    onSuccess: () => invalidateNotifications(queryClient),
  });

  // Badges count what's *unread* rather than what's there: the reason to
  // open a tab is the part you haven't read, and "Collab 214" on a
  // long-standing account is noise, not a queue.
  const byCategory = counts.data?.byCategory;
  const tabs: UnderlineTab<InboxFilter>[] = TABS.map((tab) => ({
    ...tab,
    count:
      tab.key === "all"
        ? undefined
        : tab.key === "unread"
          ? counts.data?.unread
          : byCategory?.[tab.key].unread,
  }));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-6">
      <NotificationsHero
        unread={counts.data?.unread ?? 0}
        total={counts.data?.total ?? 0}
        onMarkAllRead={() => markAllRead()}
        markAllReadPending={markAllReadPending}
      />

      <UnderlineTabs
        tabs={tabs}
        active={filter}
        label="Inbox filter"
        onSelect={(next) =>
          navigate({
            to: "/notifications",
            search: (prev) => ({ ...prev, filter: next }),
            replace: true,
            // The shell scroller carries `view-transition-name: page`, so a
            // default-transitioned hop cross-fades the hero and the strip
            // along with the rows. Switching tabs only changes the list —
            // it animates itself below, and the frame holds still.
            viewTransition: false,
          })
        }
      />

      {/* Keyed on the filter so React tears the old list down and the new one
          animates in on its own — entry-only, matching the settings pane. */}
      <motion.div
        key={filter}
        initial={reduced ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: EASE_OUT }}
        className="flex min-w-0 flex-col"
      >
        <NotificationsInbox filter={filter} />
      </motion.div>
    </div>
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
