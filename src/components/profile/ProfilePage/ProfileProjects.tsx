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
import type { EditableProject, ProfileProject, ProjectKind } from "./helpers";
import { ProfileEmptyState } from "./ProfileEmptyState";
import { AddSectionAction, ProfileSectionHeader } from "./ProfileSectionHeader";

interface ProfileProjectsSectionProps {
  index: string;
  projects: ProfileProject[];
  /** Owner-side raw rows used by the inline editor — same data, but
   * shaped for `EditableProjectCard` (the legacy editor we lift
   * verbatim into this section). */
  editableProjects?: EditableProject[];
  isOwner: boolean;
  /** Optional fallback edit handler — used in non-owner contexts
   * where deep-linking somewhere else (e.g. the flyout) is wanted.
   * Owner mode handles its own add/edit/remove via mutations. */
  onEdit?: () => void;
  /** "+ ADD" lives next to the section header on this surface (the
   * desktop wireframe shows it). When false, edit-only entry points
   * still appear in the header. */
  showAddAction?: boolean;
  /** Stack as a single column with full-width banners (mobile) vs.
   * the 2-column grid the desktop uses. */
  layout?: "grid" | "list";
  /** Query key for the underlying `getProfile` fetch — invalidated
   * after every owner mutation so the section re-renders with the
   * persisted data. */
  queryKey?: readonly unknown[];
}

/**
 * `§NN PROJECTS` — collection of project cards. Owners see the
 * inline edit flow (re-uses the legacy `EditableProjectCard` +
 * `AddProjectForm` so we don't fork the project-management
 * implementation); other viewers get the read-only `ProjectCard`
 * grid.
 */
export function ProfileProjectsSection({
  index,
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
        title="PROJECTS"
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
        <div
          className={cn(
            "grid gap-4",
            layout === "list" ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2",
          )}
        >
          {projects.map((project, i) => (
            <ProjectCard key={project.id} project={project} index={i + 1} />
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
 * Owner-side body — renders the same `ProjectCard` design that
 * non-owner viewers see, plus a small edit/delete action overlay
 * in each card's top-right corner. Empty state CTA opens the add
 * dialog.
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
    <div
      className={cn("grid gap-4", layout === "list" ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}
    >
      {editableProjects.map((project, i) => (
        <OwnerProjectCard
          key={project.id}
          project={project}
          index={i + 1}
          onEdit={() => onEditClick(project)}
          onRemove={() => onRemoveClick(project.id)}
        />
      ))}
    </div>
  );
}

/** Owner-mode card. Renders the same visual `ProjectCard` design
 * that the read-only path uses, with edit + delete buttons floated
 * in the top-right corner of the banner. The card itself is no
 * longer click-through (no stretched anchor) so the corner controls
 * stay reliably tappable; the URL is exposed via the `OPEN ↗` chip
 * at the bottom-right of the meta row. */
function OwnerProjectCard({
  project,
  index,
  onEdit,
  onRemove,
}: {
  project: EditableProject;
  index: number;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const display: ProfileProject = editableToDisplay(project, index);
  const palette = paletteForId(project.id);
  return (
    <Well className="group relative gap-2 p-3 transition-colors hover:bg-card">
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded bg-muted/40">
        {display.bannerUrl ? (
          <img
            src={display.bannerUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div aria-hidden className={cn("absolute inset-0", palette.tint, palette.stripe)} />
        )}
        <div className="absolute top-2 left-2 z-10">
          <Badge variant="secondary" className="font-mono text-[10px] tracking-widest uppercase">
            {display.kind}
          </Badge>
        </div>
        <div className="absolute right-2 bottom-2 z-10">
          <Badge variant="secondary" className="font-mono text-[10px] tracking-widest uppercase">
            {display.year}
          </Badge>
        </div>
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-xs"
            aria-label={`Edit ${display.title}`}
            onClick={onEdit}
          >
            <HugeiconsIcon icon={Edit02Icon} size={12} />
          </Button>
          <Button
            variant="outline"
            size="icon-xs"
            aria-label={`Remove ${display.title}`}
            onClick={() => {
              if (window.confirm(`Remove "${display.title}"? This can't be undone.`)) onRemove();
            }}
            className="text-muted-foreground hover:text-destructive"
          >
            <HugeiconsIcon icon={Delete02Icon} size={12} />
          </Button>
        </div>
      </div>
      <Text bold size="lg" className="leading-tight">
        {display.title}
      </Text>
      {display.shortDescription ? (
        <Text size="sm" variant="muted" className="line-clamp-2">
          {display.shortDescription}
        </Text>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {display.tags.map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className="font-mono text-[10px] tracking-widest uppercase"
            >
              {tag}
            </Badge>
          ))}
        </div>
        {display.url ? (
          <a
            href={display.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-xs tracking-widest text-muted-foreground uppercase transition-colors hover:text-foreground"
          >
            OPEN
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} />
          </a>
        ) : null}
      </div>
    </Well>
  );
}

/** Map an `EditableProject` row into the same shape the read-only
 * `ProjectCard` consumes — keeps the visual treatment identical
 * across owner / non-owner views. */
function editableToDisplay(p: EditableProject, _index: number): ProfileProject {
  const kind = (p.type as ProjectKind) ?? "other";
  const year = (p.participatedAt ?? new Date()).getUTCFullYear();
  return {
    id: p.id,
    title: p.submissionTitle ?? p.title,
    kind,
    year,
    shortDescription: p.description,
    bannerUrl: p.imageUrl,
    url: p.submissionUrl ?? p.url,
    tags: (p.subTypes ?? []).slice(0, 4),
    jamPlacement: p.result ?? null,
  };
}

function ProjectCard({ project, index }: { project: ProfileProject; index: number }) {
  const banner = project.bannerUrl;
  const palette = paletteForId(project.id);
  return (
    <Well className="group relative gap-2 p-3 transition-colors hover:bg-card">
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded bg-muted/40">
        {banner ? (
          <img
            src={banner}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div aria-hidden className={cn("absolute inset-0", palette.tint, palette.stripe)} />
        )}
        <div className="absolute top-2 left-2 z-10">
          <Badge variant="secondary" className="font-mono text-[10px] tracking-widest uppercase">
            {project.kind}
          </Badge>
        </div>
        <div className="absolute right-2 bottom-2 z-10">
          <Badge variant="secondary" className="font-mono text-[10px] tracking-widest uppercase">
            {project.year}
          </Badge>
        </div>
        {/* Section paginator — mirrors §NN treatment used by section
            headers, anchored top-right of the banner so a row of
            cards reads as a numbered series. */}
        <div className="absolute top-2 right-2 z-10 hidden font-mono text-[10px] tracking-widest text-foreground/70 sm:inline-block">
          §{index.toString().padStart(2, "0")}
        </div>
      </div>
      <Text bold size="lg" className="leading-tight">
        {project.title}
      </Text>
      {project.shortDescription ? (
        <Text size="sm" variant="muted" className="line-clamp-2">
          {project.shortDescription}
        </Text>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
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
          {project.jamPlacement ? (
            <Badge variant="warning" className="font-mono text-[10px] tracking-widest uppercase">
              {project.jamPlacement}
            </Badge>
          ) : null}
        </div>
        <span className="inline-flex items-center gap-1 font-mono text-xs tracking-widest text-muted-foreground uppercase transition-colors group-hover:text-foreground">
          OPEN
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} />
        </span>
      </div>
      {/* Stretched link makes the entire Well clickable while keeping
          inner badges / tag chips selectable separately if we ever
          add child interactivity. */}
      {project.url ? (
        <a
          href={project.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${project.title}`}
          className="absolute inset-0 z-20 rounded focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
        />
      ) : null}
    </Well>
  );
}

/** Pool of palette pairs we cycle through when a project doesn't
 * have an uploaded banner — deterministically picked by the project
 * id so the same project always shows the same colorway, but the
 * grid as a whole reads as varied. */
const PROJECT_PALETTES: Array<{ stripe: string; tint: string }> = [
  {
    stripe:
      "bg-[image:repeating-linear-gradient(135deg,transparent_0_8px,color-mix(in_srgb,var(--color-info,#5da9d6)_45%,transparent)_8px_14px)]",
    tint: "bg-info/15",
  },
  {
    stripe:
      "bg-[image:repeating-linear-gradient(135deg,transparent_0_8px,color-mix(in_srgb,var(--color-accent)_45%,transparent)_8px_14px)]",
    tint: "bg-accent/10",
  },
  {
    stripe:
      "bg-[image:repeating-linear-gradient(90deg,transparent_0_6px,color-mix(in_srgb,var(--color-success)_55%,transparent)_6px_10px)]",
    tint: "bg-success/10",
  },
  {
    stripe:
      "bg-[image:repeating-linear-gradient(45deg,transparent_0_8px,color-mix(in_srgb,var(--color-primary)_45%,transparent)_8px_14px)]",
    tint: "bg-primary/10",
  },
  {
    stripe:
      "bg-[image:repeating-linear-gradient(135deg,transparent_0_8px,color-mix(in_srgb,var(--color-warning)_45%,transparent)_8px_14px)]",
    tint: "bg-warning/10",
  },
  {
    stripe:
      "bg-[image:repeating-linear-gradient(90deg,transparent_0_6px,color-mix(in_srgb,var(--color-destructive)_45%,transparent)_6px_12px)]",
    tint: "bg-destructive/10",
  },
];

/** Hash a project id into a palette index so each project's
 * placeholder is stable across renders but varies between projects. */
function paletteForId(id: string): { stripe: string; tint: string } {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  const palette = PROJECT_PALETTES[h % PROJECT_PALETTES.length];
  // Fallback only in case the array is somehow empty (it isn't —
  // narrows TS to make the return non-undefined).
  return palette ?? PROJECT_PALETTES[0]!;
}
