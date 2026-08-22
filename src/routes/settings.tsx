import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { SETTINGS_TAB_META, SETTINGS_TABS } from "@/components/settings/settings-tabs";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { pageTitle } from "@/lib/site-meta";

// Sections are child routes now, but `/settings?tab=x` links are already out
// in emails and bookmarks — keep them landing on the pane they named.
const searchSchema = z.object({
  tab: z.enum(SETTINGS_TABS).optional(),
});

export const Route = createFileRoute("/settings")({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => {
    if (search.tab) throw redirect({ to: SETTINGS_TAB_META[search.tab].to, replace: true });
  },
  component: SettingsLayout,
  head: () => ({ meta: [{ title: pageTitle("Settings") }] }),
});
