import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import {
  NotificationsInbox,
  type InboxFilter,
} from "@/components/notifications/NotificationsInbox";

const searchSchema = z.object({
  filter: z.enum(["all", "unread", "collab", "system"]).default("all"),
});

function NotificationsRoute() {
  const { filter } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <NotificationsInbox
      filter={filter}
      onFilterChange={(next: InboxFilter) =>
        navigate({ to: "/notifications", search: { filter: next }, replace: true })
      }
    />
  );
}

export const Route = createFileRoute("/notifications")({
  validateSearch: searchSchema,
  component: NotificationsRoute,
});
