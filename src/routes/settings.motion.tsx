import { createFileRoute } from "@tanstack/react-router";

import { MotionSection } from "@/components/settings/MotionSection";

export const Route = createFileRoute("/settings/motion")({
  component: MotionSection,
  head: () => ({ meta: [{ title: "Motion & sound · Settings · Brackeys Community" }] }),
});
