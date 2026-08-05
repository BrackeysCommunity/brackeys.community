import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Section, SectionAction } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { formatRate } from "@/lib/format-rate";
import { timeAgo } from "@/lib/format-time";
import { client } from "@/orpc/client";

/** Rows in the ticker. Six reads as a feed; three read as three cards
 * that happened to be next to each other. */
const POST_LIMIT = 6;

type PostBadge = { label: string; variant: "default" | "secondary" | "outline" };

const POST_KIND: Record<string, PostBadge> = {
  paid: { label: "PAID", variant: "default" },
  hobby: { label: "HOBBY", variant: "secondary" },
  playtest: { label: "PLAYTEST", variant: "outline" },
  mentor: { label: "MENTOR", variant: "outline" },
};

const FALLBACK_KIND: PostBadge = { label: "POST", variant: "outline" };

function compensationLabel(post: {
  compensationType?: string | null;
  compensation?: string | null;
  compensationMin?: number | null;
  compensationMax?: number | null;
}) {
  // Posts created since v1 carry numbers; `compensation` is the legacy
  // display string pre-v1 rows still hold.
  const rate = formatRate(post.compensationType, post.compensationMin, post.compensationMax);
  if (rate) return rate;
  if (post.compensation) return post.compensation;
  switch (post.compensationType) {
    case "rev_share":
      return "Rev share";
    case "fixed":
      return "Fixed";
    case "hourly":
      return "Hourly";
    case "unpaid":
      return "Unpaid";
    default:
      return null;
  }
}

/**
 * The collab board's latest roles, as a ticker.
 *
 * Three tall cards gave a three-role sample the visual weight of a whole
 * section while saying less than six scannable rows do — the thing that
 * makes the board look alive is the *rate* of postings, which a feed
 * shows and a card grid hides.
 */
export function RecentCollabPosts() {
  const { data, isLoading } = useQuery({
    queryKey: ["recent-collab-posts", POST_LIMIT],
    queryFn: () =>
      client.listPosts({
        sortBy: "createdAt",
        sortOrder: "desc",
        limit: POST_LIMIT,
        offset: 0,
      }),
    staleTime: 60 * 1000,
  });

  const posts = data?.posts ?? [];

  return (
    <Section
      id="collab"
      title="COLLAB BOARD"
      blurb="The latest roles off the board."
      action={<SectionAction to="/collab">OPEN BOARD</SectionAction>}
    >
      <Well className="overflow-hidden">
        {isLoading ? (
          <ul className="divide-y divide-muted/20" aria-hidden>
            {Array.from({ length: POST_LIMIT }, (_, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2.5">
                <Skeleton className="h-4 w-14 shrink-0 bg-muted/50" />
                <Skeleton className="h-3.5 flex-1 bg-muted/50" />
                <Skeleton className="h-3 w-16 shrink-0 bg-muted/50" />
              </li>
            ))}
          </ul>
        ) : posts.length === 0 ? (
          <Text
            as="div"
            size="sm"
            variant="muted"
            align="center"
            className="p-6 tracking-widest uppercase"
          >
            No posts yet
          </Text>
        ) : (
          <ul className="divide-y divide-muted/20">
            {posts.map((post) => {
              const kind = POST_KIND[post.type ?? ""] ?? FALLBACK_KIND;
              const comp = compensationLabel(post);
              return (
                <li key={post.id}>
                  <RouterLink
                    to="/collab/$postId"
                    params={{ postId: String(post.id) }}
                    className="group flex items-center gap-3 px-3 py-2.5 text-inherit transition-colors hover:bg-muted/40"
                  >
                    <Badge variant={kind.variant} size="label" className="shrink-0">
                      {kind.label}
                    </Badge>

                    <Text
                      as="div"
                      bold
                      ellipsis
                      size="md"
                      className="min-w-0 flex-1 group-hover:text-primary"
                    >
                      {post.title}
                    </Text>

                    {comp && (
                      <MicroLabel as="div" variant="accent" className="hidden shrink-0 sm:block">
                        {comp}
                      </MicroLabel>
                    )}
                    {post.experienceLevel && (
                      <MicroLabel as="div" className="hidden shrink-0 uppercase md:block">
                        {post.experienceLevel}
                      </MicroLabel>
                    )}
                    <MicroLabel as="div" className="w-16 shrink-0 text-right">
                      {timeAgo(post.createdAt)}
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
