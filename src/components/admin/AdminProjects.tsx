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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Confirm } from "@/components/ui/confirm";
import { Empty } from "@/components/ui/empty";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <SearchField
            value={search}
            onChange={(next) => setFilter(() => setSearch(next))}
            placeholder="Title or handle — typos welcome…"
            containerClassName="min-w-56 flex-1"
          />
          <label htmlFor="admin-projects-orphans-only" className="flex items-center gap-2">
            <Checkbox
              id="admin-projects-orphans-only"
              checked={filters.orphansOnly}
              onCheckedChange={(checked) => patch({ orphansOnly: !!checked })}
            />
            <MicroLabel as="span">ORPHANS ONLY</MicroLabel>
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect
            id="admin-projects-source"
            label="Source"
            value={filters.source}
            onChange={(source) => patch({ source: source as Filters["source"] })}
            options={[
              ["all", "Any"],
              ["itchio", "itch.io"],
              ["manual", "Added by hand"],
            ]}
          />
          <FilterSelect
            id="admin-projects-visibility"
            label="Visibility"
            value={filters.visibility}
            onChange={(visibility) => patch({ visibility: visibility as Filters["visibility"] })}
            options={[
              ["all", "Any"],
              ["published", "Published"],
              ["unpublished", "Unpublished"],
            ]}
          />
          <FilterSelect
            id="admin-projects-type"
            label="Kind"
            value={filters.type}
            onChange={(type) => patch({ type: type as Filters["type"] })}
            options={[
              ["all", "Any"],
              ...PROJECT_TYPES.map((type): [string, string] => [type, projectTypeLabel({ type })]),
            ]}
          />
          <FilterSelect
            id="admin-projects-creator"
            label="Creator"
            value={filters.creator}
            onChange={(creator) => patch({ creator: creator as Filters["creator"] })}
            options={[
              ["all", "Any"],
              ["member", "A member"],
              ["none", "Nobody (scraped)"],
            ]}
          />
          <FilterSelect
            id="admin-projects-sort"
            label="Sort"
            value={filters.sort}
            onChange={(sort) => patch({ sort: sort as Filters["sort"] })}
            options={(Object.keys(SORT_LABELS) as Filters["sort"][]).map((sort) => [
              sort,
              SORT_LABELS[sort],
            ])}
          />
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
        </div>
      </div>

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
                  A reason is required.
                  <ReasonField
                    id={`project-unpublish-reason-${project.id}`}
                    value={reason}
                    onChange={onReason}
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
                  A reason is required.
                  <ReasonField
                    id={`project-delete-reason-${project.id}`}
                    value={reason}
                    onChange={onReason}
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

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [value: string, label: string][];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>
        <MicroLabel as="span">{label.toUpperCase()}</MicroLabel>
      </label>
      <NativeSelect id={id} size="sm" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <NativeSelectOption key={optionValue} value={optionValue}>
            {optionLabel}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
