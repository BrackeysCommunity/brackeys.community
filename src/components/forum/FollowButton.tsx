import { Tick01Icon, UserAdd01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { type ForumFollowTarget, useForumFollow } from "./forum-queries";

/**
 * Follow a team, member, tag, category or series. Following feeds the
 * Following tab, boosts For you, and — for teams, members and series —
 * brings a note when a new devlog goes out.
 */
export function FollowButton({
  type,
  target,
  label = "FOLLOW",
  size = "sm",
  className,
}: {
  type: ForumFollowTarget;
  target: string;
  label?: string;
  size?: "sm" | "xs";
  className?: string;
}) {
  const { following, pending, toggle } = useForumFollow(type, target);
  return (
    <Button
      variant={following ? "secondary" : "outline"}
      size={size}
      onClick={toggle}
      disabled={pending}
      aria-pressed={following}
      className={cn("tracking-widest", className)}
    >
      <HugeiconsIcon icon={following ? Tick01Icon : UserAdd01Icon} />
      {following ? "FOLLOWING" : label}
    </Button>
  );
}
