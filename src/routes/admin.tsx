import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { AdminBans } from "@/components/admin/AdminBans";
import { AdminFeatured } from "@/components/admin/AdminFeatured";
import { AdminHeroJam } from "@/components/admin/AdminHeroJam";
import { AdminLog } from "@/components/admin/AdminLog";
import { AdminRecentComments } from "@/components/admin/AdminRecentComments";
import { AdminReportQueue } from "@/components/admin/AdminReportQueue";
import { AdminSkills } from "@/components/admin/AdminSkills";
import { AdminHero } from "@/components/admin/AdminUI";
import { AdminVocabulary } from "@/components/admin/AdminVocabulary";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { client, orpc } from "@/orpc/client";

// Named `section` rather than `view` so it doesn't widen the router-wide
// search union that /notifications' own `view` param narrows against.
const searchSchema = z.object({
  section: z
    .enum(["reports", "comments", "featured", "hero", "skills", "vocab", "bans", "log"])
    .default("reports"),
});

type View = z.infer<typeof searchSchema>["section"];

const TABS: { key: View; label: string }[] = [
  { key: "reports", label: "Reports" },
  { key: "comments", label: "Comments" },
  { key: "featured", label: "Featured" },
  { key: "hero", label: "Hero jam" },
  { key: "skills", label: "Skills" },
  { key: "vocab", label: "Vocabulary" },
  { key: "bans", label: "Bans" },
  { key: "log", label: "Log" },
];

/**
 * The staff surface. Linked from the user menu for staff only; everyone else
 * (and any error in the staff lookup) gets a 404, never a 500, so the page's
 * existence leaks nothing and a bug can't lock staff tooling into an error
 * screen loop. The real gate is on every procedure this page calls — both
 * this check and the menu item are UX.
 */
export const Route = createFileRoute("/admin")({
  validateSearch: searchSchema,
  loader: async () => {
    let status: { isStaff: boolean; isAdmin: boolean };
    try {
      status = await client.getStaffStatus();
    } catch {
      throw notFound();
    }
    if (!status.isStaff) throw notFound();
    return { isAdmin: status.isAdmin };
  },
  component: AdminRoute,
  head: () => ({ meta: [{ title: "Admin · Brackeys Community" }] }),
});

/**
 * Badge counts for the tab bar. Each query is keyed identically to the one
 * its section runs, so opening that tab is a cache hit rather than a second
 * round trip.
 */
function useQueueCounts(): Partial<Record<View, number>> {
  const commentReports = useQuery(
    orpc.listCommentReports.queryOptions({ input: { includeResolved: false } }),
  );
  const postReports = useQuery(
    orpc.listReports.queryOptions({ input: { includeResolved: false } }),
  );
  const skillRequests = useQuery(
    orpc.listSkillRequests.queryOptions({ input: { status: "pending", page: 1, pageSize: 10 } }),
  );

  const open =
    (commentReports.data?.filter((r) => r.resolvedAt == null).length ?? 0) +
    (postReports.data?.filter((r) => r.resolvedAt == null).length ?? 0);

  return {
    reports: open,
    skills: skillRequests.data?.total ?? 0,
  };
}

function AdminRoute() {
  const { isAdmin } = Route.useLoaderData();
  const { section } = Route.useSearch();
  const navigate = useNavigate();
  const counts = useQueueCounts();

  const setView = (next: View) =>
    navigate({
      to: "/admin",
      search: { section: next },
      replace: true,
    });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-6">
      <AdminHero
        isAdmin={isAdmin}
        stats={[
          { label: "Open reports", value: counts.reports ?? 0 },
          { label: "Skill requests", value: counts.skills ?? 0 },
        ]}
      />

      <UnderlineTabs
        tabs={TABS.map((tab) => ({ ...tab, count: counts[tab.key] }))}
        active={section}
        label="Admin section"
        onSelect={setView}
      />

      {section === "reports" && <AdminReportQueue isAdmin={isAdmin} />}
      {section === "comments" && <AdminRecentComments />}
      {section === "featured" && <AdminFeatured />}
      {section === "hero" && <AdminHeroJam />}
      {section === "skills" && <AdminSkills isAdmin={isAdmin} />}
      {section === "vocab" && <AdminVocabulary isAdmin={isAdmin} />}
      {section === "bans" && <AdminBans isAdmin={isAdmin} />}
      {section === "log" && <AdminLog />}
    </div>
  );
}
