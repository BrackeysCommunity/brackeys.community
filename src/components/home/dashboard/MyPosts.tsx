import { useMutation } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Section, SectionAction } from "@/components/ui/section";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { errorMessage } from "@/lib/error-message";
import useDateNow from "@/lib/hooks/use-date-now";
import { formatCountdown } from "@/lib/jam-countdown";
import { reportMutationError } from "@/lib/posthog";
import { client } from "@/orpc/client";

import { isExpiringSoon } from "./dashboard-derive";
import type { HomeDashboardData } from "./use-home-dashboard";

const STATUS_VARIANT: Record<string, "success" | "secondary" | "outline"> = {
  recruiting: "success",
  party_full: "secondary",
  expired: "outline",
};

const STATUS_LABEL: Record<string, string> = {
  recruiting: "OPEN",
  party_full: "CLOSED",
  expired: "EXPIRED",
};

/**
 * The viewer's own posts, open ones first. The countdown and the inline
 * EXTEND are the point: the lifecycle sweep's "closes in 3 days" notice was
 * the only place a post's remaining window appeared, and answering it meant
 * finding the post to press EXTEND on it.
 */
export function MyPosts({
  posts,
  onExtended,
}: {
  posts: HomeDashboardData["posts"];
  onExtended: () => void;
}) {
  const now = useDateNow();
  if (posts.length === 0) return null;

  return (
    <Section
      title="YOUR POSTS"
      size="sm"
      blurb="What you're recruiting for."
      action={<SectionAction to="/collab">OPEN BOARD</SectionAction>}
    >
      <Well className="overflow-hidden">
        <ul className="divide-y divide-muted/20">
          {posts.map((post) => (
            <li key={post.id} className="flex items-center gap-3 px-3 py-2.5">
              <Badge
                variant={STATUS_VARIANT[post.status] ?? "outline"}
                size="label"
                className="shrink-0"
              >
                {STATUS_LABEL[post.status] ?? post.status.toUpperCase()}
              </Badge>

              <div className="min-w-0 flex-1">
                <RouterLink
                  to="/collab/$postId"
                  params={{ postId: String(post.id) }}
                  className="text-inherit"
                >
                  <Text as="div" bold ellipsis size="md" className="hover:text-primary">
                    {post.title}
                  </Text>
                </RouterLink>
                <MicroLabel as="div" ellipsis>
                  {post.responseCount === 0
                    ? "NO APPLICANTS YET"
                    : `${post.responseCount} APPLICANT${post.responseCount === 1 ? "" : "S"}` +
                      (post.pendingResponseCount > 0
                        ? ` · ${post.pendingResponseCount} TO REVIEW`
                        : "")}
                </MicroLabel>
              </div>

              <PostExpiry post={post} now={new Date(now)} onExtended={onExtended} />
            </li>
          ))}
        </ul>
      </Well>
    </Section>
  );
}

/**
 * Countdown, or the EXTEND lever once the post is inside the nudge window.
 * `extendPost` is the same call the post's own owner controls make.
 */
function PostExpiry({
  post,
  now,
  onExtended,
}: {
  post: HomeDashboardData["posts"][number];
  now: Date;
  onExtended: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const extend = useMutation({
    mutationFn: () => client.extendPost({ postId: post.id }),
    onSuccess: () => {
      setError(null);
      onExtended();
    },
    onError: (err) => {
      reportMutationError(err, "collab.post_extend");
      setError(errorMessage(err, "Could not extend the post."));
    },
  });

  if (post.status !== "recruiting") return null;

  if (isExpiringSoon(post, now)) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        {error ? (
          <Text size="xs" className="text-destructive">
            {error}
          </Text>
        ) : (
          <MicroLabel variant="warning" className="tabular-nums">
            {countdownLabel(post.expiresAt, now)}
          </MicroLabel>
        )}
        <Button
          size="xs"
          variant="outline"
          className="tracking-widest"
          disabled={extend.isPending}
          onClick={() => extend.mutate()}
        >
          EXTEND
        </Button>
      </div>
    );
  }

  const countdown = formatCountdown(post.expiresAt, now);
  if (!countdown || countdown.past) return null;
  return (
    <MicroLabel as="div" className="w-16 shrink-0 text-right tabular-nums">
      {countdown.text}
    </MicroLabel>
  );
}

function countdownLabel(expiresAt: string | Date | null, now: Date): string {
  const countdown = formatCountdown(expiresAt, now);
  if (!countdown) return "";
  return countdown.past ? "CLOSING" : `${countdown.text} LEFT`;
}
