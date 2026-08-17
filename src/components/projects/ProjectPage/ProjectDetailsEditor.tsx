import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Text } from "@/components/ui/typography";
import {
  PROFILE_PROJECT_SUBTYPE_LABELS,
  type ProfileProjectSubType,
  getAllowedSubTypesForProjectType,
} from "@/lib/profile-projects";
import { projectTypeLabel, releaseStatusLabel } from "@/lib/project-links";
import {
  MANUAL_PROJECT_TYPES,
  type ManualProjectType,
  RELEASE_STATUSES,
  type ReleaseStatus,
} from "@/lib/project-taxonomy";
import { toast } from "@/lib/toast";
import { client } from "@/orpc/client";

import type { ProjectRow } from "./types";

type LinkRow = { label: string; url: string };

const MAX_LINKS = 6;

/**
 * Edit what the project *is*.
 *
 * Everything here lives on the canonical row, which is why it's one form for
 * every editor rather than an owner's settings page: a project is shared by
 * the people who made it, and the last person to describe it wins. The cover
 * has its own control in the hero (it writes to MinIO), and the fields the
 * provider owns — `published`, `restrictedAt`, and `releaseStatus` on an
 * imported project — aren't here at all.
 */
export function ProjectDetailsEditor({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectRow;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description ?? "");
  const [url, setUrl] = useState(project.url ?? "");
  const [type, setType] = useState<ManualProjectType>(
    (MANUAL_PROJECT_TYPES as readonly string[]).includes(project.type)
      ? (project.type as ManualProjectType)
      : "game",
  );
  const [releaseStatus, setReleaseStatus] = useState<ReleaseStatus | "">(
    (project.releaseStatus as ReleaseStatus | null) ?? "",
  );
  const [links, setLinks] = useState<LinkRow[]>(project.links ?? []);
  const [slug, setSlug] = useState(project.slug);
  const [subTypes, setSubTypes] = useState<string[]>(project.subTypes ?? []);

  // Only `audio` and `app` carry sub-type nuance; the row disappears (and
  // stale picks are shed at save) for every other kind.
  const allowedSubTypes = getAllowedSubTypesForProjectType(type);

  // Only a manual project owns its release status — for an import it's itch's
  // answer, and the next sync would disagree with anything typed here.
  const canEditReleaseStatus = project.source === "manual";

  const save = useMutation({
    mutationFn: async () => {
      await client.updateProjectDetails({
        projectId: project.id,
        title: title.trim(),
        description: description.trim() || null,
        url: url.trim() || null,
        type,
        subTypes: subTypes.filter((subType): subType is ProfileProjectSubType =>
          (allowedSubTypes as readonly string[]).includes(subType),
        ),
        links: links.filter((link) => link.label.trim() && link.url.trim()),
        ...(canEditReleaseStatus ? { releaseStatus: releaseStatus || null } : {}),
      });
      // The rename is its own endpoint (first-come-first-served, any editor)
      // so a plain details save can never move the URL by accident.
      if (slug.trim() && slug.trim() !== project.slug) {
        return await client.setProjectSlug({ projectId: project.id, slug: slug.trim() });
      }
      return null;
    },
    onSuccess: async (renamed) => {
      toast.success("Project updated");
      onOpenChange(false);
      if (renamed && renamed.slug !== project.slug) {
        // The viewer is standing on the old URL; walk them to the new one.
        await router.navigate({
          to: "/projects/$projectSlug",
          params: { projectSlug: renamed.slug },
          replace: true,
        });
        return;
      }
      // The loader owns every field on this page, so it refetches rather than
      // being patched.
      await router.invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error && error.message ? error.message : "Failed to save"),
  });

  const updateLink = (index: number, patch: Partial<LinkRow>) => {
    setLinks((current) => current.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="tracking-widest uppercase">Edit project</SheetTitle>
          <SheetDescription>
            These details are the project's own — they show wherever it appears.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 p-4">
          <Field label="TITLE" required>
            <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </Field>

          <Field label="HANDLE" hint={`/projects/${slug.trim() || "…"}`}>
            <Input
              value={slug}
              maxLength={80}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
            />
          </Field>

          <Field label="KIND">
            <ToggleGroup
              value={[type]}
              onValueChange={(value: string[]) => {
                const picked = value[0];
                if (picked) setType(picked as ManualProjectType);
              }}
              variant="outline"
              size="sm"
              className="flex-wrap [&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md"
            >
              {MANUAL_PROJECT_TYPES.map((value) => (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  className="bg-card! px-3 text-[11px] tracking-widest uppercase"
                >
                  {projectTypeLabel({ type: value })}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          {allowedSubTypes.length > 0 ? (
            <Field label="SUB-TYPES" hint="optional">
              <ToggleGroup
                value={subTypes}
                onValueChange={(value: string[]) => setSubTypes(value)}
                variant="outline"
                size="sm"
                className="flex-wrap [&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md"
              >
                {allowedSubTypes.map((value) => (
                  <ToggleGroupItem
                    key={value}
                    value={value}
                    className="bg-card! px-3 text-[11px] tracking-widest uppercase"
                  >
                    {PROFILE_PROJECT_SUBTYPE_LABELS[value]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
          ) : null}

          <Field label="DESCRIPTION" hint="optional">
            <Textarea
              value={description}
              rows={4}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is it?"
            />
          </Field>

          <Field label="URL" hint="what the main button points at">
            <Input
              type="url"
              value={url}
              placeholder="https://…"
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>

          {canEditReleaseStatus ? (
            <Field label="RELEASE STATUS" hint="optional">
              <ToggleGroup
                value={releaseStatus ? [releaseStatus] : []}
                onValueChange={(value: string[]) =>
                  setReleaseStatus((value[0] as ReleaseStatus | undefined) ?? "")
                }
                variant="outline"
                size="sm"
                className="flex-wrap [&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md"
              >
                {RELEASE_STATUSES.map((value) => (
                  <ToggleGroupItem
                    key={value}
                    value={value}
                    className="bg-card! px-3 text-[11px] tracking-widest uppercase"
                  >
                    {releaseStatusLabel(value) ?? "RELEASED"}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
          ) : (
            <Text size="xs" variant="muted">
              Release status, visibility and cover art come from itch.io for imported projects.
            </Text>
          )}

          <Field label="MORE LINKS" hint="repo, site, store">
            <div className="flex flex-col gap-2">
              {links.map((link, index) => (
                // Positional rows: appended and removed by index, never keyed
                // by anything the server assigned.
                // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={link.label}
                    maxLength={40}
                    placeholder="REPO"
                    aria-label={`Link ${index + 1} label`}
                    className="w-28 shrink-0"
                    onChange={(e) => updateLink(index, { label: e.target.value })}
                  />
                  <Input
                    type="url"
                    value={link.url}
                    placeholder="https://…"
                    aria-label={`Link ${index + 1} URL`}
                    onChange={(e) => updateLink(index, { url: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove link ${index + 1}`}
                    onClick={() => setLinks(links.filter((_, i) => i !== index))}
                  >
                    ✕
                  </Button>
                </div>
              ))}
              {links.length < MAX_LINKS ? (
                <Button
                  variant="outline"
                  size="xs"
                  className="self-start tracking-widest"
                  onClick={() => setLinks([...links, { label: "", url: "" }])}
                >
                  <HugeiconsIcon icon={Add01Icon} size={12} />
                  ADD LINK
                </Button>
              ) : null}
            </div>
          </Field>

          <div className="mt-1 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="tracking-widest"
              onClick={() => onOpenChange(false)}
            >
              CANCEL
            </Button>
            <Button
              size="sm"
              className="tracking-widest"
              disabled={!title.trim() || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "SAVING…" : "SAVE"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-[11px] tracking-widest text-muted-foreground uppercase">
          {label}
          {required ? <span className="ml-0.5 text-destructive">*</span> : null}
        </Label>
        {hint ? (
          <Text size="xs" variant="muted" className="text-right tracking-wide">
            {hint}
          </Text>
        ) : null}
      </div>
      {children}
    </div>
  );
}
