import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import {
  NotificationsInbox,
  type InboxFilter,
} from "@/components/notifications/NotificationsInbox";
import { Button } from "@/components/ui/button";
import { MicroLabel } from "@/components/ui/typography";

// `view` survives only so the old `?view=preferences` links still resolve —
// the preferences themselves moved to /settings, and `beforeLoad` forwards
// anyone arriving on the retired value.
const searchSchema = z.object({
  view: z.enum(["inbox", "preferences"]).default("inbox"),
  filter: z
    .enum(["all", "unread", "collab", "teams", "jams", "comments", "moderation"])
    .default("all"),
});

function NotificationsRoute() {
  const { filter } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-6">
      <div className="flex items-center justify-between gap-2 border-b border-muted/30 pb-2">
        <MicroLabel as="span" bold className="uppercase">
          Inbox
        </MicroLabel>
        <Button
          variant="ghost"
          size="xs"
          className="tracking-widest"
          render={<Link to="/settings/notifications" />}
        >
          PREFERENCES
          <HugeiconsIcon icon={ArrowRight01Icon} size={12} strokeWidth={2} />
        </Button>
      </div>

      <NotificationsInbox
        filter={filter}
        onFilterChange={(next: InboxFilter) =>
          navigate({
            to: "/notifications",
            search: (prev) => ({ ...prev, filter: next }),
            replace: true,
          })
        }
      />
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
});
