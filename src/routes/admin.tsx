import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { z } from "zod";

import { AdminBans } from "@/components/admin/AdminBans";
import { AdminFeatured } from "@/components/admin/AdminFeatured";
import { AdminRecentComments } from "@/components/admin/AdminRecentComments";
import { AdminReportQueue } from "@/components/admin/AdminReportQueue";
import { AdminSkills } from "@/components/admin/AdminSkills";
import { AdminHero } from "@/components/admin/AdminUI";
import { AdminVocabulary } from "@/components/admin/AdminVocabulary";
import { useAnimatedUnderline } from "@/components/profile/ProfilePage/useAnimatedUnderline";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/orpc/client";

// Named `section` rather than `view` so it doesn't widen the router-wide
// search union that /notifications' own `view` param narrows against.
const searchSchema = z.object({
  section: z
    .enum(["reports", "comments", "featured", "skills", "vocab", "bans"])
    .default("reports"),
});

type View = z.infer<typeof searchSchema>["section"];

const TABS: { key: View; label: string }[] = [
  { key: "reports", label: "Reports" },
  { key: "comments", label: "Comments" },
  { key: "featured", label: "Featured" },
  { key: "skills", label: "Skills" },
  { key: "vocab", label: "Vocabulary" },
  { key: "bans", label: "Bans" },
];

const TAB_IDS = TABS.map((t) => t.key);

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
  const { containerRef, registerTab, motionStyle } = useAnimatedUnderline({
    active: section,
    tabIds: TAB_IDS,
  });

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

      {/* Same animated-underline strip as the create-post wizard and the
          profile flyout. The bar is one element pinned to the strip's
          bottom, so a tab carrying a count badge can't drag its own
          underline out of line with the rest.
          The scroll box is the outer div: an absolutely-positioned child
          of a scrolling container measures against a box that moves under
          it, which would desync the bar once the tabs overflow. */}
      <div className="overflow-x-auto border-b border-muted/30">
        <div ref={containerRef} className="relative flex w-max min-w-full items-stretch gap-1">
          {TABS.map((tab) => {
            const active = section === tab.key;
            const count = counts[tab.key] ?? 0;
            return (
              <button
                key={tab.key}
                ref={registerTab(tab.key)}
                type="button"
                onClick={() => setView(tab.key)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex cursor-pointer items-center gap-1.5 px-3 py-3 font-mono text-[10px] tracking-widest whitespace-nowrap uppercase transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
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
          <motion.span
            aria-hidden
            style={motionStyle}
            className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-primary"
          />
        </div>
      </div>

      {section === "reports" && <AdminReportQueue isAdmin={isAdmin} />}
      {section === "comments" && <AdminRecentComments />}
      {section === "featured" && <AdminFeatured />}
      {section === "skills" && <AdminSkills isAdmin={isAdmin} />}
      {section === "vocab" && <AdminVocabulary isAdmin={isAdmin} />}
      {section === "bans" && <AdminBans isAdmin={isAdmin} />}
    </div>
  );
}
