import { createFileRoute } from "@tanstack/react-router";

import { PrivacyDocument } from "@/components/legal/PrivacyDocument";
import { buildMeta, ogCardPath } from "@/lib/site-meta";

export const Route = createFileRoute("/privacy")({
  head: () =>
    buildMeta({
      title: "Privacy Policy",
      description:
        "What brackeys.community collects about you, where it comes from, who can see it, how long it is kept, and how to have it corrected or removed.",
      path: "/privacy",
      card: ogCardPath("board", "privacy"),
    }),
  component: PrivacyRoute,
});

function PrivacyRoute() {
  return <PrivacyDocument />;
}
