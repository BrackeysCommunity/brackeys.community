import { createFileRoute } from "@tanstack/react-router";

import { PrivacySection } from "@/components/settings/PrivacySection";

export const Route = createFileRoute("/settings/privacy")({
  component: PrivacySection,
  head: () => ({ meta: [{ title: "Privacy · Settings · Brackeys Community" }] }),
});
