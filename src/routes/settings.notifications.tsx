import { createFileRoute } from "@tanstack/react-router";

import { NotificationsSection } from "@/components/settings/NotificationsSection";
import { pageTitle } from "@/lib/site-meta";

export const Route = createFileRoute("/settings/notifications")({
  component: NotificationsSection,
  head: () => ({ meta: [{ title: pageTitle("Notifications · Settings") }] }),
});
