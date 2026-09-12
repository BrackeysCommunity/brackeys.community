import {
  BookOpen01Icon,
  BubbleChatIcon,
  CheckListIcon,
  CubeIcon,
  EyeIcon,
  Flag02Icon,
  Image01Icon,
  ScrollIcon,
  StarIcon,
  UserBlock01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { z } from "zod";

import { AdminBans } from "@/components/admin/AdminBans";
import { AdminEntryFlags } from "@/components/admin/AdminEntryFlags";
import { AdminImageFlags } from "@/components/admin/AdminImageFlags";
import { AdminLog } from "@/components/admin/AdminLog";
import { AdminProjects } from "@/components/admin/AdminProjects";
import { AdminProposals } from "@/components/admin/AdminProposals";
import { AdminRecentComments } from "@/components/admin/AdminRecentComments";
import { AdminReportQueue } from "@/components/admin/AdminReportQueue";
import { AdminSpotlight, SPOTLIGHT_PANES } from "@/components/admin/AdminSpotlight";
import { AdminTaxonomy, TAXONOMY_PANES } from "@/components/admin/AdminTaxonomy";
import { AdminTeams } from "@/components/admin/AdminTeams";
import { AdminHero } from "@/components/admin/AdminUI";
import { Badge } from "@/components/ui/badge";
import { MicroLabel, Text } from "@/components/ui/typography";
import { useReducedMotion } from "@/lib/hooks/use-app-settings";
import { EASE_OUT } from "@/lib/motion";
import { pageTitle } from "@/lib/site-meta";
import { TOGGLE_CUE } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/orpc/client";

const SECTIONS = [
  "reports",
  "entry-flags",
  "image-flags",
  "proposals",
  "comments",
  "teams",
  "projects",
  "spotlight",
  "taxonomy",
  "bans",
  "log",
] as const;

type View = (typeof SECTIONS)[number];

// The four sections the rail used to list separately, folded two-and-two
// into `spotlight` and `taxonomy`. Old links keep landing on the right pane.
const LEGACY_SECTIONS: Record<string, { section: View; pane: Pane }> = {
  featured: { section: "spotlight", pane: "featured" },
  hero: { section: "spotlight", pane: "hero" },
  skills: { section: "taxonomy", pane: "skills" },
  vocab: { section: "taxonomy", pane: "roles" },
};

const PANES = [...SPOTLIGHT_PANES, ...TAXONOMY_PANES] as const;
type Pane = (typeof PANES)[number];

// Named `section` / `pane` rather than `view` / `tab` so they don't widen
// the router-wide search union that /notifications' `view` and /settings'
// `tab` narrow against.
const searchSchema = z.preprocess(
  (raw) => {
    const input = (raw ?? {}) as { section?: unknown; pane?: unknown };
    const legacy = typeof input.section === "string" ? LEGACY_SECTIONS[input.section] : undefined;
    return legacy ? { ...input, ...legacy } : input;
  },
  z.object({
    section: z.enum(SECTIONS).default("reports"),
    pane: z.enum(PANES).optional(),
  }),
);

const SECTION_META: Record<View, { label: string; hint: string; icon: IconSvgElement }> = {
  reports: { label: "Reports", hint: "Flagged posts, comments, teams", icon: Flag02Icon },
  "entry-flags": { label: "Entry flags", hint: "Scanner detections to review", icon: EyeIcon },
  "image-flags": { label: "Upload flags", hint: "Flagged member uploads", icon: Image01Icon },
  proposals: { label: "Proposals", hint: "Mod edits awaiting an admin", icon: CheckListIcon },
  comments: { label: "Comments", hint: "Newest across the site", icon: BubbleChatIcon },
  teams: { label: "Teams", hint: "Directory, hide, delete", icon: UserGroupIcon },
  projects: { label: "Projects", hint: "Directory, orphans, unpublish", icon: CubeIcon },
  spotlight: { label: "Spotlight", hint: "Board featured, home hero", icon: StarIcon },
  taxonomy: { label: "Taxonomy", hint: "Skills, requests, collab roles", icon: BookOpen01Icon },
  bans: { label: "Bans", hint: "Active, history", icon: UserBlock01Icon },
  log: { label: "Log", hint: "Every staff action", icon: ScrollIcon },
};

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
  head: () => ({ meta: [{ title: pageTitle("Admin") }] }),
});

/**
 * Badge counts for the nav. Each query is keyed identically to the one
 * its section runs, so opening that section is a cache hit rather than a
 * second round trip.
 */
function useQueueCounts(): Partial<Record<View, number>> {
  const commentReports = useQuery(
    orpc.listCommentReports.queryOptions({ input: { includeResolved: false } }),
  );
  const postReports = useQuery(
    orpc.listReports.queryOptions({ input: { includeResolved: false } }),
  );
  const teamReports = useQuery(
    orpc.listTeamReports.queryOptions({ input: { includeResolved: false } }),
  );
  const skillRequests = useQuery(
    orpc.listSkillRequests.queryOptions({ input: { status: "pending", page: 1, pageSize: 10 } }),
  );
  const pendingProposals = useQuery(
    orpc.listModerationProposals.queryOptions({
      input: { status: "pending", page: 1, pageSize: 10 },
    }),
  );
  const entryFlags = useQuery(
    orpc.listEntryFlags.queryOptions({
      input: { includeResolved: false, jamScope: "live", page: 1, pageSize: 20 },
    }),
  );
  const imageFlags = useQuery(
    orpc.listImageFlags.queryOptions({
      input: { includeResolved: false, page: 1, pageSize: 20 },
    }),
  );

  const open =
    (commentReports.data?.filter((r) => r.resolvedAt == null).length ?? 0) +
    (postReports.data?.filter((r) => r.resolvedAt == null).length ?? 0) +
    (teamReports.data?.filter((r) => r.resolvedAt == null).length ?? 0);

  return {
    reports: open,
    "entry-flags": entryFlags.data?.flagCount ?? 0,
    "image-flags": imageFlags.data?.total ?? 0,
    proposals: pendingProposals.data?.total ?? 0,
    taxonomy: skillRequests.data?.total ?? 0,
  };
}

function AdminRoute() {
  const { isAdmin } = Route.useLoaderData();
  const { section, pane } = Route.useSearch();
  const counts = useQueueCounts();
  const navigate = useNavigate({ from: Route.fullPath });
  const setPane = (next: Pane) =>
    void navigate({ search: { section, pane: next }, replace: true, viewTransition: false });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-6">
      <AdminHero
        isAdmin={isAdmin}
        stats={[
          { label: "Open reports", value: counts.reports ?? 0 },
          { label: "Pending proposals", value: counts.proposals ?? 0 },
          { label: "Skill requests", value: counts.taxonomy ?? 0 },
        ]}
      />

      {/* Same shape as /settings: a rail beside the pane from `lg` up, a
          scrolling tab strip below it. One nav either way — the active
          marker is the same element, re-anchored from the bottom edge to
          the rail's right edge. */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[14rem_1fr] lg:items-start lg:gap-10">
        <AdminNav section={section} counts={counts} />
        <AdminPane
          section={section}
          pane={pane}
          onPane={setPane}
          isAdmin={isAdmin}
          skillRequestCount={counts.taxonomy ?? 0}
        />
      </div>
    </div>
  );
}

function AdminNav({ section, counts }: { section: View; counts: Partial<Record<View, number>> }) {
  return (
    <nav
      aria-label="Admin sections"
      // The rail has outgrown a laptop viewport, so from `lg` it scrolls on
      // its own inside the sticky box rather than pushing the page — the
      // pane beside it keeps its scroll position either way.
      className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto border-b border-muted/30 px-1 lg:sticky lg:top-4 lg:mx-0 lg:max-h-[calc(100vh-2rem)] lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-0 lg:pr-2"
    >
      {SECTIONS.map((id) => {
        const meta = SECTION_META[id];
        // Every row links to /admin, so the router calls them all active —
        // the search param is what distinguishes them.
        const isActive = id === section;
        const count = counts[id] ?? 0;
        return (
          <Link
            key={id}
            to="/admin"
            search={{ section: id, pane: undefined }}
            replace
            // Moving between sections only changes the pane — it animates
            // itself in `AdminPane`, and everything around it holds still.
            viewTransition={false}
            {...TOGGLE_CUE}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative flex items-center gap-2.5 rounded-t px-3 py-3 whitespace-nowrap transition-colors lg:rounded lg:rounded-l-none lg:pl-4",
              isActive
                ? "text-foreground lg:bg-muted/25"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <HugeiconsIcon icon={meta.icon} size={16} />
            <span className="flex flex-col items-start gap-0.5">
              <span className="flex items-center gap-1.5">
                <MicroLabel as="span" variant="inherit" className="uppercase">
                  {meta.label}
                </MicroLabel>
                {count > 0 && (
                  <Badge size="label" variant={isActive ? "default" : "secondary"}>
                    {count}
                  </Badge>
                )}
              </span>
              <Text as="span" size="xs" variant="muted" className="hidden lg:block">
                {meta.hint}
              </Text>
            </span>
            {isActive ? (
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary lg:inset-x-auto lg:inset-y-1 lg:left-0 lg:h-auto lg:w-0.5"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** The swapping half. Keyed on the section so React tears the old pane
 * down and the new one animates in on its own — entry-only, like the
 * settings pane. */
function AdminPane({
  section,
  pane,
  onPane,
  isAdmin,
  skillRequestCount,
}: {
  section: View;
  pane: Pane | undefined;
  onPane: (next: Pane) => void;
  isAdmin: boolean;
  skillRequestCount: number;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      key={section}
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: EASE_OUT }}
      className="flex min-w-0 flex-col gap-8"
    >
      {section === "reports" && <AdminReportQueue isAdmin={isAdmin} />}
      {section === "entry-flags" && <AdminEntryFlags />}
      {section === "image-flags" && <AdminImageFlags />}
      {section === "proposals" && <AdminProposals isAdmin={isAdmin} />}
      {section === "comments" && <AdminRecentComments />}
      {section === "teams" && <AdminTeams isAdmin={isAdmin} />}
      {section === "projects" && <AdminProjects isAdmin={isAdmin} />}
      {section === "spotlight" && (
        <AdminSpotlight pane={pane === "hero" ? "hero" : "featured"} onPane={onPane} />
      )}
      {section === "taxonomy" && (
        <AdminTaxonomy
          pane={pane === "roles" ? "roles" : "skills"}
          onPane={onPane}
          isAdmin={isAdmin}
          skillRequestCount={skillRequestCount}
        />
      )}
      {section === "bans" && <AdminBans isAdmin={isAdmin} />}
      {section === "log" && <AdminLog />}
    </motion.div>
  );
}
