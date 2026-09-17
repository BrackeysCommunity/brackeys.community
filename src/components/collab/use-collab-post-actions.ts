import { useMutation, useQueryClient } from "@tanstack/react-query";

import { toastMutationError } from "@/lib/mutation-errors";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";

/**
 * The owner/viewer mutations the post page and its actions share — close,
 * reopen, extend, delete, report, and mirror a post the same way, and all
 * refresh the same `getPost` cache entry afterwards.
 */
export function useCollabPostActions(postId: number, opts: { onDeleted?: () => void } = {}) {
  const queryClient = useQueryClient();
  const { queryKey } = orpc.getPost.queryOptions({ input: { postId } });
  const invalidatePost = () => queryClient.invalidateQueries({ queryKey });

  const close = useMutation({
    mutationFn: () => client.closePost({ postId }),
    onSuccess: invalidatePost,
  });
  const reopen = useMutation({
    mutationFn: () => client.reopenPost({ postId }),
    onSuccess: invalidatePost,
  });
  const extend = useMutation({
    mutationFn: () => client.extendPost({ postId }),
    onSuccess: invalidatePost,
  });
  const remove = useMutation({
    mutationFn: () => client.deletePost({ postId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["listPosts"] });
      opts.onDeleted?.();
    },
  });
  // The mirror's state (shared / not, and the message link) rides the
  // owner-only viewer state, so that is what has to be re-read — not the
  // post itself, which carries none of it.
  const { queryKey: viewerStateKey } = orpc.getPostViewerState.queryOptions({ input: { postId } });
  const shareToDiscord = useMutation({
    mutationFn: () => client.shareToDiscord({ postId }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: viewerStateKey });
      toast.success("Posted to the Discord collab feed.", {
        description: "Edit the post here and the message follows.",
        // `location.href`, not `window.open`: the URL is a `discord://` app
        // link, and a new tab opened for a custom scheme is left blank
        // behind the handoff. Assigning it hands off without navigating.
        action: result.messageUrl
          ? {
              label: "OPEN",
              onClick: () => {
                window.location.href = result.messageUrl;
              },
            }
          : undefined,
      });
    },
    onError: toastMutationError("collab.share_to_discord"),
  });
  const report = useMutation({
    mutationFn: (reason: string) => client.reportPost({ postId, reason }),
    // Duplicate reports and rate limits both come back as errors; without
    // this the dialog would just close as if the report had landed.
    onError: toastMutationError("collab.report"),
  });

  return { close, reopen, extend, remove, report, shareToDiscord };
}
