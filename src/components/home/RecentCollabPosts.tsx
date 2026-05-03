import { useQuery } from "@tanstack/react-query";

import { Chonk } from "@/components/ui/chonk";
import { Heading, Link, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
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
}) {
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
            <Text as="div" monospace size="xs" variant="muted" className="tracking-widest">
              § 02
            </Text>
            <Heading as="h2" monospace className="text-2xl md:text-3xl">
              RECENT COLLAB POSTS
            </Heading>
          </div>
          <Link
            as="router"
            to="/collab"
            monospace
            bold
            variant="muted"
            className="shrink-0 text-[11px] tracking-widest whitespace-nowrap"
          >
            OPEN BOARD ▸
          </Link>
        </div>
        <Text as="p" size="md" variant="muted">
          Latest roles, playtests, and mentorships off the collab board.
        </Text>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        {isLoading ? (
          Array.from({ length: POST_LIMIT }).map((_, i) => (
            <Well key={i} className="h-36 animate-pulse" aria-hidden>
              <span />
            </Well>
          ))
        ) : posts.length === 0 ? (
          <Well variant="ghost" className="col-span-full">
            <Text
              as="div"
              monospace
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
                  <Text
                    monospace
                    bold
                    size="xs"
                    variant="accent"
                    className="tracking-widest uppercase"
                  >
                    {postKindLabel(post.type)}
                  </Text>
                  <Text
                    monospace
                    bold
                    size="xs"
                    variant="muted"
                    className="tracking-widest uppercase"
                  >
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
                  <Text as="p" monospace variant="muted" className="line-clamp-2 text-[11px]">
                    {post.description}
                  </Text>
                )}
                <div className="mt-auto flex flex-wrap gap-2">
                  {post.experienceLevel && (
                    <Text monospace size="xs" variant="muted" className="tracking-widest uppercase">
                      {post.experienceLevel}
                    </Text>
                  )}
                  {comp && (
                    <Text monospace size="xs" variant="muted" className="tracking-widest uppercase">
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
