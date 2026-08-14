import { BubbleChatIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { CommentThread } from "@/components/comments/CommentThread";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";

/**
 * The private Q&A channel on one application, visible only to the post
 * author and the responder (staff can read it; the report queue is why).
 *
 * Collapsed by default and on both sides of the match: the author opens it
 * from the applicant row, the responder from their own status card. It
 * loads nothing until opened — the count comes from the response payload
 * that was already fetched, so a triage list of twenty applicants costs one
 * query rather than twenty.
 */
export function ResponseThreadPanel({
  responseId,
  commentCount,
  counterpartyLabel,
}: {
  responseId: number;
  commentCount: number;
  /** Who is on the other end, for the empty state ("Ask @foo a question"). */
  counterpartyLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        variant="outline"
        size="xs"
        onClick={() => setOpen(true)}
        className="self-start tracking-widest"
      >
        <HugeiconsIcon icon={BubbleChatIcon} size={11} />
        {commentCount > 0 ? `PRIVATE THREAD · ${commentCount}` : "ASK A QUESTION"}
      </Button>
    );
  }

  return (
    <CommentThread
      subject={{ type: "collab_response", id: responseId }}
      maxLength={500}
      placeholder={counterpartyLabel ? `Ask ${counterpartyLabel} a question…` : "Ask a question…"}
      emptyLabel="NOTHING ASKED YET"
      emptyHint="Only the two of you can see this."
      shell={(content, count) => (
        <div className="flex flex-col gap-2 border-l-2 border-dashed border-muted/50 pl-3">
          <div className="flex items-center justify-between gap-2">
            <Text size="xs" variant="muted" className="tracking-widest uppercase">
              Private thread{count > 0 ? ` · ${count}` : ""}
            </Text>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setOpen(false)}
              className="tracking-widest"
            >
              HIDE
            </Button>
          </div>
          {content}
        </div>
      )}
    />
  );
}
