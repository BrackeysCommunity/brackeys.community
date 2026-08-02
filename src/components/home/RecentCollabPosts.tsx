import { useQuery } from "@tanstack/react-query";

import { Chonk } from "@/components/ui/chonk";
import { Skeleton } from "@/components/ui/skeleton";
import { Heading, Link, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { formatRate } from "@/lib/format-rate";
import { client } from "@/orpc/client";

const POST_LIMIT = 3;

function postKindLabel(type: string | null | undefined) {
  switch (type) {
    case "paid":
      return "PAID";
    case "hobby":
      return "HOBBY";
    case "playtest":
      return "PLAYTEST";
    case "mentor":
      return "MENTOR";
    default:
      return "POST";
  }
}

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
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-end justify-between gap-3">
          <div>
            <Text as="div" size="xs" variant="muted" className="tracking-widest">
              § 02
            </Text>
            <Heading as="h2" className="text-2xl md:text-3xl">
              RECENT COLLAB POSTS
            </Heading>
          </div>
          <Link
            as="router"
            to="/collab"
            bold
            variant="muted"
            className="shrink-0 text-[11px] tracking-widest whitespace-nowrap"
          >
            OPEN BOARD ▸
          </Link>
        </div>
        <Text as="p" size="md" variant="muted">
          The latest roles off the collab board.
        </Text>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        {isLoading ? (
          Array.from({ length: POST_LIMIT }).map((_, i) => (
            <Well key={i} className="p-0" aria-hidden>
              <Skeleton className="h-36 w-full bg-muted/50" />
            </Well>
          ))
        ) : posts.length === 0 ? (
          <Well variant="ghost" className="col-span-full">
            <Text
              as="div"
              size="sm"
              variant="muted"
              align="center"
              className="p-6 tracking-widest uppercase"
            >
              No posts yet
            </Text>
          </Well>
        ) : (
          posts.map((post) => {
            const comp = compensationLabel(post);
            return (
              <Chonk
                key={post.id}
                variant="surface"
                render={<Link as="router" to="/collab" aria-label={post.title} />}
                className="group flex flex-col gap-3 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <Text bold size="xs" variant="accent" className="tracking-widest uppercase">
                    {postKindLabel(post.type)}
                  </Text>
                  <Text bold size="xs" variant="muted" className="tracking-widest uppercase">
                    #{post.id}
                  </Text>
                </div>
                <Heading
                  as="h3"
                  size="sm"
                  className="line-clamp-2 leading-snug group-hover:text-primary"
                >
                  {post.title}
                </Heading>
                {post.description && (
                  <Text as="p" variant="muted" className="line-clamp-2 text-[11px]">
                    {post.description}
                  </Text>
                )}
                <div className="mt-auto flex flex-wrap gap-2">
                  {post.experienceLevel && (
                    <Text size="xs" variant="muted" className="tracking-widest uppercase">
                      {post.experienceLevel}
                    </Text>
                  )}
                  {comp && (
                    <Text size="xs" variant="muted" className="tracking-widest uppercase">
                      · {comp}
                    </Text>
                  )}
                </div>
              </Chonk>
            );
          })
        )}
      </div>
    </section>
  );
}
