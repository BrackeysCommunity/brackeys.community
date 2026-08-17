import { createFileRoute } from "@tanstack/react-router";

import { AccountSection } from "@/components/settings/AccountSection";

export const Route = createFileRoute("/settings/account")({
  component: AccountSection,
  head: () => ({ meta: [{ title: "Account · Settings · Brackeys Community" }] }),
});
