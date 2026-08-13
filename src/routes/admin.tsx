import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { AdminBans } from "@/components/admin/AdminBans";
import { AdminRecentComments } from "@/components/admin/AdminRecentComments";
import { AdminReportQueue } from "@/components/admin/AdminReportQueue";
import { AdminSkills } from "@/components/admin/AdminSkills";
import { AdminHero } from "@/components/admin/AdminUI";
import { AdminVocabulary } from "@/components/admin/AdminVocabulary";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/orpc/client";

// Named `section` rather than `view` so it doesn't widen the router-wide
// search union that /notifications' own `view` param narrows against.
const searchSchema = z.object({
  section: z.enum(["reports", "comments", "skills", "vocab", "bans"]).default("reports"),
});

type View = z.infer<typeof searchSchema>["section"];

const TABS: { key: View; label: string }[] = [
  { key: "reports", label: "Reports" },
  { key: "comments", label: "Comments" },
  { key: "skills", label: "Skills" },
  { key: "vocab", label: "Vocabulary" },
  { key: "bans", label: "Bans" },
];

/**
 * The staff surface. Deliberately not linked from any nav — staff bookmark
 * it; everyone else (and any error in the staff lookup) gets a 404, never a
 * 500, so the page's existence leaks nothing and a bug can't lock staff
 * tooling into an error screen loop. The real gate is on every procedure
 * this page calls — this check is UX.
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

      <div className="flex items-center gap-1 overflow-x-auto border-b border-border/60">
        {TABS.map((tab) => {
          const active = section === tab.key;
          const count = counts[tab.key] ?? 0;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setView(tab.key)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 font-mono text-[10px] tracking-widest whitespace-nowrap uppercase transition-colors",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {tab.label}
              {count > 0 && (
                <Badge size="label" variant={active ? "default" : "secondary"}>
                  {count}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {section === "reports" && <AdminReportQueue isAdmin={isAdmin} />}
      {section === "comments" && <AdminRecentComments />}
      {section === "skills" && <AdminSkills isAdmin={isAdmin} />}
      {section === "vocab" && <AdminVocabulary isAdmin={isAdmin} />}
      {section === "bans" && <AdminBans isAdmin={isAdmin} />}
    </div>
  );
}
