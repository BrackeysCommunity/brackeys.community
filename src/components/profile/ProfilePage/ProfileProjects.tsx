import { ArrowUpRight01Icon, Delete02Icon, Edit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { type ManualProfileProjectType, type ProfileProjectSubType } from "@/lib/profile-projects";
import { cn } from "@/lib/utils";
import { client } from "@/orpc/client";

import { AddProjectDialog, type ProjectInitial } from "./AddProjectDialog";
import { GradientBanner } from "./GradientBanner";
import type { EditableProject, ProfileProject, ProjectKind } from "./helpers";
import { ProfileEmptyState } from "./ProfileEmptyState";
import { AddSectionAction, ProfileSectionHeader } from "./ProfileSectionHeader";

interface ProfileProjectsSectionProps {
  index: string;
  /** Section heading — defaults to SHIPPED WORK to match the
   * capsule-grid treatment; pass "PROJECTS" etc. on other surfaces. */
  title?: string;
  projects: ProfileProject[];
  /** Owner-side raw rows used by the inline editor — same data, but
   * shaped for the edit dialog flow. */
  editableProjects?: EditableProject[];
  isOwner: boolean;
  /** Optional fallback edit handler — used in non-owner contexts
   * where deep-linking somewhere else (e.g. the flyout) is wanted.
   * Owner mode handles its own add/edit/remove via mutations. */
  onEdit?: () => void;
  /** "+ ADD" lives next to the section header on this surface. */
  showAddAction?: boolean;
  /** Stack as a single column with full-width banners (mobile) vs.
   * the responsive capsule grid the desktop uses. */
  layout?: "grid" | "list";
  /** Query key for the underlying `getProfile` fetch — invalidated
   * after every owner mutation so the section re-renders with the
   * persisted data. */
  queryKey?: readonly unknown[];
}

/**
 * `§NN SHIPPED WORK` — itch-style capsule grid. Each card leads with
 * banner art (uploaded image, or the seeded striped-gradient capsule
 * with the title set over it), then title, jam/year sub-line, tags,
 * and an "entry note" box when the project carries a description.
 * Owners get edit/delete controls overlaid on each banner.
 */
export function ProfileProjectsSection({
  index,
  title = "SHIPPED WORK",
  projects,
  editableProjects,
  isOwner,
  onEdit,
  showAddAction = true,
  layout = "grid",
  queryKey,
}: ProfileProjectsSectionProps) {
  const ownerEdits = isOwner;
  const [showAdder, setShowAdder] = useState(false);
  // When non-null the edit dialog is open with this project's data.
  const [editing, setEditing] = useState<EditableProject | null>(null);

  const qc = useQueryClient();
  const invalidate = () => {
    if (queryKey) void qc.invalidateQueries({ queryKey });
  };

  const addProject = useMutation({
    mutationFn: (data: Parameters<typeof client.addProject>[0]) => client.addProject(data),
    onSuccess: () => {
      invalidate();
      toast.success("Project added");
      setShowAdder(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to add project"),
  });
  const updateProject = useMutation({
    mutationFn: (data: Parameters<typeof client.updateProject>[0]) => client.updateProject(data),
    onSuccess: () => {
      invalidate();
      toast.success("Project updated");
      setEditing(null);
    },
    onError: () => toast.error("Failed to update project"),
  });
  const removeProject = useMutation({
    mutationFn: (projectId: string) => client.removeProject({ projectId }),
    onSuccess: () => {
      invalidate();
      toast.success("Project removed");
    },
    onError: () => toast.error("Failed to remove project"),
  });

  const handleAddClick = () => {
    if (ownerEdits) setShowAdder(true);
    else onEdit?.();
  };

  return (
    <section className="flex flex-col gap-3">
      <ProfileSectionHeader
        index={index}
        title={title}
        action={isOwner && showAddAction ? <AddSectionAction onAdd={handleAddClick} /> : null}
      />
      {ownerEdits ? (
        <OwnerProjectsBody
          editableProjects={editableProjects ?? []}
          layout={layout}
          onAddClick={() => setShowAdder(true)}
          onEditClick={(p) => setEditing(p)}
          onRemoveClick={(id) => removeProject.mutate(id)}
        />
      ) : projects.length === 0 ? (
        <ProfileEmptyState
          glyph="▢"
          title="No projects yet"
          hint="Drop a tool, game, or experiment so collaborators can see what you ship."
        />
      ) : (
        <div className={cn("grid gap-4", gridClass(layout))}>
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
      {ownerEdits ? (
        <>
          <AddProjectDialog
            open={showAdder}
            onOpenChange={setShowAdder}
            onAdd={(data) => addProject.mutate(data)}
          />
          <AddProjectDialog
            open={editing != null}
            onOpenChange={(next) => {
              if (!next) setEditing(null);
            }}
            onAdd={(data) => addProject.mutate(data)}
            initial={editing ? editableToInitial(editing) : undefined}
            onSave={(data) => {
              if (!editing) return;
              // `client.updateProject` accepts a partial — we always
              // send the full payload anyway so the back-end can
              // diff if it wants to.
              updateProject.mutate({ projectId: editing.id, ...data });
            }}
          />
        </>
      ) : null}
    </section>
  );
}

function gridClass(layout: "grid" | "list"): string {
  return layout === "list" ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";
}

/** Translate the legacy `EditableProject` row shape into the dialog's
 * `initial` form. Anything that doesn't map cleanly to a manual
 * project type (e.g. `jam`, `web`, `writing`) gets normalised to
 * `game` so the type chips in the dialog don't sit in an
 * unrecognised state — those entries are sourced from the itch.io
 * importer and aren't intended to be edited via this dialog anyway. */
function editableToInitial(p: EditableProject): ProjectInitial {
  const manualType: ManualProfileProjectType =
    p.type === "audio" || p.type === "tool" || p.type === "app" || p.type === "game"
      ? p.type
      : "game";
  return {
    title: p.title,
    description: p.description,
    url: p.url,
    imageUrl: p.imageUrl,
    type: manualType,
    subTypes: (p.subTypes ?? []) as ProfileProjectSubType[],
  };
}

/**
 * Owner-side body — same capsule cards, plus edit/delete controls
 * floated in each banner's top-left corner. Empty state CTA opens
 * the add dialog.
 */
function OwnerProjectsBody({
  editableProjects,
  layout,
  onAddClick,
  onEditClick,
  onRemoveClick,
}: {
  editableProjects: EditableProject[];
  layout: "grid" | "list";
  onAddClick: () => void;
  onEditClick: (project: EditableProject) => void;
  onRemoveClick: (id: string) => void;
}) {
  if (editableProjects.length === 0) {
    return (
      <ProfileEmptyState
        glyph="▢"
        title="No projects yet"
        hint="Drop a tool, game, or experiment so collaborators can see what you ship."
        cta={{ label: "+ ADD PROJECT", onClick: onAddClick }}
      />
    );
  }
  return (
    <div className={cn("grid gap-4", gridClass(layout))}>
      {editableProjects.map((project) => (
        <ProjectCard
          key={project.id}
          project={editableToDisplay(project)}
          ownerControls={
            <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-xs"
                aria-label={`Edit ${project.title}`}
                onClick={() => onEditClick(project)}
              >
                <HugeiconsIcon icon={Edit02Icon} size={12} />
              </Button>
              <Button
                variant="outline"
                size="icon-xs"
                aria-label={`Remove ${project.title}`}
                onClick={() => {
                  if (window.confirm(`Remove "${project.title}"? This can't be undone.`))
                    onRemoveClick(project.id);
                }}
                className="text-muted-foreground hover:text-destructive"
              >
                <HugeiconsIcon icon={Delete02Icon} size={12} />
              </Button>
            </div>
          }
        />
      ))}
    </div>
  );
}

/** Map an `EditableProject` row into the same shape the read-only
 * `ProjectCard` consumes — keeps the visual treatment identical
 * across owner / non-owner views. */
function editableToDisplay(p: EditableProject): ProfileProject {
  const kind = (p.type as ProjectKind) ?? "other";
  const year = (p.participatedAt ?? p.publishedAt ?? new Date()).getUTCFullYear();
  return {
    id: p.id,
    title: p.submissionTitle ?? p.title,
    kind,
    year,
    shortDescription: p.description,
    bannerUrl: p.imageUrl,
    url: p.submissionUrl ?? p.url,
    tags: (p.subTypes ?? []).slice(0, 4),
    jamName: p.jamName,
    jamPlacement: p.result ?? null,
  };
}

/**
 * The capsule card. Banner art up top (image, or seeded gradient with
 * the title set over it in letterspaced caps), placement chip in the
 * banner corner, then the text stack: title → jam/year sub-line →
 * tags → optional entry-note box.
 *
 * When `ownerControls` is present the card drops its stretched
 * click-through anchor so the corner buttons stay reliably tappable;
 * the URL stays reachable via the OPEN chip.
 */
function ProjectCard({
  project,
  ownerControls,
}: {
  project: ProfileProject;
  ownerControls?: React.ReactNode;
}) {
  const clickThrough = !ownerControls && project.url;
  return (
    <Well className="group relative gap-2 p-3 transition-colors hover:bg-card">
      <div className="relative aspect-[16/7] w-full overflow-hidden rounded bg-muted/40">
        {project.bannerUrl ? (
          <img
            src={project.bannerUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <GradientBanner seed={project.id} className="absolute inset-0 flex">
            <span
              aria-hidden
              className="relative m-auto line-clamp-2 px-4 text-center font-mono text-sm font-bold tracking-[0.25em] text-white/90 uppercase [text-shadow:0_1px_2px_rgba(0,0,0,0.3)]"
            >
              {project.title}
            </span>
          </GradientBanner>
        )}
        {project.jamPlacement ? (
          <Badge
            variant="warning"
            className="absolute top-2 right-2 z-10 font-mono text-[10px] tracking-widest uppercase"
          >
            {project.jamPlacement}
          </Badge>
        ) : null}
        {ownerControls}
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <Text bold size="lg" className="truncate leading-tight">
          {project.title}
        </Text>
        {project.url ? (
          <a
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${project.title}`}
            className="relative z-10 inline-flex shrink-0 items-center gap-1 font-mono text-xs tracking-widest text-muted-foreground uppercase transition-colors group-hover:text-foreground hover:text-foreground"
          >
            OPEN
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} />
          </a>
        ) : null}
      </div>

      <Text size="xs" variant="muted" className="tracking-widest uppercase">
        {[project.jamName ?? project.kind, project.year].join(" · ")}
      </Text>

      {project.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {project.tags.map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className="font-mono text-[10px] tracking-widest uppercase"
            >
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}

      {project.shortDescription ? (
        <div className="rounded border border-muted/40 bg-muted/10 px-2.5 py-2">
          <Text size="sm" variant="muted" className="line-clamp-3">
            {project.jamName ? (
              <span className="font-medium text-foreground/80">Entry note: </span>
            ) : null}
            {project.shortDescription}
          </Text>
        </div>
      ) : null}

      {/* Stretched link makes the entire card clickable in read-only
          mode; the explicit OPEN chip sits above it (z-10) so both
          paths work. */}
      {clickThrough ? (
        <a
          href={project.url ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${project.title}`}
          className="absolute inset-0 z-0 rounded focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
        />
      ) : null}
    </Well>
  );
}
