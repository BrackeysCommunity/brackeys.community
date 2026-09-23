import { Shield01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { SelectField } from "@/components/collab/CollabCreateFlyout/fields";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Textarea } from "@/components/ui/textarea";
import { MicroLabel, Text } from "@/components/ui/typography";
import { toastMutationError } from "@/lib/mutation-errors";
import { toast } from "@/lib/toast";
import { client } from "@/orpc/client";

import {
  forumCategoriesQueryOptions,
  type ForumPostDetail,
  invalidateForum,
} from "./forum-queries";
import { TagInput } from "./ForumComposer";

type Dialog = "hide" | "move" | "remove" | null;

const DIALOG_COPY: Record<Exclude<Dialog, null>, { title: string; confirm: string }> = {
  hide: { title: "Hide this post", confirm: "HIDE POST" },
  move: { title: "Move or retag", confirm: "SAVE" },
  remove: { title: "Remove this post", confirm: "REMOVE" },
};

/**
 * Staff's controls on the post page — the only UI for moving and
 * retagging, since those need the post's category and tags in view. Every
 * action lands in the moderation log; hiding and removing tell the author.
 * Locking the thread is the comment section's own LOCK button.
 */
export function ForumStaffMenu({
  post,
  onRemoved,
}: {
  post: ForumPostDetail;
  onRemoved: () => void;
}) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState(post.category.slug);
  const [tags, setTags] = useState(post.tags);
  const { data: categories } = useQuery({
    ...forumCategoriesQueryOptions(),
    enabled: dialog === "move",
  });

  const done = (message: string) => {
    invalidateForum(queryClient, post.id);
    setDialog(null);
    setReason("");
    toast.success(message);
  };
  const onError = toastMutationError("forum.staff");

  const pin = useMutation({
    mutationFn: (scope: "global" | "category" | null) =>
      client.setForumPostPinned({ postId: post.id, scope }),
    onSuccess: (_result, scope) => done(scope ? "Pinned." : "Unpinned."),
    onError,
  });
  const hide = useMutation({
    mutationFn: (hidden: boolean) =>
      client.setForumPostHidden({
        postId: post.id,
        hidden,
        reason: reason.trim() || undefined,
      }),
    onSuccess: (_result, hidden) =>
      done(hidden ? "Hidden — the author has been told." : "Unhidden."),
    onError,
  });
  const move = useMutation({
    mutationFn: () =>
      client.staffUpdateForumPost({
        postId: post.id,
        category: category !== post.category.slug ? category : undefined,
        tags: tags.join() !== post.tags.join() ? tags : undefined,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => done("Saved."),
    onError,
  });
  const remove = useMutation({
    mutationFn: () =>
      client.staffDeleteForumPost({ postId: post.id, reason: reason.trim() || undefined }),
    onSuccess: () => {
      done("Removed — the author has been told.");
      onRemoved();
    },
    onError,
  });

  const hidden = post.visibility === "hidden";
  const deleted = post.visibility === "deleted";
  const busy = pin.isPending || hide.isPending || move.isPending || remove.isPending;

  const open = (next: Exclude<Dialog, null>) => {
    setReason("");
    setCategory(post.category.slug);
    setTags(post.tags);
    setDialog(next);
  };

  const confirm = () => {
    if (dialog === "hide") hide.mutate(true);
    else if (dialog === "move") move.mutate();
    else if (dialog === "remove") remove.mutate();
  };

  if (deleted) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className="tracking-widest" disabled={busy} />
          }
        >
          <HugeiconsIcon icon={Shield01Icon} />
          STAFF
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {!hidden ? (
            <>
              {post.pinnedScope !== "global" ? (
                <DropdownMenuItem onClick={() => pin.mutate("global")}>
                  Pin to the forum
                </DropdownMenuItem>
              ) : null}
              {post.pinnedScope !== "category" ? (
                <DropdownMenuItem onClick={() => pin.mutate("category")}>
                  Pin in {post.category.name}
                </DropdownMenuItem>
              ) : null}
              {post.pinnedScope ? (
                <DropdownMenuItem onClick={() => pin.mutate(null)}>Unpin</DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem onClick={() => open("move")}>Move or retag…</DropdownMenuItem>
          {hidden ? (
            <DropdownMenuItem onClick={() => hide.mutate(false)}>Unhide</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => open("hide")}>Hide…</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => open("remove")}>
            Remove…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ResponsiveModal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog ? DIALOG_COPY[dialog].title : ""}
        description="A staff action on this forum post, recorded in the moderation log."
        footer={
          <div className="flex justify-end gap-2 border-t border-muted/40 px-5 py-4">
            <Button variant="ghost" size="sm" onClick={() => setDialog(null)}>
              CANCEL
            </Button>
            <Button
              size="sm"
              variant={dialog === "remove" ? "destructive" : "default"}
              onClick={confirm}
              disabled={busy || (dialog === "hide" && !reason.trim())}
              className="tracking-widest"
            >
              {dialog ? DIALOG_COPY[dialog].confirm : ""}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4 px-5 pb-5">
          {dialog === "hide" ? (
            <Text size="sm" variant="muted">
              The post leaves every feed and its page shows a notice. The author sees the reason.
            </Text>
          ) : null}
          {dialog === "remove" ? (
            <Text size="sm" variant="muted">
              The post becomes a tombstone and its images are deleted. The comments stay readable.
            </Text>
          ) : null}
          {dialog === "move" ? (
            <>
              <SelectField
                label="Category"
                value={categories ? category : undefined}
                onChange={setCategory}
                options={(categories ?? []).map((c) => ({ value: c.slug, label: c.name }))}
              />
              <TagInput tags={tags} onChange={setTags} />
            </>
          ) : null}
          <label className="flex flex-col gap-1.5">
            <MicroLabel as="span" className="uppercase">
              {dialog === "hide" ? "Reason (required, shown to the author)" : "Reason (optional)"}
            </MicroLabel>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="e.g. Off-topic self-promotion"
            />
          </label>
        </div>
      </ResponsiveModal>
    </>
  );
}
