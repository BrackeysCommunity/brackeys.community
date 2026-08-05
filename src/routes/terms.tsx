import { createFileRoute } from "@tanstack/react-router";

import { LegalPlaceholderPage } from "@/components/legal/LegalPlaceholderPage";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms of Service · Brackeys Community" }] }),
  component: TermsRoute,
});

function TermsRoute() {
  return (
    <LegalPlaceholderPage
      marker="§ Legal / Terms"
      title="Terms of Service"
      summary="The rules for using brackeys.community — what you can post, what we can moderate, and what happens to an account that breaks them."
      outline={[
        {
          heading: "Who can use the site",
          blurb: "account eligibility, the Discord link requirement, and age limits.",
        },
        {
          heading: "Your content",
          blurb:
            "you keep ownership of profiles, collab posts, and projects; we get the licence needed to display them.",
        },
        {
          heading: "Conduct",
          blurb:
            "the community rules carried over from the Discord, and what counts as spam or harassment here.",
        },
        {
          heading: "Third-party accounts",
          blurb:
            "what linking Discord, GitHub, or itch.io authorises us to read and sync on your behalf.",
        },
        {
          heading: "Moderation and termination",
          blurb: "how posts get removed, how accounts get suspended, and how to appeal.",
        },
        {
          heading: "Disclaimers and liability",
          blurb: "the site is community-run and provided as-is; jams are hosted on itch.io.",
        },
      ]}
    />
  );
}
