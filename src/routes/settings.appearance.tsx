import { createFileRoute } from "@tanstack/react-router";

import { AppearanceSection } from "@/components/settings/AppearanceSection";

export const Route = createFileRoute("/settings/appearance")({
  component: AppearanceSection,
  head: () => ({ meta: [{ title: "Appearance · Settings · Brackeys Community" }] }),
});
