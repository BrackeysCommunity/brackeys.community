import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";

import { Section, SectionAction } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Censored } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { timeAgo } from "@/lib/format-time";
import { memberName } from "@/lib/member-name";
import { profileLinkParams } from "@/lib/profile-links";
import { client } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

const SIGNUP_LIMIT = 10;

/**
 * The newest members, as an avatar rail.
 *
 * `listMembers` sorted newest-first, not `listAvailableUsers`: the latter
 * is the for-hire slice, so the section that claims to show who just
 * joined was silently skipping everyone who hadn't ticked "open to work".
 *
 * The three-up card grid this replaced spent a 20px-tall card on a tagline
 * nobody had written yet; what a visitor actually reads here is "people
 * keep turning up", which is a face and a name. Rows link to the real
 * profile rather than dumping everyone on `/collab`.
 */
/** Exported so `/`'s loader can put the rail in the document. */
export function newestSignupsQueryOptions() {
  return queryOptions({
    queryKey: ["newest-signups", SIGNUP_LIMIT],
    queryFn: () => client.listMembers({ sort: "newest", limit: SIGNUP_LIMIT, offset: 0 }),
    staleTime: STALE.listing,
  });
}

export function NewestSignups() {
  const { data, isLoading } = useQuery(newestSignupsQueryOptions());

  const users = data?.members ?? [];

  return (
    <Section
      id="devs"
      title="NEWEST DEVS"
      size="sm"
      blurb="Welcome the latest arrivals."
      action={<SectionAction to="/members">BROWSE DEVS</SectionAction>}
    >
      <Well className="overflow-hidden">
        {isLoading ? (
          <ul className="divide-y divide-muted/20" aria-hidden>
            {Array.from({ length: SIGNUP_LIMIT }, (_, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full bg-muted/50" />
                <Skeleton className="h-3.5 w-1/2 bg-muted/50" />
                <Skeleton className="ml-auto h-3 w-12 shrink-0 bg-muted/50" />
              </li>
            ))}
          </ul>
        ) : users.length === 0 ? (
          <Text
            as="div"
            size="sm"
            variant="muted"
            align="center"
            className="p-6 tracking-widest uppercase"
          >
            No signups yet
          </Text>
        ) : (
          <ul className="divide-y divide-muted/20">
            {users.map((u) => {
              const handle = u.discordUsername ?? "anonymous";
              return (
                <li key={u.id}>
                  <RouterLink
                    to="/profile/$userId"
                    params={profileLinkParams(u)}
                    className="group flex items-center gap-3 px-3 py-2 text-inherit transition-colors hover:bg-muted/40"
                  >
                    <UserAvatar avatarUrl={u.avatarUrl} username={handle} shape="round" size={32} />
                    <div className="min-w-0 flex-1">
                      <Text as="div" bold ellipsis size="md" className="group-hover:text-primary">
                        {memberName(u, handle)}
                      </Text>
                      <MicroLabel as="div" ellipsis>
                        {u.tagline ? <Censored>{u.tagline}</Censored> : `@${handle}`}
                      </MicroLabel>
                    </div>
                    {/* When they turned up — the one fact a "newest" list is
                        actually sorted by, so the ordering is legible. */}
                    <MicroLabel className="shrink-0 tabular-nums">
                      {timeAgo(u.createdAt)}
                    </MicroLabel>
                  </RouterLink>
                </li>
              );
            })}
          </ul>
        )}
      </Well>
    </Section>
  );
}
