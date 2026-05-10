import { Sent02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Text } from "@/components/ui/typography";
import { client, orpc } from "@/orpc/client";

interface CollabPostResponseFormProps {
  postId: number;
}

/**
 * "Apply to this post" inline form — used inside the post popover for
 * non-owner viewers. Submits via `respondToPost` and invalidates the
 * `getPost` cache so the owner sees the new response immediately.
 */
export function CollabPostResponseForm({ postId }: CollabPostResponseFormProps) {
  const [message, setMessage] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const queryClient = useQueryClient();

  const respondMutation = useMutation({
    mutationFn: () =>
      client.respondToPost({
        postId,
        message,
        portfolioUrl: portfolioUrl || undefined,
      }),
    onSuccess: async () => {
      setSuccess(true);
      setMessage("");
      setPortfolioUrl("");
      await queryClient.invalidateQueries({
        queryKey: orpc.getPost.queryOptions({ input: { postId } }).queryKey,
      });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (success) {
    return (
      <Text monospace size="xs" variant="success" className="tracking-widest uppercase">
        Response sent.
      </Text>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Write your application message…"
        rows={4}
        maxLength={2000}
        className="font-mono"
      />
      <Input
        value={portfolioUrl}
        onChange={(e) => setPortfolioUrl(e.target.value)}
        placeholder="Portfolio URL (optional)"
        className="font-mono"
      />
      {error ? (
        <Text monospace size="xs" variant="danger">
          {error}
        </Text>
      ) : null}
      <Button
        variant="default"
        size="sm"
        onClick={() => respondMutation.mutate()}
        disabled={!message.trim() || respondMutation.isPending}
        className="font-mono tracking-widest"
      >
        <HugeiconsIcon icon={Sent02Icon} size={12} />
        {respondMutation.isPending ? "SENDING…" : "SEND RESPONSE"}
      </Button>
    </div>
  );
}
