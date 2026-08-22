import { createFileRoute } from "@tanstack/react-router";

import { MotionSection } from "@/components/settings/MotionSection";
import { pageTitle } from "@/lib/site-meta";

export const Route = createFileRoute("/settings/motion")({
  component: MotionSection,
  head: () => ({ meta: [{ title: pageTitle("Motion & sound · Settings") }] }),
});
