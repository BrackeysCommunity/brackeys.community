import { createFileRoute } from "@tanstack/react-router";

import { PrivacySection } from "@/components/settings/PrivacySection";
import { pageTitle } from "@/lib/site-meta";

export const Route = createFileRoute("/settings/privacy")({
  component: PrivacySection,
  head: () => ({ meta: [{ title: pageTitle("Privacy · Settings") }] }),
});
