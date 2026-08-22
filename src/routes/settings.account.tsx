import { createFileRoute } from "@tanstack/react-router";

import { AccountSection } from "@/components/settings/AccountSection";
import { pageTitle } from "@/lib/site-meta";

export const Route = createFileRoute("/settings/account")({
  component: AccountSection,
  head: () => ({ meta: [{ title: pageTitle("Account · Settings") }] }),
});
