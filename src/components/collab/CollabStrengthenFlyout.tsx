import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Heading, Text } from "@/components/ui/typography";
import type { UploadedImage } from "@/lib/collab-store";
import type { CollabExperienceLevel, CollabProjectLength } from "@/lib/collab-vocabulary";
import { EVENTS } from "@/lib/event-taxonomy";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { useReleaseFocusOnOpen } from "@/lib/hooks/use-release-focus";
import { itchImageUrl } from "@/lib/itch-image";
import { toastMutationError } from "@/lib/mutation-errors";
import { captureEvent } from "@/lib/product-insights";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import type { CollabPostDetailData } from "./collab-post-data";
import { attachImages } from "./CollabCreateFlyout/CollabCreateForm";
import { ImageUploader, MultiSelectField, SelectField } from "./CollabCreateFlyout/fields";
import { JamPickerField } from "./CollabCreateFlyout/JamPickerField";
import { ProjectPickerField } from "./CollabCreateFlyout/ProjectPickerField";
import {
  EXPERIENCE_LEVEL_OPTIONS,
  PLATFORM_OPTIONS,
  PROJECT_LENGTH_OPTIONS,
  projectLengthForJam,
} from "./CollabCreateFlyout/shared";
import { TeamPickerField } from "./CollabCreateFlyout/TeamPickerField";

export type StrengthenField = "project" | "team" | "jam" | "terms" | "art";

type LinksPatch = Omit<Parameters<typeof client.updatePostLinks>[0], "postId">;

/** Title and payoff for each flyout, shared with the panel's rows. */
export const STRENGTHEN_COPY: Record<StrengthenField, { title: string; payoff: string }> = {
  project: {
    title: "LINK THE GAME",
    payoff: "Shows the post on the project page and uses its cover.",
  },
  team: { title: "ATTACH A CREW", payoff: "People you accept get invited to its roster." },
  jam: { title: "TAG THE JAM", payoff: "Reaches people who watch this jam; fills the timeline." },
  terms: {
    title: "TERMS",
    payoff: "Platforms, timeline, experience — helps the right people filter to you.",
  },
  art: { title: "ART", payoff: "A cover makes the card twice as visible on the board." },
};

/**
 * The one mutation behind the three link rows, shared by the panel's
 * inline undo buttons and the flyouts' pickers so both settle the same way.
 */
export function usePostLinksMutation(post: CollabPostDetailData, onSettled?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: LinksPatch) => client.updatePostLinks({ postId: post.id, ...patch }),
    onSuccess: (_updated, patch) => {
      void queryClient.invalidateQueries({
        queryKey: orpc.getPost.queryOptions({ input: { postId: post.id } }).queryKey,
      });
      const field: StrengthenField =
        patch.projectId !== undefined ? "project" : patch.teamId !== undefined ? "team" : "jam";
      const linked = patch[`${field}Id`] != null;
      if (linked) captureEvent(EVENTS.collabPostStrengthened, { post_id: post.id, field });
      toast.success(
        linked
          ? { project: "Game linked.", team: "Crew attached.", jam: "Jam tagged." }[field]
          : { project: "Game unlinked.", team: "Crew detached.", jam: "Jam untagged." }[field],
      );
      onSettled?.();
    },
    onError: toastMutationError("collab.strengthen"),
  });
}

/**
 * One strengthen row's own surface: a right-side panel on desktop, a
 * bottom sheet on touch, holding nothing but that row's control. Pickers
 * commit on pick and close; the terms and art forms save on a button.
 * Keyed on the field so a fresh form mounts for each opening.
 */
export function CollabStrengthenFlyout({
  post,
  field,
  onClose,
}: {
  post: CollabPostDetailData;
  /** The open row; `null` keeps the drawer closed. */
  field: StrengthenField | null;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const open = field !== null;
  useReleaseFocusOnOpen(open);
  const copy = field ? STRENGTHEN_COPY[field] : null;

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => !next && onClose()}
      direction={isMobile ? "bottom" : "right"}
    >
      <DrawerContent
        className="p-0 sm:max-w-[28rem]"
        style={isMobile ? { height: "88vh", maxHeight: "88vh" } : undefined}
      >
        <DrawerTitle className="sr-only">{copy?.title ?? "Strengthen this post"}</DrawerTitle>
        <DrawerDescription className="sr-only">{copy?.payoff ?? ""}</DrawerDescription>
        {field && copy ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-col gap-1 border-b border-muted/30 px-5 pt-4 pb-4">
              <Heading as="h2" className="text-lg tracking-widest uppercase">
                {copy.title}
              </Heading>
              <Text size="xs" variant="muted" textWrap="pretty">
                {copy.payoff}
              </Text>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {field === "project" ? <ProjectBody post={post} onDone={onClose} /> : null}
              {field === "team" ? <TeamBody post={post} onDone={onClose} /> : null}
              {field === "jam" ? <JamBody post={post} onDone={onClose} /> : null}
              {field === "terms" ? <TermsBody post={post} onDone={onClose} /> : null}
              {field === "art" ? <ArtBody post={post} onDone={onClose} /> : null}
            </div>
          </div>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

type BodyProps = { post: CollabPostDetailData; onDone: () => void };

function ProjectBody({ post, onDone }: BodyProps) {
  const links = usePostLinksMutation(post, onDone);
  // Only to decide the copy — the picker hides itself when there's
  // nothing to pick.
  const { data: editable } = useQuery({
    ...orpc.listEditableProjects.queryOptions({ input: {} }),
    staleTime: STALE.listing,
  });
  const hasProjects = editable === undefined || editable.projects.length > 0;

  if (!hasProjects) {
    return (
      <Text size="sm" variant="muted" textWrap="pretty">
        Add the game to{" "}
        <Link to="/profile" className="text-primary hover:underline">
          your profile
        </Link>{" "}
        first, then link it here.
      </Text>
    );
  }
  return (
    <ProjectPickerField
      value={post.project?.id}
      selectedTeamId={post.team?.id}
      onChange={(project) => links.mutate({ projectId: project?.id ?? null })}
    />
  );
}

function TeamBody({ post, onDone }: BodyProps) {
  const links = usePostLinksMutation(post, onDone);
  return (
    <TeamPickerField
      value={post.team?.id}
      onChange={(teamId) => links.mutate({ teamId: teamId ?? null })}
    />
  );
}

function JamBody({ post, onDone }: BodyProps) {
  const links = usePostLinksMutation(post, onDone);
  return (
    <JamPickerField
      value={post.jam?.jamId}
      onChange={(jam) =>
        links.mutate(
          jam
            ? { jamId: jam.jamId, projectLength: projectLengthForJam(jam.startsAt, jam.endsAt) }
            : { jamId: null },
        )
      }
    />
  );
}

function TermsBody({ post, onDone }: BodyProps) {
  const queryClient = useQueryClient();
  const [platforms, setPlatforms] = useState<string[]>(post.platforms ?? []);
  const [projectLength, setProjectLength] = useState<CollabProjectLength | undefined>(
    (post.projectLength as CollabProjectLength | null) ?? undefined,
  );
  const [experienceLevel, setExperienceLevel] = useState<CollabExperienceLevel | undefined>(
    (post.experienceLevel as CollabExperienceLevel | null) ?? undefined,
  );

  const save = useMutation({
    mutationFn: () =>
      client.updatePostTerms({
        postId: post.id,
        platforms,
        projectLength: projectLength ?? null,
        experienceLevel: experienceLevel ?? null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.getPost.queryOptions({ input: { postId: post.id } }).queryKey,
      });
      captureEvent(EVENTS.collabPostStrengthened, { post_id: post.id, field: "terms" });
      toast.success("Terms saved.");
      onDone();
    },
    onError: toastMutationError("collab.strengthen"),
  });

  return (
    <div className="flex flex-col gap-5">
      <MultiSelectField
        label="PLATFORMS"
        value={platforms}
        onChange={setPlatforms}
        options={PLATFORM_OPTIONS}
        placeholder="Pick your platforms…"
      />
      <SelectField
        label="TIMELINE"
        value={projectLength}
        onChange={setProjectLength}
        options={PROJECT_LENGTH_OPTIONS}
        placeholder="How long it'll run…"
      />
      <SelectField
        label="EXPERIENCE LEVEL"
        value={experienceLevel}
        onChange={setExperienceLevel}
        options={EXPERIENCE_LEVEL_OPTIONS}
        placeholder="Who should apply…"
      />
      <FlyoutActions
        pending={save.isPending}
        onSave={() => save.mutate()}
        onCancel={onDone}
        saveLabel="SAVE TERMS"
      />
    </div>
  );
}

function ArtBody({ post, onDone }: BodyProps) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<UploadedImage[]>([]);
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.getPost.queryOptions({ input: { postId: post.id } }).queryKey,
    });

  const remove = useMutation({
    mutationFn: (imageId: number) => client.removePostImage({ imageId }),
    onSuccess: () => {
      void invalidate();
      toast.success("Image removed.");
    },
    onError: toastMutationError("collab.strengthen"),
  });

  const upload = useMutation({
    mutationFn: () => attachImages(post.id, pending, true),
    onSuccess: () => {
      void invalidate();
      captureEvent(EVENTS.collabPostStrengthened, { post_id: post.id, field: "art" });
      toast.success(pending.length === 1 ? "Image added." : "Images added.");
      onDone();
    },
    onError: toastMutationError("collab.strengthen"),
  });

  const room = Math.max(0, 5 - post.images.length);

  return (
    <div className="flex flex-col gap-5">
      {post.images.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Text size="xs" variant="muted" className="tracking-widest uppercase">
            On the post
          </Text>
          <div className="flex flex-wrap gap-2">
            {post.images.map((img) => (
              <div key={img.id} className="group relative h-16 w-16">
                <img
                  src={itchImageUrl(img.url, { width: 128 })}
                  alt={img.alt ?? ""}
                  className="h-full w-full border border-muted/40 object-cover"
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="icon-xs"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(img.id)}
                  className="absolute -top-1 -right-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label="Remove image"
                  title="Remove image"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={10} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {room > 0 ? (
        <ImageUploader
          images={pending}
          onAdd={(img) => setPending((p) => (p.length < room ? [...p, img] : p))}
          onRemove={(idx) => setPending((p) => p.filter((_, i) => i !== idx))}
          label="ADD IMAGES"
          note={
            post.project?.imageUrl
              ? "The card already uses the game's cover. Anything added here is extra art for this post."
              : "The first image becomes the card's cover on the board."
          }
        />
      ) : (
        <Text size="xs" variant="muted">
          This post has the maximum five images.
        </Text>
      )}

      <FlyoutActions
        pending={upload.isPending}
        disabled={pending.length === 0}
        onSave={() => upload.mutate()}
        onCancel={onDone}
        saveLabel={pending.length > 1 ? "ADD IMAGES" : "ADD IMAGE"}
      />
    </div>
  );
}

function FlyoutActions({
  pending,
  disabled,
  onSave,
  onCancel,
  saveLabel,
}: {
  pending: boolean;
  disabled?: boolean;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-muted/30 pt-4">
      <Button variant="ghost" size="sm" onClick={onCancel} className="tracking-widest">
        CANCEL
      </Button>
      <Button size="sm" disabled={pending || disabled} onClick={onSave} className="tracking-widest">
        {pending ? "SAVING…" : saveLabel}
      </Button>
    </div>
  );
}
