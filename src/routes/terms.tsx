import { createFileRoute } from "@tanstack/react-router";

import { TermsDocument } from "@/components/legal/TermsDocument";
import { buildMeta } from "@/lib/site-meta";

export const Route = createFileRoute("/terms")({
  head: () =>
    buildMeta({
      title: "Terms of Service",
      description:
        "The agreement covering who may use brackeys.community, what you may post, what we may moderate, and where the limits of our responsibility lie.",
      path: "/terms",
    }),
  component: TermsRoute,
});

function TermsRoute() {
  return <TermsDocument />;
}
