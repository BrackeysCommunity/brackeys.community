import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { NotificationPreferences } from "@/components/notifications/NotificationPreferences";
import {
  NotificationsInbox,
  type InboxFilter,
} from "@/components/notifications/NotificationsInbox";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  view: z.enum(["inbox", "preferences"]).default("inbox"),
  filter: z.enum(["all", "unread", "collab", "system"]).default("all"),
});

type View = "inbox" | "preferences";

function NotificationsRoute() {
  const { view, filter } = Route.useSearch();
  const navigate = useNavigate();

  const setView = (next: View) =>
    navigate({
      to: "/notifications",
      search: (prev) => ({ ...prev, view: next }),
      replace: true,
    });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-6">
      <div className="flex items-center gap-2">
        {(["inbox", "preferences"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn(
              "border-b-2 px-3 py-1.5 font-mono text-[10px] font-bold tracking-widest uppercase transition-colors",
              view === v
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {v === "inbox" ? "Inbox" : "Preferences"}
          </button>
        ))}
      </div>

      {view === "preferences" ? (
        <NotificationPreferences />
      ) : (
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
      )}
    </div>
  );
}

export const Route = createFileRoute("/notifications")({
  validateSearch: searchSchema,
  component: NotificationsRoute,
});
