import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  AdminPager,
  AdminPerson,
  AdminRow,
  AdminSection,
  ReasonField,
} from "@/components/admin/AdminUI";
import { Toolbar } from "@/components/common/Toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Empty } from "@/components/ui/empty";
import { type FilterOption, FilterMenu, FilterToggle, SortMenu } from "@/components/ui/filter-menu";
import { SearchField } from "@/components/ui/search-field";
import { Skeleton } from "@/components/ui/skeleton";
import { MicroLabel, Text } from "@/components/ui/typography";
import { PROJECT_TYPES } from "@/db/schema";
import { timeAgo } from "@/lib/format-time";
import { toastMutationError } from "@/lib/mutation-errors";
import { projectLinkParams, projectTypeLabel } from "@/lib/project-links";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";

type ListInput = Parameters<typeof client.listProjectsAdmin>[0];
type ProjectRow = Awaited<ReturnType<typeof client.listProjectsAdmin>>["items"][number];

const PAGE_SIZE = 10;

type Filters = {
  orphansOnly: boolean;
  source: NonNullable<ListInput["source"]>;
  visibility: NonNullable<ListInput["visibility"]>;
  type: NonNullable<ListInput["type"]>;
  creator: NonNullable<ListInput["creator"]>;
  sort: NonNullable<ListInput["sort"]>;
};

const DEFAULT_FILTERS: Filters = {
  orphansOnly: false,
  source: "all",
  visibility: "all",
  type: "all",
  creator: "all",
  sort: "newest",
};

const SORT_LABELS: Record<Filters["sort"], string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  updated: "Recently edited",
  title: "Title A–Z",
  credits: "Most credits",
};

/**
 * Every canonical project, unpublished and orphaned included — the pages
 * nothing else on the site lists. ORPHANS is the deleted-team leftover: a
 * manual row no placement points at, reachable by URL and by nothing else
 * until the lifecycle sweep collects it. Unpublish is staff; delete is
 * admin-only, and never for a synced row (the scraper would mint it again).
 */
export function AdminProjects({ isAdmin }: { isAdmin: boolean }) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  // Keyed by project so a reason typed in one dialog can't leak into the next.
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();

  const term = search.trim();
  const projects = useQuery(
    orpc.listProjectsAdmin.queryOptions({
      input: { ...(term ? { search: term } : {}), ...filters, page, pageSize: PAGE_SIZE },
    }),
  );
  const filtered = (Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]).some(
    (key) => filters[key] !== DEFAULT_FILTERS[key],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.listProjectsAdmin.key() });
  };

  const setPublished = useMutation({
    mutationFn: (input: { projectId: string; published: boolean; reason?: string }) =>
      client.setProjectPublished(input),
    onSuccess: (_result, input) => {
      toast.success(input.published ? "Project is public again." : "Project unpublished.");
      invalidate();
    },
    onError: toastMutationError("admin.project_set_published"),
  });
  const remove = useMutation({
    mutationFn: (input: { projectId: string; reason: string }) => client.deleteProject(input),
    onSuccess: () => {
      toast.success("Project deleted.");
      invalidate();
    },
    onError: toastMutationError("admin.project_delete"),
  });
  const busy = setPublished.isPending || remove.isPending;

  const items = projects.data?.items ?? [];
  const total = projects.data?.total ?? 0;

  const setFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };
  const patch = (next: Partial<Filters>) =>
    setFilter(() => setFilters((prev) => ({ ...prev, ...next })));

  return (
    <AdminSection
      title="Projects"
      count={projects.isPending ? undefined : total}
      hint="Every project page, unpublished included. An orphan is a row no profile or team showcase points at any more — what a deleted team leaves behind. Unpublishing hides the page from everyone but its editors; deleting is for rows nothing else needs."
    >
      <Toolbar
        search={
          <SearchField
            value={search}
            onChange={(next) => setFilter(() => setSearch(next))}
            placeholder="Title or handle — typos welcome…"
            containerClassName="w-full"
          />
        }
        controls={
          <>
            {filtered ? (
              <Button
                variant="ghost"
                size="xs"
                className="tracking-widest"
                onClick={() => setFilter(() => setFilters(DEFAULT_FILTERS))}
              >
                RESET
              </Button>
            ) : null}
            <SortMenu
              value={filters.sort}
              onChange={(sort) => patch({ sort: sort as Filters["sort"] })}
              options={(Object.keys(SORT_LABELS) as Filters["sort"][]).map((sort) => ({
                value: sort,
                label: SORT_LABELS[sort],
              }))}
            />
          </>
        }
      >
        <FilterMenu
          label="SOURCE"
          value={filters.source}
          onChange={(source) => patch({ source: source as Filters["source"] })}
          options={[
            { value: "all", label: "Any source" },
            { value: "itchio", label: "itch.io" },
            { value: "manual", label: "Added by hand" },
          ]}
        />
        <FilterMenu
          label="VISIBILITY"
          value={filters.visibility}
          onChange={(visibility) => patch({ visibility: visibility as Filters["visibility"] })}
          options={[
            { value: "all", label: "Any visibility" },
            { value: "published", label: "Published" },
            { value: "unpublished", label: "Unpublished" },
          ]}
        />
        <FilterMenu
          label="KIND"
          value={filters.type}
          onChange={(type) => patch({ type: type as Filters["type"] })}
          options={[
            { value: "all", label: "Any kind" },
            ...PROJECT_TYPES.map(
              (type): FilterOption => ({ value: type, label: projectTypeLabel({ type }) }),
            ),
          ]}
        />
        <FilterMenu
          label="CREATOR"
          value={filters.creator}
          onChange={(creator) => patch({ creator: creator as Filters["creator"] })}
          options={[
            { value: "all", label: "Any creator" },
            { value: "member", label: "A member" },
            { value: "none", label: "Nobody (scraped)" },
          ]}
        />
        <FilterToggle
          label="ORPHANS ONLY"
          pressed={filters.orphansOnly}
          onPressedChange={(on) => patch({ orphansOnly: on })}
        />
      </Toolbar>

      <AdminPager
        page={page}
        pageCount={projects.data?.pageCount ?? 1}
        total={total}
        pageSize={PAGE_SIZE}
        unit="projects"
        onPage={setPage}
      />

      {projects.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : items.length === 0 ? (
        <Empty>{term || filtered ? "No projects match that." : "No project pages yet."}</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((project) => (
            <ProjectAdminRow
              key={project.id}
              project={project}
              isAdmin={isAdmin}
              busy={busy}
              reason={reasons[project.id] ?? ""}
              onReason={(next) => setReasons((prev) => ({ ...prev, [project.id]: next }))}
              onSetPublished={(published, reason) =>
                setPublished.mutateAsync({
                  projectId: project.id,
                  published,
                  ...(reason ? { reason } : {}),
                })
              }
              onDelete={(reason) => remove.mutateAsync({ projectId: project.id, reason })}
            />
          ))}
        </div>
      )}
    </AdminSection>
  );
}

function ProjectAdminRow({
  project,
  isAdmin,
  busy,
  reason,
  onReason,
  onSetPublished,
  onDelete,
}: {
  project: ProjectRow;
  isAdmin: boolean;
  busy: boolean;
  reason: string;
  onReason: (next: string) => void;
  onSetPublished: (published: boolean, reason?: string) => Promise<unknown>;
  onDelete: (reason: string) => Promise<unknown>;
}) {
  const synced = project.source === "itchio" && project.sourceGameId != null;
  const trimmed = reason.trim();

  return (
    <AdminRow muted={!project.published}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/projects/$projectSlug"
              params={projectLinkParams(project)}
              className="text-sm font-medium text-primary hover:underline"
            >
              {project.title}
            </Link>
            <MicroLabel as="span">/{project.slug}</MicroLabel>
            <Badge size="label" variant="secondary">
              {projectTypeLabel(project)}
            </Badge>
            {synced ? (
              <Badge size="label" variant="outline">
                ITCH.IO
              </Badge>
            ) : null}
            {!project.published ? (
              <Badge size="label" variant="outline">
                UNPUBLISHED
              </Badge>
            ) : null}
            {!project.anchored ? (
              <Badge size="label" variant="destructive">
                ORPHAN
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AdminPerson
              user={project.creator}
              name={project.creator?.displayName ?? "No creator"}
              size={20}
            />
            <Text as="span" size="xs" variant="muted">
              · added {timeAgo(project.createdAt)} · {project.contributorCount}{" "}
              {project.contributorCount === 1 ? "credit" : "credits"}
            </Text>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {project.published ? (
            <Confirm
              title={`Unpublish “${project.title}”?`}
              message={
                <>
                  The page stays up for the people credited on it and disappears for everyone else.
                  <ReasonField
                    id={`project-unpublish-reason-${project.id}`}
                    value={reason}
                    onChange={onReason}
                    required
                  />
                </>
              }
              confirmText="Unpublish project"
              variant="destructive"
              confirmDisabled={trimmed.length === 0}
              onConfirm={async () => {
                await onSetPublished(false, trimmed);
                onReason("");
              }}
            >
              <Button variant="outline" size="xs" disabled={busy}>
                Unpublish
              </Button>
            </Confirm>
          ) : (
            <Confirm
              title={`Publish “${project.title}”?`}
              message="The project page is public again for everyone."
              confirmText="Publish project"
              onConfirm={async () => {
                await onSetPublished(true);
              }}
            >
              <Button variant="outline" size="xs" disabled={busy}>
                Publish
              </Button>
            </Confirm>
          )}

          {isAdmin && !synced ? (
            <Confirm
              title={`Delete “${project.title}”?`}
              message={
                <>
                  The page, its credits, jam links and team claims are gone for good, and the handle
                  is free again. Showcase entries that pointed at it stay on their pages, unlinked.
                  <ReasonField
                    id={`project-delete-reason-${project.id}`}
                    value={reason}
                    onChange={onReason}
                    required
                  />
                </>
              }
              confirmText="Delete project"
              variant="destructive"
              confirmDisabled={trimmed.length === 0}
              onConfirm={async () => {
                await onDelete(trimmed);
                onReason("");
              }}
            >
              <Button variant="destructive" size="xs" disabled={busy}>
                Delete
              </Button>
            </Confirm>
          ) : null}
        </div>
      </div>
    </AdminRow>
  );
}
