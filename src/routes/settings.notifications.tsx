import { createFileRoute } from "@tanstack/react-router";

import { NotificationsSection } from "@/components/settings/NotificationsSection";

export const Route = createFileRoute("/settings/notifications")({
  component: NotificationsSection,
  head: () => ({ meta: [{ title: "Notifications · Settings · Brackeys Community" }] }),
});
