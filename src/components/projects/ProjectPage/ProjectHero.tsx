import { ImageUpload01Icon, LinkSquare01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MediaCardImage } from "@/components/ui/media-card";
import { Spinner } from "@/components/ui/spinner";
import { Heading, Link, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { projectCtaLabel, projectTypeLabel, releaseStatusLabel } from "@/lib/project-links";

import type { ProjectRow } from "./types";

/**
 * The project's masthead: cover, what kind of thing it is, when it shipped,
 * and the one button that matters.
 *
 * The CTA is type-aware rather than "PLAY" — the entity is artifact-neutral
 * on purpose (itch hosts tools, asset packs, soundtracks; our members also
 * ship libraries and websites itch never sees), and a sample pack with a
 * "PLAY" button is the games-first bias leaking back in.
 */
export function ProjectHero({ project, canEdit }: { project: ProjectRow; canEdit: boolean }) {
  const typeLabel = projectTypeLabel(project);
  const ctaLabel = projectCtaLabel(project);
  const status = releaseStatusLabel(project.releaseStatus);
  // A restricted project's page still renders — participation is public
  // record — but its provider links are dead for anonymous visitors, so we
  // don't offer them. Same semantics as the library sync's URL probe.
  const restricted = project.restrictedAt != null;
  const showCta = project.url != null && !restricted;

  return (
    <Well className="overflow-hidden p-0">
      <div className="flex flex-col gap-0 sm:flex-row">
        <div className="relative aspect-[63/50] w-full shrink-0 overflow-hidden bg-muted/20 sm:w-72 lg:w-96">
          {project.imageUrl ? (
            <MediaCardImage src={project.imageUrl} alt={`${project.title} cover`} />
          ) : (
            <Text
              bold
              density="dense"
              className="absolute inset-0 flex items-center justify-center text-3xl tracking-tighter text-foreground/25"
            >
              {typeLabel}
            </Text>
          )}
          {canEdit ? <CoverUploadControl projectId={project.id} /> : null}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" size="label">
              {typeLabel}
            </Badge>
            {project.subTypes.map((subType) => (
              <Badge key={subType} variant="outline" size="label" className="uppercase">
                {subType}
              </Badge>
            ))}
            {status ? (
              <Badge variant="warning" size="label">
                {status}
              </Badge>
            ) : null}
            {!project.published ? (
              // Only its editors can see this page at all, so the badge is
              // telling them why nobody else can.
              <Badge variant="outline" size="label">
                UNPUBLISHED
              </Badge>
            ) : null}
          </div>

          <Heading as="h1" className="text-3xl leading-tight md:text-4xl">
            {project.title}
          </Heading>

          {project.releasedAt ? (
            <MicroLabel as="div">
              SHIPPED{" "}
              {new Date(project.releasedAt)
                .toLocaleDateString(undefined, {
                  month: "short",
                  year: "numeric",
                  timeZone: "UTC",
                })
                .toUpperCase()}
            </MicroLabel>
          ) : null}

          {project.description ? (
            <Text size="md" variant="muted" className="max-w-prose">
              {project.description}
            </Text>
          ) : null}

          <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
            {showCta ? (
              <Button
                size="sm"
                className="tracking-widest"
                nativeButton={false}
                render={
                  <a
                    href={project.url ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={ctaLabel}
                  />
                }
              >
                {ctaLabel}
                <HugeiconsIcon icon={LinkSquare01Icon} size={12} />
              </Button>
            ) : restricted ? (
              <MicroLabel>THIS PROJECT'S PAGE IS NO LONGER PUBLIC ON ITCH.IO</MicroLabel>
            ) : null}

            {/* Secondary links: repo, live site, store page. */}
            {!restricted &&
              project.links.map((link) => (
                <Link
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="sm"
                  className="tracking-widest uppercase"
                >
                  {link.label} →
                </Link>
              ))}
          </div>
        </div>
      </div>
    </Well>
  );
}

/**
 * Editor-only cover swap.
 *
 * The upload goes to a **project-scoped** key (`project-images/<id>/…`), not
 * the uploader's namespace: a canonical cover that lived under one member's
 * prefix would be deleted with their account and blank the project on every
 * page that renders it. Authorization is the project's editor set, checked
 * server-side — this control is only the affordance.
 *
 * The page loads through a route loader, so a successful upload invalidates
 * the route rather than patching a cache.
 */
function CoverUploadControl({ projectId }: { projectId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("projectId", projectId);
      const response = await fetch("/api/project/image", { method: "POST", body: formData });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? "Upload failed.");
      }
      await router.invalidate();
      toast.success("Cover updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to upload cover");
    } finally {
      setUploading(false);
      // Let the same file be picked again after a failure.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button
        size="xs"
        variant="secondary"
        className="absolute top-2 right-2 tracking-widest"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <Spinner className="size-3" />
        ) : (
          <HugeiconsIcon icon={ImageUpload01Icon} size={12} />
        )}
        {uploading ? "UPLOADING" : "COVER"}
      </Button>
    </>
  );
}
