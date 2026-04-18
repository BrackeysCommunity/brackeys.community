import { useQuery } from "@tanstack/react-query";

import { usePageSidebar } from "@/lib/hooks/use-page-layout";
import { orpc } from "@/orpc/client";
import { Route } from "@/routes/collab.$postId";

import { CollabPostSidebar } from "./CollabPostSidebar";

const TYPE_COLORS: Record<string, string> = {
  paid: "text-green-500",
  hobby: "text-blue-500",
  playtest: "text-purple-500",
  mentor: "text-brackeys-yellow",
};

const COMP_TYPE_LABELS: Record<string, string> = {
  hourly: "Hourly",
  fixed: "Fixed Price",
  rev_share: "Revenue Share",
  negotiable: "Negotiable",
};

export function CollabPostPage() {
  const { postId } = Route.useParams();
  const numericId = Number(postId);

  const { data: post, isLoading } = useQuery({
    ...orpc.getPost.queryOptions({ input: { postId: numericId } }),
    staleTime: 30 * 1000,
  });

  usePageSidebar(
    <CollabPostSidebar post={post ?? null} isLoading={isLoading} postId={numericId} />,
  );

  const statusLabel = post?.status === "party_full" ? "CLOSED" : "RECRUITING";
  const typeColor = TYPE_COLORS[post?.type ?? ""] ?? "text-muted-foreground";

  // Parse feedback types for playtest posts
  let feedbackTypes: string[] = [];
  if (post?.type === "playtest" && post.experience) {
    try {
      feedbackTypes = JSON.parse(post.experience);
      if (!Array.isArray(feedbackTypes)) feedbackTypes = [];
    } catch {
      feedbackTypes = [];
    }
  }

  return (
    <>
      {/* Status bar */}
      <div className="mb-4 flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground">
        <span className="text-primary">{">"}</span>
        {isLoading ? "LOADING..." : post ? "POST LOADED" : "NOT FOUND"}
        {post && (
          <>
            <span className="mx-2 text-primary">{"//"}</span>
            <span className={typeColor}>{post.type?.toUpperCase()}</span>
            {post.isIndividual && (
              <>
                <span className="mx-2 text-primary">{"//"}</span>
                <span className="text-primary">INDIVIDUAL</span>
              </>
            )}
            <span className="mx-2 text-primary">{"//"}</span>
            <span className={post.status === "party_full" ? "text-destructive" : "text-green-500"}>
              {statusLabel}
            </span>
          </>
        )}
      </div>

      {/* Heading block */}
      <div className="flex flex-col justify-center">
        <h1 className="font-mono text-[clamp(2rem,5vw,6rem)] leading-[0.85] font-bold tracking-tighter text-foreground">
          {isLoading ? (
            <span className="animate-pulse text-muted-foreground">...</span>
          ) : post ? (
            (() => {
              const words = post.title.toUpperCase().split(" ");
              if (words.length <= 1) {
                return (
                  <>
                    {words[0]}
                    <br />
                    <span className="text-transparent transition-colors duration-300 [-webkit-text-stroke:1px_var(--color-primary)] hover:text-primary">
                      POST.
                    </span>
                  </>
                );
              }
              const mid = Math.ceil(words.length / 2);
              const line1 = words.slice(0, mid).join(" ");
              const line2 = words.slice(mid).join(" ");
              return (
                <>
                  {line1}
                  <br />
                  <span className="text-transparent transition-colors duration-300 [-webkit-text-stroke:1px_var(--color-primary)] hover:text-primary">
                    {line2 || "POST."}
                  </span>
                </>
              );
            })()
          ) : (
            <>
              NOT
              <br />
              <span className="text-transparent [-webkit-text-stroke:1px_var(--color-primary)]">
                FOUND.
              </span>
            </>
          )}
        </h1>
        {post && (
          <p className="mt-8 max-w-xl font-sans text-lg whitespace-pre-wrap text-muted-foreground lg:text-xl">
            {post.description}
          </p>
        )}
        {!isLoading && !post && (
          <p className="mt-8 max-w-xl font-sans text-lg text-muted-foreground lg:text-xl">
            This post does not exist or has been deleted.
          </p>
        )}
      </div>

      {/* Post details */}
      {post && (
        <div className="my-6 space-y-4 sm:mt-12">
          {/* Project section */}
          {(post.projectName || post.teamSize || post.projectLength || post.platforms?.length) && (
            <div className="space-y-2">
              <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">
                // Project
              </span>
              {post.projectName && (
                <div className="flex items-center gap-3 font-mono text-sm text-muted-foreground">
                  <span className="text-xs text-primary">PROJECT</span>
                  <span className="text-foreground">{post.projectName}</span>
                </div>
              )}
              {post.platforms && post.platforms.length > 0 && (
                <div className="flex items-center gap-3 font-mono text-sm">
                  <span className="text-xs text-primary">PLATFORMS</span>
                  <div className="flex flex-wrap gap-1">
                    {post.platforms.map((p) => (
                      <span
                        key={p}
                        className="inline-block border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-primary uppercase"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {post.teamSize && (
                <div className="flex items-center gap-3 font-mono text-sm text-muted-foreground">
                  <span className="text-xs text-primary">TEAM</span>
                  <span className="text-foreground">{post.teamSize}</span>
                </div>
              )}
              {post.projectLength && (
                <div className="flex items-center gap-3 font-mono text-sm text-muted-foreground">
                  <span className="text-xs text-primary">
                    {post.type === "playtest" ? "PLAY TIME" : "LENGTH"}
                  </span>
                  <span className="text-foreground">{post.projectLength}</span>
                </div>
              )}
            </div>
          )}

          {/* Compensation section */}
          {(post.compensationType || post.compensation) && (
            <div className="space-y-2">
              <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">
                // Compensation
              </span>
              {post.compensationType && (
                <div className="flex items-center gap-3 font-mono text-sm text-muted-foreground">
                  <span className="text-xs text-green-500">TYPE</span>
                  <span className="inline-block border border-green-500/30 bg-green-500/10 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-green-500 uppercase">
                    {COMP_TYPE_LABELS[post.compensationType] ?? post.compensationType}
                  </span>
                </div>
              )}
              {post.compensation && (
                <div className="flex items-center gap-3 font-mono text-sm text-muted-foreground">
                  <span className="text-xs text-green-500">COMP</span>
                  <span className="text-foreground">{post.compensation}</span>
                </div>
              )}
            </div>
          )}

          {/* Experience section */}
          {post.experienceLevel && (
            <div className="flex items-center gap-3 font-mono text-sm text-muted-foreground">
              <span className="text-xs text-primary">EXP</span>
              <span className="text-foreground capitalize">{post.experienceLevel}</span>
            </div>
          )}

          {/* Playtest-specific: feedback types */}
          {feedbackTypes.length > 0 && (
            <div className="space-y-2">
              <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">
                // Feedback Wanted
              </span>
              <div className="flex flex-wrap gap-1">
                {feedbackTypes.map((ft) => (
                  <span
                    key={ft}
                    className="inline-block border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-purple-500 uppercase"
                  >
                    {ft}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Playtest game link */}
          {post.type === "playtest" && post.portfolioUrl && (
            <div className="flex items-center gap-3 font-mono text-sm">
              <span className="text-xs text-purple-500">GAME</span>
              <a
                href={post.portfolioUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-primary hover:underline"
              >
                {post.portfolioUrl}
              </a>
            </div>
          )}
        </div>
      )}
    </>
  );
}
