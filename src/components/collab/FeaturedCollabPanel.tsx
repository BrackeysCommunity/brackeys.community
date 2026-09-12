import { ArrowRight01Icon, StarIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { JamCarouselDots } from "@/components/home/jam-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DotGrid } from "@/components/ui/dot-grid";
import { HoverPlayImage } from "@/components/ui/hover-play-image";
import { MediaCardImage, MediaCardScrim } from "@/components/ui/media-card";
import { Skeleton } from "@/components/ui/skeleton";
import { TransformedImage } from "@/components/ui/transformed-image";
import { Censored, Heading, MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { compensationLabelShort, postTypeLabelShort } from "@/lib/collab-vocabulary";
import { timeAgo } from "@/lib/format-time";
import { useReducedMotion } from "@/lib/hooks/use-app-settings";
import { EASE_OUT } from "@/lib/motion";
import { profileLinkParams } from "@/lib/profile-links";
import { projectLinkParams, projectTypeLabel } from "@/lib/project-links";
import { teamLinkParams } from "@/lib/team-links";
import { client, orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { CrewTile } from "./CrewTile";

/** How many staff picks the rotation carries. */
const FEATURED_LIMIT = 5;
/** How long each slide holds before the panel advances. */
const SLIDE_MS = 9000;
/** The art strip, in pixels — the jam panel's compact banner height. */
const BANNER_HEIGHT = 144;
/** Chips before a row says "+N". */
const MAX_CHIPS = 4;

const CROSSFADE = { duration: 0.15, ease: EASE_OUT };
const INSTANT = { duration: 0 };

type FeaturedPost = Awaited<ReturnType<typeof client.listPosts>>["posts"][number];

/**
 * The staff picks currently recruiting, for the board's side panel. Keyed
 * through orpc so the admin's feature toggle invalidates it along with
 * everything else that lists posts.
 */
export function featuredCollabPostsQueryOptions() {
  return {
    ...orpc.listPosts.queryOptions({
      input: { featured: true, status: "recruiting", limit: FEATURED_LIMIT },
    }),
    staleTime: STALE.board,
  };
}

export function useFeaturedCollabPosts() {
  const query = useQuery(featuredCollabPostsQueryOptions());
  return { posts: query.data?.posts ?? [], isLoading: query.isLoading };
}

export function FeaturedCollabPanelSkeleton() {
  return (
    <Well className="overflow-hidden">
      <Skeleton className="w-full bg-muted/50" style={{ height: BANNER_HEIGHT }} aria-hidden />
      <div className="flex flex-col gap-3 p-4" aria-hidden>
        <Skeleton className="h-3 w-1/3 bg-muted/50" />
        <Skeleton className="h-6 w-2/3 bg-muted/50" />
        <Skeleton className="h-12 w-full bg-muted/50" />
        <Skeleton className="h-10 w-full bg-muted/50" />
      </div>
    </Well>
  );
}

/** Chips with a "+N" tail past the cap. */
function ChipRow({
  items,
  variant,
}: {
  items: { id: number; name: string }[];
  variant: "outline" | "secondary";
}) {
  const shown = items.slice(0, MAX_CHIPS);
  const left = items.length - shown.length;
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((item) => (
        <Badge key={item.id} variant={variant} size="label">
          {item.name.toUpperCase()}
        </Badge>
      ))}
      {left > 0 ? (
        <Text as="span" size="xs" variant="muted" className="tracking-widest">
          +{left}
        </Text>
      ) : null}
    </div>
  );
}

/**
 * The board's right column: the featured posts one at a time, on the
 * same frame as the jam board's panel — art strip, the rest of the art,
 * the terms, the pitch, who they need, and who is behind it. The listing
 * row paints the frame at once; the post's own record fills in the crew,
 * the roles, and the extra images as it lands (and warms the page the
 * button leads to). With more than one pick the panel advances itself,
 * paused while the pointer is over it and under reduced motion.
 */
export function FeaturedCollabPanel({ posts }: { posts: FeaturedPost[] }) {
  const [slide, setSlide] = useState(0);
  const [hovered, setHovered] = useState(false);
  const reduced = useReducedMotion();
  const crossfade = reduced ? INSTANT : CROSSFADE;

  // Modulo at read time: an unpin can shrink the deck under a live index.
  const post = posts[slide % posts.length]!;

  const { data: detail } = useQuery({
    ...orpc.getPost.queryOptions({ input: { postId: post.id } }),
    staleTime: STALE.board,
  });
  const extraImages = detail?.images.slice(1) ?? [];
  const author = detail?.author ?? null;
  const team = detail?.team ?? post.team;
  const project = detail?.project ?? post.project;
  const byline = author
    ? `@${author.discordUsername ?? "unknown"}`
    : (post.team?.name ?? (post.isIndividual ? "Solo dev" : null));

  const rotating = posts.length > 1 && !reduced && !hovered;
  useEffect(() => {
    if (!rotating) return;
    const timer = setTimeout(() => setSlide((slide + 1) % posts.length), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [rotating, slide, posts.length]);

  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <Well notchOpts className="flex flex-col overflow-hidden">
        <div
          className="relative shrink-0 overflow-hidden bg-muted/20"
          style={{ height: BANNER_HEIGHT }}
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={post.id}
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, x: -32 }}
              transition={reduced ? INSTANT : { duration: 0.3, ease: EASE_OUT }}
              className="absolute inset-0"
            >
              {post.primaryImageUrl ? <MediaCardImage src={post.primaryImageUrl} /> : <DotGrid />}
            </motion.div>
          </AnimatePresence>
          <MediaCardScrim />
          <div className="pointer-events-none absolute top-3 left-3 z-20">
            <Badge variant="warning" size="label" className="gap-1">
              <HugeiconsIcon icon={StarIcon} size={10} />
              FEATURED
            </Badge>
          </div>
          {posts.length > 1 && (
            <JamCarouselDots
              slides={posts.map((p) => ({ jamId: p.id, title: p.title }))}
              active={slide % posts.length}
              onSelect={setSlide}
              countdown={{ durationMs: SLIDE_MS, running: rotating }}
              className="absolute bottom-3 left-3 z-20"
            />
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={post.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={crossfade}
              className="flex flex-col gap-4"
            >
              {extraImages.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {extraImages.map((img) => (
                    <TransformedImage
                      key={img.id}
                      src={img.url}
                      transform={{ width: 192 }}
                      alt={img.alt ?? ""}
                      loading="lazy"
                      decoding="async"
                      className="h-16 shrink-0 border border-muted/40 object-cover"
                    />
                  ))}
                </div>
              ) : null}

              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-1">
                  <Badge variant="secondary" size="label">
                    {postTypeLabelShort(post.type).toUpperCase()}
                  </Badge>
                  {post.compensationType ? (
                    <Badge variant="success" size="label">
                      {compensationLabelShort(post.compensationType).toUpperCase()}
                    </Badge>
                  ) : null}
                  {post.jam ? (
                    <Badge variant="warning" size="label" className="max-w-40">
                      <span className="truncate">{post.jam.title.toUpperCase()}</span>
                    </Badge>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1">
                  <Heading as="h2" size="xl" className="line-clamp-2 leading-tight uppercase">
                    {post.title}
                  </Heading>
                  {byline ? <MicroLabel as="div">{byline}</MicroLabel> : null}
                </div>

                <Text size="sm" variant="muted" className="line-clamp-3" textWrap="pretty">
                  <Censored>{post.description}</Censored>
                </Text>
              </div>

              {(detail?.roles.length ?? 0) > 0 || post.skills.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <MicroLabel as="div">WHO THEY NEED</MicroLabel>
                  <ChipRow items={detail?.roles ?? []} variant="secondary" />
                  <ChipRow items={post.skills} variant="outline" />
                </div>
              ) : null}

              {author || team || project ? (
                <div className="flex flex-col gap-2">
                  <MicroLabel as="div">BEHIND THE POST</MicroLabel>
                  {author ? (
                    <CrewTile
                      label="POSTED BY"
                      title={`@${author.discordUsername ?? "unknown"}`}
                      caption={author.tagline}
                      avatar={
                        <UserAvatar
                          avatarUrl={author.avatarUrl}
                          username={author.discordUsername}
                          size={40}
                        />
                      }
                      link={
                        <Link
                          to="/profile/$userId"
                          params={profileLinkParams(author)}
                          aria-label={`@${author.discordUsername ?? "unknown"}'s profile`}
                        />
                      }
                    />
                  ) : null}
                  {team ? (
                    <CrewTile
                      label="THE TEAM"
                      title={team.name}
                      avatar={
                        <UserAvatar avatarUrl={team.avatarUrl} username={team.name} size={40} />
                      }
                      link={
                        <Link
                          to="/teams/$teamId"
                          params={teamLinkParams(team)}
                          aria-label={team.name}
                        />
                      }
                    />
                  ) : null}
                  {project ? (
                    <CrewTile
                      label="RECRUITING FOR"
                      title={project.title}
                      caption={projectTypeLabel(project)}
                      avatar={
                        project.imageUrl ? (
                          <span className="relative h-10 w-16 shrink-0 overflow-hidden border border-muted/40">
                            <HoverPlayImage
                              src={project.imageUrl}
                              transform={{ width: 192 }}
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          </span>
                        ) : null
                      }
                      link={
                        <Link
                          to="/projects/$projectSlug"
                          params={projectLinkParams(project)}
                          aria-label={project.title}
                        />
                      }
                    />
                  ) : null}
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>

          <div className="mt-auto flex items-center gap-3">
            <Button
              variant="default"
              size="lg"
              nativeButton={false}
              render={<Link to="/collab/$postId" params={{ postId: String(post.id) }} />}
              className="flex min-w-0 flex-1 items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold tracking-widest"
            >
              VIEW POST
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
            </Button>
            <Text
              as="span"
              size="xs"
              variant="muted"
              className="shrink-0 tracking-widest whitespace-nowrap tabular-nums"
            >
              {timeAgo(post.createdAt)}
            </Text>
          </div>
        </div>
      </Well>
    </div>
  );
}
