import { ArrowRight02Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Chonk } from "@/components/ui/chonk";
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
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] tracking-widest text-muted-foreground">§ 02</div>
          <h2 className="font-mono text-3xl font-bold tracking-tight">RECENT COLLAB POSTS</h2>
          <p className="mt-1 font-sans text-sm text-muted-foreground">
            Latest roles, playtests, and mentorships off the collab board.
          </p>
        </div>
        <Chonk
          variant="surface"
          size="sm"
          render={<Link to="/collab" aria-label="Open board" />}
          className="flex items-center gap-2 px-3 py-2 font-mono text-[11px] font-bold tracking-widest text-muted-foreground"
        >
          <HugeiconsIcon icon={UserGroupIcon} size={14} />
          OPEN BOARD
          <HugeiconsIcon icon={ArrowRight02Icon} size={12} />
        </Chonk>
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
            <div className="p-6 text-center font-mono text-xs tracking-widest text-muted-foreground uppercase">
              No posts yet
            </div>
          </Well>
        ) : (
          posts.map((post) => {
            const comp = compensationLabel(post);
            return (
              <Chonk
                key={post.id}
                variant="surface"
                render={<Link to="/collab" aria-label={post.title} />}
                className="group flex flex-col gap-3 p-4"
              >
                <div className="flex items-center justify-between gap-2 font-mono text-[10px] font-bold tracking-widest uppercase">
                  <span className="text-primary">{postKindLabel(post.type)}</span>
                  <span className="text-muted-foreground">#{post.id}</span>
                </div>
                <h3 className="line-clamp-2 font-sans text-sm leading-snug font-bold text-foreground group-hover:text-primary">
                  {post.title}
                </h3>
                {post.description && (
                  <p className="line-clamp-2 font-mono text-[11px] text-muted-foreground">
                    {post.description}
                  </p>
                )}
                <div className="mt-auto flex flex-wrap gap-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                  {post.experienceLevel && <span>{post.experienceLevel}</span>}
                  {comp && <span>· {comp}</span>}
                </div>
              </Chonk>
            );
          })
        )}
      </div>
    </section>
  );
}
