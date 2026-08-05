import { createFileRoute } from "@tanstack/react-router";

import { LegalPlaceholderPage } from "@/components/legal/LegalPlaceholderPage";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy Policy · Brackeys Community" }] }),
  component: PrivacyRoute,
});

function PrivacyRoute() {
  return (
    <LegalPlaceholderPage
      marker="§ Legal / Privacy"
      title="Privacy Policy"
      summary="What brackeys.community stores about you, where it comes from, who can see it, and how to get it deleted."
      outline={[
        {
          heading: "What we collect",
          blurb:
            "the profile you fill in, the posts you write, and the sign-in identity from Discord.",
        },
        {
          heading: "Linked accounts",
          blurb:
            "what we pull from GitHub and itch.io once you connect them, and how to unlink and purge it.",
        },
        {
          heading: "Public vs. private",
          blurb:
            "which fields appear on your public profile, in the member directory, and on the collab board.",
        },
        {
          heading: "Email and notifications",
          blurb: "what we send, and the one-click unsubscribe on every message.",
        },
        {
          heading: "Processors",
          blurb: "the hosting, database, and error-reporting services that touch your data.",
        },
        {
          heading: "Your rights",
          blurb: "export, correction, and deletion — including what deleting an account removes.",
        },
      ]}
    />
  );
}
