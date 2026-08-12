import { useMutation, useQueryClient } from "@tanstack/react-query";

import { client, orpc } from "@/orpc/client";

/**
 * The owner/viewer mutations every post surface shares — the board's
 * inspector, the mobile drawer, and the dedicated page all close, reopen,
 * extend, delete, and report a post the same way, and all refresh the
 * same `getPost` cache entry afterwards.
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
  const report = useMutation({
    mutationFn: (reason: string) => client.reportPost({ postId, reason }),
  });

  return { close, reopen, extend, remove, report };
}
