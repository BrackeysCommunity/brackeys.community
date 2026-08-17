import { createFileRoute } from "@tanstack/react-router";

import { TermsDocument } from "@/components/legal/TermsDocument";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service · Brackeys Community" },
      {
        name: "description",
        content:
          "The agreement covering who may use brackeys.community, what you may post, what we may moderate, and where the limits of our responsibility lie.",
      },
    ],
  }),
  component: TermsRoute,
});

function TermsRoute() {
  return <TermsDocument />;
}
