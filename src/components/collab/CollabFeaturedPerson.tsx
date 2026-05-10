import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { orpc } from "@/orpc/client";

/**
 * Right-rail featured person card — surfaces the most-recent available
 * user as a quick-look profile teaser with a "VIEW PROFILE" action
 * that deep-links into the profile page.
 */
export function CollabFeaturedPerson() {
  const { data } = useQuery({
    ...orpc.listAvailableUsers.queryOptions({ input: { limit: 1, offset: 0 } }),
    staleTime: 60 * 1000,
  });
  const user = data?.users?.[0];
  if (!user) return null;

  return (
    <Well className="gap-3 p-4">
      <div className="flex items-start gap-3">
        <Avatar className="h-9 w-9 shrink-0 rounded-none border border-muted/40">
          {user.avatarUrl ? (
            <AvatarImage src={user.avatarUrl} alt="" />
          ) : (
            <AvatarFallback className="rounded-none bg-muted/40 font-mono text-xs font-bold">
              {(user.discordUsername ?? "?")[0]?.toUpperCase()}
            </AvatarFallback>
          )}
        </Avatar>
        <div className="flex min-w-0 flex-col">
          <Text size="sm" bold className="truncate text-foreground">
            {user.discordUsername ?? "Unknown"}
          </Text>
          <Text monospace size="xs" variant="muted">
            @{user.discordUsername?.toLowerCase() ?? "user"}
            {user.availability ? ` · ${user.availability}` : ""}
          </Text>
        </div>
      </div>
      {user.tagline ? (
        <Text size="sm" variant="muted" className="line-clamp-3">
          {user.tagline}
        </Text>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        render={
          <Link
            to="/profile/$userId"
            params={{ userId: user.id }}
            className="w-full justify-between font-mono tracking-widest"
          />
        }
      >
        VIEW PROFILE
        <HugeiconsIcon icon={ArrowRight01Icon} size={12} />
      </Button>
    </Well>
  );
}
