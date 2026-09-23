import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useEffect, useState } from "react";

import {
  FieldRow,
  ImageUploader,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/collab/CollabCreateFlyout/fields";
import { BOTTOM_NAV_HEIGHT } from "@/components/layout/MobileShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import type { ForumPostKind } from "@/db/schema";
import { activeUserStore } from "@/lib/active-user-store";
import { authStore } from "@/lib/auth-store";
import type { UploadedImage } from "@/lib/collab-store";
import { errorMessage } from "@/lib/error-message";
import {
  FORUM_DEFAULT_CATEGORY,
  FORUM_KIND_LABEL,
  FORUM_LIMITS,
  FORUM_MAX_TAGS,
  FORUM_RESERVED_TAGS,
  forumPostLinkParams,
  normalizeTagSlug,
} from "@/lib/forum-posts";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { postImageForm } from "@/lib/image-upload";
import { reportMutationError } from "@/lib/product-insights";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import {
  clearForumDraft,
  EMPTY_DRAFT,
  type ForumDraft,
  readForumDraft,
  writeForumDraft,
} from "./forum-draft";
import {
  forumCategoriesQueryOptions,
  type ForumPostDetail,
  invalidateForum,
} from "./forum-queries";
import { useGuildGate } from "./guild-gate";

const KINDS: ForumPostKind[] = ["post", "devlog", "question"];

const BODY_PLACEHOLDER: Record<ForumPostKind, string> = {
  post: "Share progress, a clip, a small win…",
  devlog: "What did you build, break and learn? Markdown works.",
  question: "What are you stuck on? Engine, version, what you've tried…",
};

function uploadForumImage(postId: number, file: File) {
  return postImageForm("/api/forum/image", file, { postId: String(postId) }, "Upload failed.");
}

/**
 * Uploads land after the post exists — keys are minted against its id —
 * so this runs once the create (or edit) has returned. Failures are
 * counted rather than thrown: the post is already live.
 */
async function attachUploads(
  postId: number,
  images: UploadedImage[],
  cover: UploadedImage | null,
): Promise<number> {
  let failed = 0;
  for (const image of images) {
    try {
      const uploaded = await uploadForumImage(postId, image.file);
      await client.addForumPostImage({
        postId,
        imageKey: uploaded.key,
        url: uploaded.url,
        alt: image.alt,
      });
    } catch (error) {
      reportMutationError(error, "forum.image");
      failed++;
    }
  }
  if (cover) {
    try {
      const uploaded = await uploadForumImage(postId, cover.file);
      await client.setForumPostCover({ postId, imageKey: uploaded.key, url: uploaded.url });
    } catch (error) {
      reportMutationError(error, "forum.cover");
      failed++;
    }
  }
  return failed;
}

/** Free-text tags with usage-ranked suggestions; Enter or comma adds. */
export function TagInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const query = useDebouncedValue(text.trim(), 200);
  const full = tags.length >= FORUM_MAX_TAGS;
  const { data: suggestions } = useQuery({
    ...orpc.searchForumTags.queryOptions({ input: { query, limit: 8 } }),
    enabled: !full,
    staleTime: STALE.listing,
  });

  const add = (raw: string) => {
    const slug = normalizeTagSlug(raw);
    if (!slug) {
      setError("Tags are 2–32 letters, numbers or dashes.");
      return;
    }
    const reserved = FORUM_RESERVED_TAGS[slug];
    if (reserved) {
      setError(reserved);
      return;
    }
    setError(null);
    setText("");
    if (!tags.includes(slug) && !full) onChange([...tags, slug]);
  };

  const offered = (suggestions ?? []).filter((tag) => !tags.includes(tag.slug)).slice(0, 6);

  return (
    <FieldRow label="Tags" hint={`${tags.length}/${FORUM_MAX_TAGS}`} error={error}>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <Badge key={tag} variant="secondary" size="label" className="h-6 gap-1 uppercase">
            #{tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              aria-label={`Remove #${tag}`}
              className="pointer-events-auto -mr-0.5 inline-flex cursor-pointer text-secondary-foreground/60 hover:text-destructive"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={10} />
            </button>
          </Badge>
        ))}
        {!full ? (
          <Input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                if (text.trim()) add(text);
              } else if (e.key === "Backspace" && !text && tags.length > 0) {
                onChange(tags.slice(0, -1));
              }
            }}
            onBlur={() => {
              if (text.trim()) add(text);
            }}
            placeholder={tags.length === 0 ? "godot, pixelart, jam-2026-2…" : "Add a tag"}
            aria-label="Add a tag"
            className="h-7 w-44 flex-1"
          />
        ) : null}
      </div>
      {offered.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <MicroLabel as="span" className="uppercase">
            {query ? "Matching" : "Popular"}
          </MicroLabel>
          {offered.map((tag) => (
            <Badge
              key={tag.slug}
              variant="outline"
              size="label"
              className="pointer-events-auto cursor-pointer uppercase hover:border-primary/60"
              render={
                <button
                  type="button"
                  // mousedown, so the input's blur doesn't commit half a tag first
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(tag.slug)}
                />
              }
            >
              #{tag.slug}
              <span className="text-muted-foreground tabular-nums">{tag.usageCount}</span>
            </Badge>
          ))}
        </div>
      ) : null}
    </FieldRow>
  );
}

type ComposerProps = {
  /** Editing an existing post rather than writing a new one. */
  editing?: ForumPostDetail;
  /** The board the composer sits on, which new posts default to. */
  defaultCategory?: string;
  onDone?: () => void;
  onCancel?: () => void;
};

/**
 * Post, devlog or question: one form whose fields follow the kind. Titles
 * and tags are checked against the same limits and word list the server
 * uses; the server has the last word either way.
 */
export function ForumComposerForm({ editing, defaultCategory, onDone, onCancel }: ComposerProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { guard, onServerRefusal } = useGuildGate();
  const { session } = useStore(authStore);
  const isStaff = useStore(activeUserStore, (s) => s.profile?.isStaff ?? false);

  // A new post picks up whatever this browser was last writing. Safe to
  // read in the initializer: the form only mounts after a click, never in
  // the server render.
  const [draft, setDraft] = useState<ForumDraft>(() => {
    if (editing) {
      return {
        kind: editing.kind,
        title: editing.title ?? "",
        body: editing.body ?? "",
        tags: editing.tags,
        category: editing.category.slug,
        teamId: editing.team?.id ?? null,
      };
    }
    const saved = readForumDraft();
    return saved
      ? { ...saved, category: defaultCategory ?? saved.category }
      : { ...EMPTY_DRAFT, category: defaultCategory ?? null };
  });
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<number[]>([]);
  const [cover, setCover] = useState<UploadedImage | null>(null);
  const [coverRemoved, setCoverRemoved] = useState(false);

  useEffect(() => {
    if (!editing) writeForumDraft(draft);
  }, [editing, draft]);

  const { data: categories } = useQuery(forumCategoriesQueryOptions());
  const { data: teams } = useQuery({
    ...orpc.listMyTeams.queryOptions({ input: {} }),
    enabled: Boolean(session?.user) && !editing,
    staleTime: STALE.listing,
  });
  const postableTeams = (teams ?? []).filter((team) => !team.hidden);

  const kind = draft.kind;
  const limits = FORUM_LIMITS[kind];
  const category = draft.category ?? FORUM_DEFAULT_CATEGORY[kind];
  const categoryOptions = (categories ?? [])
    .filter((c) => c.postingPolicy === "anyone" || isStaff || c.slug === category)
    .map((c) => ({ value: c.slug, label: c.name }));
  const existingImages = (editing?.images ?? []).filter((img) => !removedImageIds.includes(img.id));
  const existingCover =
    editing?.coverUrl && !coverRemoved ? [{ id: 0, url: editing.coverUrl }] : [];

  const title = draft.title.trim();
  const body = draft.body.trim();
  const problem =
    kind !== "post" && !title
      ? "Give it a title."
      : title.length > limits.title && kind !== "post"
        ? `Keep the title under ${limits.title} characters.`
        : !body
          ? "Write something first."
          : body.length > limits.body
            ? `Keep it under ${limits.body.toLocaleString("en-US")} characters.`
            : null;

  const update = (patch: Partial<ForumDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const reset = () => {
    for (const image of images) URL.revokeObjectURL(image.previewUrl);
    if (cover) URL.revokeObjectURL(cover.previewUrl);
    setImages([]);
    setCover(null);
    setDraft({ ...EMPTY_DRAFT, kind, category: defaultCategory ?? null });
    clearForumDraft();
  };

  const submit = useMutation({
    mutationFn: async () => {
      const content = {
        title: kind === "post" ? null : title,
        body,
        category,
        tags: draft.tags,
      };
      if (editing) {
        await client.updateForumPost({
          postId: editing.id,
          ...content,
          projectId: editing.links.project?.id ?? null,
          jamId: editing.links.jam?.jamId ?? null,
          collabPostId: editing.links.collabPost?.id ?? null,
        });
        for (const imageId of removedImageIds) {
          await client.removeForumPostImage({ imageId });
        }
        if (coverRemoved && !cover) {
          await client.setForumPostCover({ postId: editing.id, imageKey: null, url: null });
        }
        const failed = await attachUploads(editing.id, images, cover);
        return { id: editing.id, slug: editing.slug, failed };
      }
      const created = await client.createForumPost({
        kind,
        ...content,
        teamId: kind === "devlog" ? draft.teamId : null,
      });
      const failed = await attachUploads(created.id, images, kind === "devlog" ? cover : null);
      return { id: created.id, slug: created.slug, failed };
    },
    onSuccess: ({ id, slug, failed }) => {
      // Only now, with the uploads settled, does the post reach the feeds —
      // a short post never shows up without the images it was sent with.
      invalidateForum(queryClient, id);
      if (failed > 0) {
        toast.warning(
          failed === 1
            ? "Posted, but one image didn't upload."
            : `Posted, but ${failed} images didn't upload.`,
          { description: "Edit the post to try them again." },
        );
      } else {
        toast.success(editing ? "Saved." : `${FORUM_KIND_LABEL[kind]} published.`);
      }
      if (editing) {
        onDone?.();
        return;
      }
      reset();
      onDone?.();
      if (kind !== "post") {
        void navigate({ to: "/forum/$postId", params: forumPostLinkParams({ id, slug }) });
      }
    },
    onError: (error) => {
      if (onServerRefusal(error, editing ? "edit" : "post", () => submit.mutate())) return;
      reportMutationError(error, editing ? "forum.update" : "forum.create");
      toast.error(errorMessage(error, "Couldn't publish that — try again."));
    },
  });

  const onSubmit = () => {
    if (problem || submit.isPending) return;
    guard(editing ? "edit" : "post", () => submit.mutate());
  };

  return (
    <div className="flex flex-col gap-4">
      {!editing ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            size="sm"
            priority="primary"
            value={kind}
            onChange={(value) => update({ kind: value as ForumPostKind })}
            aria-label="What you're posting"
          >
            {KINDS.map((k) => (
              <SegmentedControl.Item key={k} value={k} className="tracking-widest uppercase">
                {FORUM_KIND_LABEL[k]}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl>
          {kind === "devlog" && postableTeams.length > 0 ? (
            <SelectField
              label="Posting as"
              value={draft.teamId ?? "me"}
              onChange={(value) => update({ teamId: value === "me" ? null : value })}
              options={[
                { value: "me", label: "Me" },
                ...postableTeams.map((team) => ({ value: team.id, label: team.name })),
              ]}
            />
          ) : null}
        </div>
      ) : null}

      {kind !== "post" ? (
        <TextField
          label="Title"
          value={draft.title}
          onChange={(value) => update({ title: value })}
          placeholder={
            kind === "devlog" ? "Devlog #8 — procedural caves, take two" : "What's the question?"
          }
          maxLength={limits.title}
        />
      ) : null}

      <TextAreaField
        label={kind === "post" ? "Post" : "Body"}
        value={draft.body}
        onChange={(value) => update({ body: value })}
        placeholder={BODY_PLACEHOLDER[kind]}
        maxLength={limits.body}
        rows={kind === "post" ? 3 : 8}
        markdown
      />

      <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <SelectField
          label="Category"
          value={categoryOptions.length > 0 ? category : undefined}
          onChange={(value) => update({ category: value })}
          options={categoryOptions}
        />
        <TagInput tags={draft.tags} onChange={(tags) => update({ tags })} />
      </div>

      <div className={cn("grid gap-4", kind === "devlog" && "sm:grid-cols-2")}>
        {kind === "devlog" ? (
          <ImageUploader
            label="COVER"
            max={1}
            images={cover ? [cover] : []}
            onAdd={(image) => setCover(image)}
            onRemove={() => {
              if (cover) URL.revokeObjectURL(cover.previewUrl);
              setCover(null);
            }}
            existing={cover ? [] : existingCover}
            onRemoveExisting={() => setCoverRemoved(true)}
            note="Shown on the card and as the link preview. 16:9 reads best."
          />
        ) : null}
        <ImageUploader
          label="IMAGES"
          max={limits.images}
          images={images}
          onAdd={(image) => setImages((list) => [...list, image])}
          onRemove={(idx) =>
            setImages((list) => {
              const gone = list[idx];
              if (gone) URL.revokeObjectURL(gone.previewUrl);
              return list.filter((_, i) => i !== idx);
            })
          }
          existing={existingImages}
          onRemoveExisting={(id) => setRemovedImageIds((ids) => [...ids, id])}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-muted/40 pt-3">
        <Text size="xs" variant={problem && (title || body) ? "warning" : "muted"}>
          {problem && (title || body)
            ? problem
            : "Markdown works — **bold**, lists, `code`, links."}
        </Text>
        <div className="flex items-center gap-2">
          {onCancel ? (
            <Button variant="ghost" size="sm" onClick={onCancel} className="tracking-widest">
              CANCEL
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={Boolean(problem) || submit.isPending}
            className="tracking-widest"
          >
            {submit.isPending
              ? editing
                ? "SAVING…"
                : "PUBLISHING…"
              : editing
                ? "SAVE CHANGES"
                : `PUBLISH ${FORUM_KIND_LABEL[kind].toUpperCase()}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The way into writing, per layout A and E: inline above the feed on a
 * wide screen, a floating button and a sheet on a phone. Opening either
 * counts as the first write, so a non-member meets the Join Discord modal
 * here rather than after typing a post.
 */
export function ForumComposeLauncher({ defaultCategory }: { defaultCategory?: string }) {
  const isMobile = useIsMobile();
  const { guard } = useGuildGate();
  const [open, setOpen] = useState(false);
  const self = useStore(activeUserStore, (s) => s.profile);
  const { session } = useStore(authStore);

  const start = () => guard("compose", () => setOpen(true));

  if (isMobile) {
    return (
      <>
        <Button
          size="icon-lg"
          onClick={start}
          aria-label="New post"
          tooltip="New post"
          className="fixed right-4 z-40 size-13 rounded-xl"
          style={{ bottom: `calc(${BOTTOM_NAV_HEIGHT} + 0.5rem)` }}
        >
          <HugeiconsIcon icon={Add01Icon} className="size-6" />
        </Button>
        <ResponsiveModal
          open={open}
          onClose={() => setOpen(false)}
          title="New post"
          description="Write a post, devlog or question for the forum."
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            <ForumComposerForm
              defaultCategory={defaultCategory}
              onDone={() => setOpen(false)}
              onCancel={() => setOpen(false)}
            />
          </div>
        </ResponsiveModal>
      </>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={start}
        className="chonk-deboss flex h-12 w-full cursor-text items-center gap-3 rounded-lg border bg-deboss-surface px-3 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {session?.user ? (
          <UserAvatar
            avatarUrl={self?.avatarUrl ?? session.user.image}
            guildAvatarUrl={self?.guildAvatarUrl}
            username={self?.discordUsername ?? session.user.name}
            size={26}
          />
        ) : null}
        <span className="flex-1">Share progress, write a devlog, or ask something…</span>
        <Badge variant="outline" size="label">
          NEW POST
        </Badge>
      </button>
    );
  }

  return (
    <Well className="p-4 backdrop-blur-none">
      <ForumComposerForm
        defaultCategory={defaultCategory}
        onDone={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </Well>
  );
}

/** The post page's EDIT: the same form, filled, in a modal. */
export function ForumEditDialog({
  post,
  open,
  onClose,
}: {
  post: ForumPostDetail;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      title={`Edit ${FORUM_KIND_LABEL[post.kind].toLowerCase()}`}
      description="Change this post's text, category, tags or images."
      className="sm:max-w-2xl"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {open ? <ForumComposerForm editing={post} onDone={onClose} onCancel={onClose} /> : null}
      </div>
    </ResponsiveModal>
  );
}
