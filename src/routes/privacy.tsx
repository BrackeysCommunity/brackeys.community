import { createFileRoute } from "@tanstack/react-router";

import { PrivacyDocument } from "@/components/legal/PrivacyDocument";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy · Brackeys Community" },
      {
        name: "description",
        content:
          "What brackeys.community collects about you, where it comes from, who can see it, how long it is kept, and how to have it corrected or removed.",
      },
    ],
  }),
  component: PrivacyRoute,
});

function PrivacyRoute() {
  return <PrivacyDocument />;
}
