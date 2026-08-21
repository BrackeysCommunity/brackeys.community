import {
  Cancel01Icon,
  Delete02Icon,
  Login01Icon,
  PencilEdit01Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink, useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { motion } from "framer-motion";
import { type ReactNode, useState } from "react";

import { CommentThread } from "@/components/comments/CommentThread";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
import { Confirm } from "@/components/ui/confirm";
import { HoverPlayImage } from "@/components/ui/hover-play-image";
import { PageStack } from "@/components/ui/page-motion";
import { Section } from "@/components/ui/section";
import { Heading, Link as TextLink, MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { signInWithDiscord } from "@/lib/auth-client";
import { authStore } from "@/lib/auth-store";
import {
  collabStore,
  draftFromPost,
  isEditablePostType,
  resetWizard,
  startWizardEdit,
} from "@/lib/collab-store";
import { formatRate } from "@/lib/format-rate";
import { timeAgo } from "@/lib/format-time";
import { formatCountdown, formatJamShortDates } from "@/lib/jam-countdown";
import { jamLinkParams } from "@/lib/jam-links";
import { fadeLeft, fadeUp } from "@/lib/motion";
import { profileLinkParams } from "@/lib/profile-links";
import { projectLinkParams, projectTypeLabel } from "@/lib/project-links";
import { teamLinkParams } from "@/lib/team-links";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";

import { CollabCreateFlyout } from "./CollabCreateFlyout";
import {
  COMP_TYPE_LABELS,
  type CollabPostDetailData,
  ReportPostAction,
  TYPE_LABELS,
} from "./CollabPostDetail";
import {
  CollabPostResponseForm,
  ViewerResponseCard,
  type ViewerResponse,
} from "./CollabPostResponseForm";
import { CollabPostResponseList } from "./CollabPostResponseList";
import { ContactValue } from "./ContactValue";
import { useCollabPostActions } from "./use-collab-post-actions";
import { usePostViewerState } from "./use-post-viewer-state";

/** Status → the chip on the banner. Same vocabulary as the board's card
 * badges, so a post reads as the same post on both surfaces. */
const STATUS_BADGE: Record<
  string,
  { label: string; variant: "success" | "warning" | "destructive" }
> = {
  recruiting: { label: "OPEN", variant: "success" },
  party_full: { label: "CLOSED", variant: "destructive" },
  expired: { label: "EXPIRED", variant: "warning" },
};

/**
 * A post's own page, spoken in the same layout language as the jam,
 * project, and team pages: masthead `Well` with letterboxed
 * art and stat blocks, then titled sections. The board's inspector shows
 * the same post at panel zoom; this is the full spread — and the page a
 * crawler or a shared link lands on.
 */
export function CollabPostPage({ initialPost }: { initialPost: CollabPostDetailData }) {
  const postId = initialPost.id;
  const navigate = useNavigate();
  const { session } = useStore(authStore);
  const currentUserId = session?.user?.id ?? null;

  // Loader data seeds the cache so SSR carries the content; mutations
  // (close, extend, edit…) invalidate this entry and the page follows.
  const queryOptions = orpc.getPost.queryOptions({ input: { postId } });
  const { data } = useQuery({ ...queryOptions, initialData: initialPost, staleTime: 30 * 1000 });
  const post = data ?? initialPost;

  const actions = useCollabPostActions(postId, {
    onDeleted: () => navigate({ to: "/collab", search: {} }),
  });

  const [editOpen, setEditOpen] = useState(false);

  const {
    isOwner,
    responses,
    viewerResponse,
    contact,
    authorDiscordId,
    authorDiscordUsername,
    viewerOverlap,
  } = usePostViewerState(postId, post, currentUserId);
  const isClosed = post.status !== "recruiting";
  const closesIn = !isClosed && post.expiresAt ? formatCountdown(post.expiresAt) : null;
  const rateDisplay =
    formatRate(post.compensationType, post.compensationMin, post.compensationMax) ||
    post.compensation ||
    "";

  return (
    <PageStack className="flex flex-col gap-8 pb-8 selection:bg-primary selection:text-white">
      <motion.div variants={fadeUp}>
        <PostHero post={post} isClosed={isClosed} closesIn={closesIn} rateDisplay={rateDisplay}>
          <HeroActions
            post={post}
            isOwner={isOwner}
            isClosed={isClosed}
            closesIn={closesIn}
            currentUserId={currentUserId}
            actions={actions}
            onEdit={() => {
              startWizardEdit(post.id, draftFromPost(post, contact));
              setEditOpen(true);
            }}
          />
        </PostHero>
      </motion.div>

      {/* Two-column body, same split as the profile page: the prose the
          poster wrote reads in the main column under display headings,
          while the fact-shaped stuff — spec sheet, linked pages — rides
          a rail of micro-labeled cards beside it. */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,2.4fr)_minmax(19rem,1fr)]">
        <motion.div variants={fadeUp} className="flex min-w-0 flex-col gap-8">
          <Section
            id="brief"
            title="THE BRIEF"
            size="sm"
            blurb={`What ${post.team?.name ?? (post.author ? `@${post.author.discordUsername}` : "they")} is looking for, in their own words.`}
          >
            <Text size="md" className="max-w-prose whitespace-pre-wrap text-foreground/90">
              {post.description}
            </Text>
            {post.images.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                {post.images.slice(1).map((img) => (
                  <img
                    key={img.id}
                    src={img.url}
                    alt={img.alt ?? ""}
                    loading="lazy"
                    className="h-24 border border-muted/40 object-cover"
                  />
                ))}
              </div>
            ) : null}
          </Section>

          {post.roles.length > 0 || post.skills.length > 0 ? (
            <Section id="needs" title="WHO THEY NEED" size="sm">
              <div className="flex flex-col gap-4">
                {post.roles.length > 0 ? (
                  <ChipGroup label="ROLES">
                    {post.roles.map((role) => (
                      <Badge key={role.id} variant="secondary" size="label" className="uppercase">
                        {role.name}
                      </Badge>
                    ))}
                  </ChipGroup>
                ) : null}
                {post.skills.length > 0 ? (
                  <ChipGroup
                    label="TECH STACK"
                    aside={
                      viewerOverlap && viewerOverlap.matched.length > 0 ? (
                        <Text size="xs" variant="success" className="tracking-widest uppercase">
                          You match {viewerOverlap.matched.length}/{viewerOverlap.total}
                        </Text>
                      ) : null
                    }
                  >
                    {post.skills.map((skill) => {
                      const matched = viewerOverlap?.matched.includes(skill.name) ?? false;
                      return (
                        <Badge
                          key={skill.id}
                          variant="outline"
                          size="label"
                          className={cn("uppercase", matched && "border-success/50 text-success")}
                        >
                          {skill.name}
                        </Badge>
                      );
                    })}
                  </ChipGroup>
                ) : null}
              </div>
            </Section>
          ) : null}

          {isOwner ? (
            <Section
              id="responses"
              title="RESPONSES"
              size="sm"
              blurb={
                post.responseCount === 0
                  ? "Nobody has responded yet."
                  : post.responseCount === 1
                    ? "One person has responded."
                    : `${post.responseCount} people have responded.`
              }
            >
              {responses && responses.length > 0 ? (
                <CollabPostResponseList
                  responses={responses}
                  postId={postId}
                  team={post.team}
                  needsTeamLink={!post.isIndividual && !post.team}
                />
              ) : (
                <Well variant="ghost" className="items-center gap-1 p-8 backdrop-blur-none">
                  <MicroLabel>NO RESPONSES YET</MicroLabel>
                  <Text size="xs" variant="muted">
                    Responses land here as they come in.
                  </Text>
                </Well>
              )}
            </Section>
          ) : (
            <RespondSection
              postId={postId}
              isClosed={isClosed}
              signedIn={currentUserId !== null}
              viewerResponse={viewerResponse}
              authorDiscordId={authorDiscordId}
              authorDiscordUsername={authorDiscordUsername}
            />
          )}
        </motion.div>

        <motion.div variants={fadeLeft} className="flex flex-col gap-6">
          <Section id="details" title="THE DETAILS" size="sm">
            <Well className="gap-0 divide-y divide-dashed divide-muted/40 p-0 backdrop-blur-none">
              {post.projectName ? <SpecRow label="PROJECT" value={post.projectName} /> : null}
              {post.platforms && post.platforms.length > 0 ? (
                <SpecRow label="PLATFORMS" value={post.platforms.join(" · ")} />
              ) : null}
              {post.projectLength ? <SpecRow label="TIMELINE" value={post.projectLength} /> : null}
              {post.experienceLevel ? (
                <SpecRow label="EXPERIENCE" value={post.experienceLevel} />
              ) : null}
              {post.compensationType ? (
                <SpecRow
                  label="COMP"
                  value={COMP_TYPE_LABELS[post.compensationType] ?? post.compensationType}
                />
              ) : null}
              {rateDisplay ? <SpecRow label="RATE" value={rateDisplay} /> : null}
              {post.hasContact ? (
                <SpecRow
                  label="CONTACT"
                  value={<ContactValue contact={contact} isSignedIn={Boolean(currentUserId)} />}
                />
              ) : null}
              {post.portfolioUrl ? (
                <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                  <MicroLabel as="span" className="shrink-0">
                    PORTFOLIO
                  </MicroLabel>
                  <TextLink
                    href={post.portfolioUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="sm"
                    className="min-w-0 truncate"
                  >
                    {post.portfolioUrl.replace(/^https?:\/\//, "")} →
                  </TextLink>
                </div>
              ) : null}
            </Well>
          </Section>

          <Section id="crew" title="BEHIND THE POST" size="sm">
            <div className="flex flex-col gap-2">
              {post.author ? (
                <CrewTile
                  label="POSTED BY"
                  title={`@${post.author.discordUsername ?? "unknown"}`}
                  caption={post.author.tagline}
                  avatar={
                    <UserAvatar
                      avatarUrl={post.author.avatarUrl}
                      username={post.author.discordUsername}
                      size={40}
                    />
                  }
                  link={
                    <RouterLink
                      to="/profile/$userId"
                      params={profileLinkParams(post.author)}
                      aria-label={`@${post.author.discordUsername ?? "unknown"}'s profile`}
                    />
                  }
                />
              ) : null}
              {post.team ? (
                <CrewTile
                  label="THE TEAM"
                  title={post.team.name}
                  avatar={
                    <UserAvatar
                      avatarUrl={post.team.avatarUrl}
                      username={post.team.name}
                      size={40}
                    />
                  }
                  link={
                    <RouterLink
                      to="/teams/$teamId"
                      params={teamLinkParams(post.team)}
                      aria-label={post.team.name}
                    />
                  }
                />
              ) : null}
              {post.project ? (
                <CrewTile
                  label="RECRUITING FOR"
                  title={post.project.title}
                  caption={projectTypeLabel(post.project)}
                  avatar={
                    post.project.imageUrl ? (
                      <span className="relative h-10 w-16 shrink-0 overflow-hidden border border-muted/40">
                        <HoverPlayImage
                          src={post.project.imageUrl}
                          transform={{ width: 192 }}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      </span>
                    ) : null
                  }
                  link={
                    <RouterLink
                      to="/projects/$projectSlug"
                      params={projectLinkParams(post.project)}
                      aria-label={post.project.title}
                    />
                  }
                />
              ) : null}
              {post.jam ? (
                <CrewTile
                  label="FOR THE JAM"
                  title={post.jam.title}
                  caption={formatJamShortDates(post.jam.startsAt, post.jam.endsAt) ?? "DATES TBA"}
                  avatar={
                    post.jam.bannerUrl ? (
                      <span className="relative h-10 w-16 shrink-0 overflow-hidden border border-muted/40">
                        <HoverPlayImage
                          src={post.jam.bannerUrl}
                          transform={{ width: 192 }}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      </span>
                    ) : null
                  }
                  link={
                    <RouterLink
                      to="/jams/$jamSlug"
                      params={jamLinkParams(post.jam)}
                      aria-label={post.jam.title}
                    />
                  }
                />
              ) : null}
            </div>
          </Section>
        </motion.div>
      </div>

      {/* Full-width below the grid, like the profile wall: the column
          above is "the post and how to act on it" (one input — the
          response form), discussion is page-level commentary underneath.
          Keeping the two composers apart is deliberate — responses are
          private applications, comments are public. */}
      <motion.div variants={fadeUp}>
        <CommentThread
          subject={{ type: "collab_post", id: postId }}
          maxLength={2000}
          placeholder="Ask a question or leave a note for the poster…"
          emptyHint="Questions and discussion land here — applying to the post goes through the response form."
          shell={(content, count) => (
            <Section
              id="comments"
              title="COMMENTS"
              size="sm"
              blurb={
                count === 0
                  ? "Public discussion about this post."
                  : `${count} ${count === 1 ? "comment" : "comments"} so far.`
              }
            >
              {content}
            </Section>
          )}
        />
      </motion.div>

      {/* Mounted so the owner's EDIT lands in the same wizard the board
          uses — the detail panel elsewhere relies on the board's mount. */}
      <CollabCreateFlyout
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
          if (collabStore.state.wizard.editingPostId !== null) resetWizard();
        }}
        onCreated={() => setEditOpen(false)}
      />
    </PageStack>
  );
}

/**
 * The masthead: post art letterboxed the way the jam hero letterboxes
 * banners (user art comes in every aspect ratio), status chip on the art,
 * badges, title, byline, and the numbers that decide whether the post is
 * worth reading — closing countdown, rate, and response count.
 */
function PostHero({
  post,
  isClosed,
  closesIn,
  rateDisplay,
  children,
}: {
  post: CollabPostDetailData;
  isClosed: boolean;
  closesIn: { text: string; past: boolean } | null;
  rateDisplay: string;
  children: React.ReactNode;
}) {
  const art = post.images[0]?.url ?? post.project?.imageUrl ?? post.jam?.bannerUrl ?? null;
  // Uploaded post art is served as-is; itch covers and banners go through
  // the transformer.
  const artTransform = post.images[0] ? undefined : { width: 960, quality: 70 };
  const status = STATUS_BADGE[post.status] ?? STATUS_BADGE.recruiting!;

  return (
    <Well className="overflow-hidden p-0">
      {art ? (
        <div className="relative h-44 w-full shrink-0 overflow-hidden sm:h-56 lg:h-64">
          {/* Fully under the crisp layer, so its hover never arms — a
              permanent still. */}
          <HoverPlayImage
            src={art}
            transform={artTransform}
            className="absolute inset-0 h-full w-full scale-125 object-cover blur-xl saturate-150"
          />
          <HoverPlayImage
            src={art}
            transform={artTransform}
            alt={`${post.title} art`}
            className="absolute inset-0 h-full w-full object-contain"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent"
          />
          <div className="absolute top-3 left-3">
            <Badge variant={status.variant} size="label">
              {status.label}
            </Badge>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" size="label" className="uppercase">
              {TYPE_LABELS[post.type] ?? post.type}
            </Badge>
            {post.featuredAt ? (
              <Badge variant="warning" size="label">
                FEATURED
              </Badge>
            ) : null}
            {/* Without art there's no banner to carry the status chip. */}
            {!art ? (
              <Badge variant={status.variant} size="label">
                {status.label}
              </Badge>
            ) : null}
            {post.isIndividual ? (
              <Badge variant="outline" size="label">
                SOLO DEV
              </Badge>
            ) : null}
          </div>

          <Heading as="h1" className="text-3xl leading-tight md:text-4xl">
            {post.title}
          </Heading>

          <MicroLabel as="div" className="uppercase">
            Posted {timeAgo(post.createdAt)}
            {post.author ? ` · by @${post.author.discordUsername ?? "unknown"}` : ""}
            {post.team ? ` · ${post.team.name}` : ""}
          </MicroLabel>
        </div>

        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          {closesIn && !closesIn.past ? (
            <HeroStat label="CLOSES IN" value={closesIn.text.toUpperCase()} tint="warning" />
          ) : null}
          {isClosed ? (
            <HeroStat
              label="STATUS"
              value={post.status === "expired" ? "EXPIRED" : "CLOSED"}
              tint="destructive"
            />
          ) : null}
          {post.compensationType ? (
            <HeroStat
              label="COMP"
              value={(
                COMP_TYPE_LABELS[post.compensationType] ?? post.compensationType
              ).toUpperCase()}
            />
          ) : null}
          {rateDisplay ? <HeroStat label="RATE" value={rateDisplay} /> : null}
          {post.responseCount > 0 ? (
            <HeroStat label="RESPONSES" value={post.responseCount.toLocaleString()} />
          ) : null}
        </div>

        {children}
      </div>
    </Well>
  );
}

/** Same stat block as the jam hero's — caption over a big number. */
function HeroStat({
  label,
  value,
  tint,
}: {
  label: string;
  value: string;
  tint?: "warning" | "destructive";
}) {
  return (
    <div className="min-w-0">
      <MicroLabel as="div">{label}</MicroLabel>
      <Text
        as="div"
        bold
        density="dense"
        className={cn(
          "text-xl whitespace-nowrap tabular-nums md:text-2xl",
          tint === "warning" && "text-warning",
          tint === "destructive" && "text-destructive",
        )}
      >
        {value}
      </Text>
    </div>
  );
}

/**
 * The masthead's action row: one primary path for a visitor (respond, or
 * sign in to), the management set for the owner, and report tucked at the
 * trailing edge — the same "one button that matters" shape as the
 * project hero.
 */
function HeroActions({
  post,
  isOwner,
  isClosed,
  closesIn,
  currentUserId,
  actions,
  onEdit,
}: {
  post: CollabPostDetailData;
  isOwner: boolean;
  isClosed: boolean;
  closesIn: { text: string; past: boolean } | null;
  currentUserId: string | null;
  actions: ReturnType<typeof useCollabPostActions>;
  onEdit: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      {!isOwner && !isClosed ? (
        currentUserId ? (
          <Button
            size="sm"
            className="tracking-widest"
            nativeButton={false}
            render={<a href="#respond" aria-label="Jump to the response form" />}
          >
            RESPOND TO THIS POST
          </Button>
        ) : (
          <Button size="sm" className="tracking-widest" onClick={() => signInWithDiscord()}>
            <HugeiconsIcon icon={Login01Icon} size={12} />
            SIGN IN TO RESPOND
          </Button>
        )
      ) : null}

      {isOwner ? (
        <>
          {isEditablePostType(post.type) ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onEdit}
              title="Edit this post"
              className="tracking-widest"
            >
              <HugeiconsIcon icon={PencilEdit01Icon} size={12} />
              EDIT
            </Button>
          ) : null}
          {isClosed ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => actions.reopen.mutate()}
              disabled={actions.reopen.isPending}
              title="Reopen this post for applications"
              className="tracking-widest"
            >
              <HugeiconsIcon icon={Tick01Icon} size={12} />
              REOPEN POST
            </Button>
          ) : (
            <>
              {closesIn ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => actions.extend.mutate()}
                  disabled={actions.extend.isPending}
                  title="Still looking — push the closing date out 30 days"
                  className="tracking-widest"
                >
                  EXTEND
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => actions.close.mutate()}
                disabled={actions.close.isPending}
                title="Mark this post as no longer recruiting"
                className="tracking-widest"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={12} />
                CLOSE RECRUITING
              </Button>
            </>
          )}
          <Confirm
            variant="destructive"
            title="Delete this post permanently?"
            confirmText="DELETE"
            onConfirm={() => actions.remove.mutate()}
          >
            <Button
              variant="destructive"
              size="sm"
              disabled={actions.remove.isPending}
              className="tracking-widest"
            >
              <HugeiconsIcon icon={Delete02Icon} size={12} />
              DELETE
            </Button>
          </Confirm>
        </>
      ) : null}

      {!isOwner && currentUserId ? (
        <div className="ml-auto">
          <ReportPostAction report={actions.report} />
        </div>
      ) : null}
    </div>
  );
}

/** A labelled row of badges, with an optional trailing note. */
function ChipGroup({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <MicroLabel as="span">{label}</MicroLabel>
        {aside}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** Label left, value right, on the house dashed rule. */
function SpecRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <MicroLabel as="span" className="shrink-0">
        {label}
      </MicroLabel>
      <Text as="span" size="sm" align="right" className="min-w-0 text-foreground/90">
        {value}
      </Text>
    </div>
  );
}

/**
 * A destination tile, same grammar as the project page's MADE BY tiles:
 * emboss means clickable, deboss stays for readouts.
 */
function CrewTile({
  label,
  title,
  caption,
  avatar,
  link,
}: {
  label: string;
  title: string;
  caption?: string | null;
  avatar: React.ReactNode;
  link: React.ReactElement;
}) {
  return (
    <Chonk
      variant="surface"
      size="lg"
      data-hover-play-group
      className="w-full items-center gap-3 bg-card px-3 py-2 backdrop-blur-none"
      render={link}
    >
      {avatar}
      <span className="flex min-w-0 flex-col gap-0.5">
        <MicroLabel as="span">{label}</MicroLabel>
        <Text as="span" size="sm" bold ellipsis className="tracking-wider">
          {title}
        </Text>
        {caption ? (
          <Text as="span" size="xs" variant="muted" ellipsis className="max-w-56">
            {caption}
          </Text>
        ) : null}
      </span>
    </Chonk>
  );
}

/**
 * The visitor's half of the responses story. Closed posts say so instead
 * of hiding the section — a shared link shouldn't dead-end silently — and
 * signed-out visitors get the ask, not a blank.
 */
function RespondSection({
  postId,
  isClosed,
  signedIn,
  viewerResponse,
  authorDiscordId,
  authorDiscordUsername,
}: {
  postId: number;
  isClosed: boolean;
  signedIn: boolean;
  viewerResponse: ViewerResponse | null;
  authorDiscordId: string | null;
  authorDiscordUsername: string | null;
}) {
  if (viewerResponse) {
    return (
      <Section
        id="respond"
        title="RESPOND"
        size="sm"
        blurb="You've already responded — here's what you sent."
      >
        <Well className="p-5 backdrop-blur-none">
          <ViewerResponseCard
            response={viewerResponse}
            postId={postId}
            authorDiscordId={authorDiscordId}
            authorDiscordUsername={authorDiscordUsername}
          />
        </Well>
      </Section>
    );
  }

  return (
    <Section
      id="respond"
      title="RESPOND"
      size="sm"
      blurb={
        isClosed
          ? "This post is no longer taking responses."
          : "Your reply goes straight to the poster."
      }
    >
      {isClosed ? (
        <Well variant="ghost" className="items-center gap-1 p-8 backdrop-blur-none">
          <MicroLabel>NO LONGER RECRUITING</MicroLabel>
          <Text size="xs" variant="muted">
            The poster closed this role — browse the board for open ones.
          </Text>
        </Well>
      ) : signedIn ? (
        <Well className="p-5 backdrop-blur-none">
          <CollabPostResponseForm postId={postId} />
        </Well>
      ) : (
        <Well variant="ghost" className="items-center gap-3 p-8 backdrop-blur-none">
          <Text size="sm" variant="muted">
            Sign in with Discord to respond to this post.
          </Text>
          <Button size="sm" className="tracking-widest" onClick={() => signInWithDiscord()}>
            <HugeiconsIcon icon={Login01Icon} size={12} />
            SIGN IN TO RESPOND
          </Button>
        </Well>
      )}
    </Section>
  );
}
