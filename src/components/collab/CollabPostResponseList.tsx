import { LinkSquare01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { client, orpc } from "@/orpc/client";

interface ResponseItem {
  id: number;
  responderId: string;
  message: string;
  portfolioUrl: string | null;
  status: string;
  createdAt: string | Date | null;
  responderUsername: string | null;
  responderAvatar: string | null;
}

interface CollabPostResponseListProps {
  responses: ResponseItem[];
  postId: number;
}

const STATUS_VARIANT: Record<string, "success" | "destructive" | "warning"> = {
  accepted: "success",
  declined: "destructive",
  pending: "warning",
};

/**
 * Owner-only list of responses to a post — each row is a `Well`
 * (debossed) carrying the responder's avatar + handle, message, and
 * optional accept/decline actions for pending entries.
 */
export function CollabPostResponseList({ responses, postId }: CollabPostResponseListProps) {
  const queryClient = useQueryClient();

  const updateStatus = useMutation({
    mutationFn: ({ responseId, status }: { responseId: number; status: "accepted" | "declined" }) =>
      client.updateResponseStatus({ responseId, status }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: orpc.getPost.queryOptions({ input: { postId } }).queryKey,
      }),
  });

  return (
    <div className="flex flex-col gap-2">
      {responses.map((resp) => (
        <Well key={resp.id} className="gap-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Avatar className="h-6 w-6 rounded-none border border-muted/40">
                {resp.responderAvatar ? (
                  <AvatarImage src={resp.responderAvatar} alt="" />
                ) : (
                  <AvatarFallback className="rounded-none bg-muted/40 font-mono text-[10px] font-bold">
                    {(resp.responderUsername ?? "?")[0]?.toUpperCase()}
                  </AvatarFallback>
                )}
              </Avatar>
              <Text monospace size="xs" className="truncate">
                {resp.responderUsername
                  ? `@${resp.responderUsername}`
                  : resp.responderId.slice(0, 8)}
              </Text>
            </div>
            <Badge
              variant={STATUS_VARIANT[resp.status] ?? "outline"}
              className="font-mono text-[10px] tracking-widest uppercase"
            >
              {resp.status}
            </Badge>
          </div>
          <Text size="sm" className="whitespace-pre-wrap text-foreground/90">
            {resp.message}
          </Text>
          {resp.portfolioUrl ? (
            <a
              href={resp.portfolioUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-xs text-primary hover:underline"
            >
              <HugeiconsIcon icon={LinkSquare01Icon} size={11} />
              Portfolio
            </a>
          ) : null}
          {resp.status === "pending" ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="xs"
                onClick={() => updateStatus.mutate({ responseId: resp.id, status: "accepted" })}
                disabled={updateStatus.isPending}
                className="font-mono tracking-widest"
              >
                ACCEPT
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={() => updateStatus.mutate({ responseId: resp.id, status: "declined" })}
                disabled={updateStatus.isPending}
                className="font-mono tracking-widest"
              >
                DECLINE
              </Button>
            </div>
          ) : null}
        </Well>
      ))}
    </div>
  );
}
