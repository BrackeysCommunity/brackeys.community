import { CheckListIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { teamLinkParams } from "@/lib/team-links";

import { useAttention } from "./use-attention";

/**
 * The header's outstanding-actions count, beside the notification bell.
 *
 * The two are not the same badge and must not read as one. The bell counts
 * events you haven't looked at and empties when you look; this counts
 * decisions only you can make and empties only when you make them. Opening
 * the popover deliberately clears nothing — that's what the copy at the top
 * says out loud, because a badge that behaves unlike its neighbour needs to
 * say so once rather than be discovered.
 *
 * It renders nothing at zero. An always-present icon that is empty for most
 * members is a second bell in the chrome charging rent for nothing; this is
 * an action queue, so it appears when there is a queue.
 */
export function AttentionMenu() {
  const [open, setOpen] = useState(false);
  const { count, visibleInvites, visibleTriage } = useAttention();

  if (count === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`${count} ${count === 1 ? "thing needs" : "things need"} you`}
        render={<Button variant="outline" size="icon-lg" className="relative" />}
      >
        <HugeiconsIcon icon={CheckListIcon} size={16} />
        <span
          data-testid="attention-badge"
          className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 font-mono text-[9px] font-bold text-warning-foreground"
        >
          {count > 99 ? "99+" : count}
        </span>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={8} className="w-80 gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <MicroLabel variant="warning" bold>
            NEEDS YOU
          </MicroLabel>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {visibleInvites.map((invite) => (
            <Link
              key={`invite-${invite.id}`}
              to="/teams/$teamId"
              params={teamLinkParams(invite.team)}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 border-b border-border/50 px-3 py-2 text-inherit transition-colors last:border-b-0 hover:bg-muted/40"
            >
              <UserAvatar avatarUrl={invite.team.avatarUrl} username={invite.team.name} size={22} />
              <div className="min-w-0 flex-1">
                <Text as="div" size="sm" ellipsis>
                  {invite.team.name}
                </Text>
                <MicroLabel as="div">INVITED YOU</MicroLabel>
              </div>
              <Badge variant="warning" size="label" className="shrink-0">
                ANSWER
              </Badge>
            </Link>
          ))}

          {visibleTriage.map((post) => (
            <Link
              key={`post-${post.id}`}
              to="/collab/$postId"
              params={{ postId: String(post.id) }}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 border-b border-border/50 px-3 py-2 text-inherit transition-colors last:border-b-0 hover:bg-muted/40"
            >
              <div className="min-w-0 flex-1">
                <Text as="div" size="sm" ellipsis>
                  {post.title}
                </Text>
                <MicroLabel as="div">{post.pendingResponseCount} WAITING ON YOU</MicroLabel>
              </div>
              <Badge variant="warning" size="label" className="shrink-0">
                REVIEW
              </Badge>
            </Link>
          ))}
        </div>

        <div className="border-t border-border px-3 py-2 text-center">
          <Link
            to="/"
            onClick={() => setOpen(false)}
            className="transition-colors hover:text-primary"
          >
            <MicroLabel>OPEN DASHBOARD</MicroLabel>
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
