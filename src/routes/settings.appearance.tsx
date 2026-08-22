import { createFileRoute } from "@tanstack/react-router";

import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { pageTitle } from "@/lib/site-meta";

export const Route = createFileRoute("/settings/appearance")({
  component: AppearanceSection,
  head: () => ({ meta: [{ title: pageTitle("Appearance · Settings") }] }),
});
