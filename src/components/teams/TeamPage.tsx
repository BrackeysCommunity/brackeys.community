import {
  ArrowRight01Icon,
  Flag01Icon,
  Link01Icon,
  Settings02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { motion } from "framer-motion";
import { useState } from "react";

import { CollabFunnelExplainer } from "@/components/collab/CollabQuickPost/CollabFunnelExplainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
import { DotGrid } from "@/components/ui/dot-grid";
import { GraphPaper } from "@/components/ui/graph-paper";
import { MediaCardImage } from "@/components/ui/media-card";
import { PageStack } from "@/components/ui/page-motion";
import { ReportDialog } from "@/components/ui/report-dialog";
import {
  MarkedText,
  MicroLabel,
  Heading,
  Link as TextLink,
  Text,
} from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { authStore } from "@/lib/auth-store";
import { timeAgo } from "@/lib/format-time";
import { Censored } from "@/lib/hooks/use-censored";
import { itchImageUrl } from "@/lib/itch-image";
import { jamLinkParams } from "@/lib/jam-links";
import { fadeUp } from "@/lib/motion";
import { profileLinkParams } from "@/lib/profile-links";
import { toast } from "@/lib/toast";
import { client } from "@/orpc/client";

import { TeamManageFlyout } from "./TeamManageFlyout";
import { TeamModerationFlyout } from "./TeamModerationFlyout";

/** `getTeam`'s response, as the page consumes it. */
export interface RpcTeam {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  websiteUrl: string | null;
  itchUrl: string | null;
  recruiting: boolean;
  status: string;
  /** Staff hide — set means only members and staff are seeing this page. */
  hiddenAt: string | Date | null;
  hiddenReason: string | null;
  /** Set by the lifecycle sweep's warning; still set on an auto-archived
   *  team, which is how the banner tells auto from hand archiving. */
  archiveWarnedAt: string | Date | null;
  createdAt: string | Date;
  members: TeamMember[];
  skills: { id: number; name: string; category: string | null; memberCount: number }[];
  projects: TeamProject[];
  openPosts: {
    id: number;
    title: string;
    type: string;
    createdAt: string | Date | null;
    roles: { id: number; name: string }[];
  }[];
  viewerRole: string | null;
  viewerInvite: { id: number; message: string | null } | null;
  pendingInvites: {
    id: number;
    inviteeId: string;
    createdAt: string | Date;
    inviteeUsername: string | null;
    inviteeAvatar: string | null;
  }[];
  isOwner: boolean;
  isStaffViewer: boolean;
}

export interface TeamMember {
  id: number;
  userId: string;
  role: string;
  title: string | null;
  username: string | null;
  avatarUrl: string | null;
  tagline: string | null;
  urlStub: string | null;
}

export interface TeamProject {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  pinned: boolean | null;
  jamId: number | null;
  jamName: string | null;
  jamUrl: string | null;
  /** Scraped jam slug — present when the row links to a jam we track, and
   * what turns the log row's name into a link to that jam's page. */
  jamSlug: string | null;
  /** Canonical project slug, when this showcase row is a placement of one. */
  projectSlug: string | null;
  submissionUrl: string | null;
  result: string | null;
  participatedAt: string | Date | null;
  addedBy: string | null;
}

const MAX_STACK_CHIPS = 12;

/**
 * A team's public page: masthead, roster, derived stack, showcase, jam
 * log, open positions. The team's stack is its members' skills counted
 * at read time — there is no stored team stack to go stale.
 *
 * Everything here speaks the directory's vocabulary, because the two
 * pages are the same object at two zoom levels: a notched `Well`
 * masthead over the house ruling, `MicroLabel` section markers on a
 * dashed rule, and `Chonk` tiles for anything that is a destination.
 * A tile that isn't clickable stays a `Well` — deboss for readouts,
 * emboss for links, same as on the tiles in `/teams`.
 */
export function TeamPage({ team, onInvalidate }: { team: RpcTeam; onInvalidate: () => void }) {
  const { session } = useStore(authStore);
  const [manageOpen, setManageOpen] = useState(false);
  const [moderateOpen, setModerateOpen] = useState(false);

  const isMember = team.viewerRole !== null;
  const isStaffOutsider = team.isStaffViewer && !isMember;
  const isArchived = team.status === "archived";
  const isHidden = team.hiddenAt != null;
  const jamLog = team.projects.filter((p) => p.jamId != null || p.jamName);
  const showcase = team.projects;

  const respondMutation = useMutation({
    mutationFn: (accept: boolean) =>
      client.respondToInvite({ inviteId: team.viewerInvite!.id, accept }),
    onSuccess: onInvalidate,
  });

  return (
    <PageStack className="flex flex-col gap-8 selection:bg-primary selection:text-white">
      {isHidden ? (
        <Well
          variant="ghost"
          className="border-destructive/40 bg-destructive/5 p-3 backdrop-blur-none"
        >
          <Text size="xs" className="tracking-widest text-destructive uppercase">
            {team.isStaffViewer && !isMember
              ? "Staff view — this team is hidden from the public."
              : "This team is hidden pending review — only members and staff can see it, and changes are locked."}
            {team.hiddenReason ? ` Reason: ${team.hiddenReason}` : ""}
          </Text>
        </Well>
      ) : null}

      {isArchived ? (
        <Well variant="ghost" className="border-warning/40 bg-warning/5 p-3 backdrop-blur-none">
          <Text size="xs" className="tracking-widest text-warning uppercase">
            {/* A lingering warning stamp means the lifecycle sweep did the
                archiving, not a person — say so, and that it's undoable. */}
            {team.archiveWarnedAt
              ? "This team was archived automatically after a quiet spell — the page is read-only. Restore it from MANAGE to bring it back."
              : "This team is archived — the page is read-only."}
          </Text>
        </Well>
      ) : null}

      {/* Pending invite for the signed-in viewer. */}
      {team.viewerInvite && session?.user ? (
        <Well className="flex-row flex-wrap items-center justify-between gap-3 border-primary/40 bg-primary/5 p-4 backdrop-blur-none">
          <div className="flex flex-col gap-0.5">
            <Text size="sm" bold>
              You've been invited to join {team.name}.
            </Text>
            {team.viewerInvite.message ? (
              <Text size="xs" variant="muted">
                “<Censored>{team.viewerInvite.message}</Censored>”
              </Text>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="tracking-widest"
              disabled={respondMutation.isPending}
              onClick={() => respondMutation.mutate(true)}
            >
              ACCEPT
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="tracking-widest"
              disabled={respondMutation.isPending}
              onClick={() => respondMutation.mutate(false)}
            >
              DECLINE
            </Button>
          </div>
        </Well>
      ) : null}

      <motion.div variants={fadeUp}>
        <TeamMasthead
          team={team}
          isMember={isMember}
          isArchived={isArchived}
          jamCount={jamLog.length}
          onManage={() => setManageOpen(true)}
          onModerate={isStaffOutsider ? () => setModerateOpen(true) : undefined}
          reportSlot={
            session?.user && !isMember && !isHidden ? <TeamReportButton teamId={team.id} /> : null
          }
        />
      </motion.div>

      {/* Roster */}
      <motion.div variants={fadeUp}>
        <Section title="ROSTER" count={team.members.length}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {team.members.map((m) => (
              <Chonk
                key={m.id}
                variant="surface"
                size="lg"
                className="items-center gap-3 bg-card p-3 backdrop-blur-none"
                render={
                  <Link
                    to="/profile/$userId"
                    params={profileLinkParams({ id: m.userId, urlStub: m.urlStub })}
                    aria-label={m.username ?? "Unknown"}
                  />
                }
              >
                <UserAvatar avatarUrl={m.avatarUrl} username={m.username} shape="round" size={36} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <Text as="span" size="sm" bold ellipsis className="min-w-0 tracking-wider">
                      {m.username ?? "Unknown"}
                    </Text>
                    {m.role === "owner" ? (
                      <Badge variant="outline" size="label">
                        OWNER
                      </Badge>
                    ) : null}
                  </span>
                  <Text as="span" size="xs" variant="muted" ellipsis>
                    <Censored>{m.title ?? m.tagline ?? "—"}</Censored>
                  </Text>
                </span>
              </Chonk>
            ))}
          </div>
        </Section>
      </motion.div>

      {/* Stack — derived from the roster's skills. */}
      {team.skills.length > 0 ? (
        <motion.div variants={fadeUp}>
          <Section title="STACK" hint="WHAT THE ROSTER WORKS IN">
            <div className="flex flex-wrap gap-1.5">
              {team.skills.slice(0, MAX_STACK_CHIPS).map((s) => (
                <Badge key={s.id} variant="outline" size="label" className="uppercase">
                  {s.name}
                  {s.memberCount > 1 ? (
                    <span className="text-muted-foreground"> ×{s.memberCount}</span>
                  ) : null}
                </Badge>
              ))}
            </div>
          </Section>
        </motion.div>
      ) : null}

      {/* Open positions */}
      {team.openPosts.length > 0 ? (
        <motion.div variants={fadeUp}>
          <Section
            title="OPEN POSITIONS"
            count={team.openPosts.length}
            action={
              <Link
                to="/collab"
                search={{ team: team.id }}
                className="inline-flex items-center gap-1 font-mono text-[10px] tracking-widest text-primary uppercase hover:underline"
              >
                ALL POSTS
                <HugeiconsIcon icon={ArrowRight01Icon} size={11} />
              </Link>
            }
          >
            <div className="flex flex-col gap-3">
              {team.openPosts.map((p) => (
                <Chonk
                  key={p.id}
                  variant="surface"
                  size="lg"
                  className="flex-wrap items-center gap-2 bg-card p-3 backdrop-blur-none"
                  render={<Link to="/collab" search={{ post: p.id }} aria-label={p.title} />}
                >
                  <Text as="span" size="sm" bold ellipsis className="min-w-0 flex-1 tracking-wider">
                    {p.title}
                  </Text>
                  <Badge variant="secondary" size="label" className="uppercase">
                    {p.type}
                  </Badge>
                  {p.roles.slice(0, 3).map((r) => (
                    <Badge key={r.id} variant="outline" size="label" className="uppercase">
                      {r.name}
                    </Badge>
                  ))}
                  <MicroLabel>{timeAgo(p.createdAt)}</MicroLabel>
                </Chonk>
              ))}
            </div>
          </Section>
        </motion.div>
      ) : null}

      {/* Showcase */}
      {showcase.length > 0 ? (
        <motion.div variants={fadeUp}>
          <Section title="SHOWCASE" count={showcase.length}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {showcase.map((p) => (
                <ShowcaseCard key={p.id} project={p} />
              ))}
            </div>
          </Section>
        </motion.div>
      ) : null}

      {/* Jam log */}
      {jamLog.length > 0 ? (
        <motion.div variants={fadeUp}>
          <Section title="JAM LOG" count={jamLog.length}>
            <Well className="gap-0 divide-y divide-dashed divide-muted/40 p-0 backdrop-blur-none">
              {jamLog.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  {/* A tracked jam links to its page here; an off-itch jam
                    with only a free-text URL still links out, and one with
                    neither stays plain text. */}
                  {p.jamSlug || p.jamId != null ? (
                    <Link
                      to="/jams/$jamSlug"
                      params={jamLinkParams({ jamId: p.jamId ?? 0, slug: p.jamSlug })}
                      className="min-w-0 flex-1 text-xs font-bold hover:text-primary hover:underline"
                    >
                      {p.jamName ?? p.title}
                    </Link>
                  ) : p.jamUrl ? (
                    <TextLink
                      href={p.jamUrl}
                      target="_blank"
                      rel="noreferrer"
                      size="sm"
                      bold
                      className="min-w-0 flex-1 hover:text-primary hover:underline"
                    >
                      {p.jamName ?? p.title}
                    </TextLink>
                  ) : (
                    <Text as="span" size="sm" bold className="min-w-0 flex-1">
                      {p.jamName ?? p.title}
                    </Text>
                  )}
                  {p.result ? (
                    <Badge variant="warning" size="label" className="uppercase">
                      {p.result}
                    </Badge>
                  ) : null}
                  {p.participatedAt ? (
                    <MicroLabel tabular>
                      {/* Jam dates are UTC everywhere in this app. */}
                      {new Date(p.participatedAt)
                        .toLocaleDateString("en-US", {
                          month: "short",
                          year: "numeric",
                          timeZone: "UTC",
                        })
                        .toUpperCase()}
                    </MicroLabel>
                  ) : null}
                  {(p.submissionUrl ?? p.url) ? (
                    <ExternalLink href={(p.submissionUrl ?? p.url)!} label="ENTRY" />
                  ) : null}
                </div>
              ))}
            </Well>
          </Section>
        </motion.div>
      ) : null}

      {team.members.length === 0 && showcase.length === 0 ? (
        <Well className="items-center justify-center gap-3 bg-card px-4 py-12 text-center backdrop-blur-none">
          <HugeiconsIcon icon={UserGroupIcon} size={20} className="text-muted-foreground" />
          <Text size="xs" variant="muted" className="tracking-widest uppercase">
            This page is still empty
          </Text>
        </Well>
      ) : null}
      {/* A team started at accept time lands its owner here with a roster of
          one — the note says where the rest comes from. */}
      {isMember && team.members.length <= 1 && showcase.length === 0 ? (
        <CollabFunnelExplainer
          title="Your team page is just getting started"
          steps={[
            "Right now it's just you. When you accept someone on one of your posts, they're invited here and show up on the roster once they say yes.",
            "You can rename the team, add an image, and write a short description from the manage panel whenever you like.",
            "If your game has a page on the site, you can add it to this team's showcase. If it doesn't have one yet, there's no rush.",
          ]}
          note="Nothing here is final. Everything on this page can be changed later."
        />
      ) : null}

      {isMember ? (
        <TeamManageFlyout
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          team={team}
          onInvalidate={onInvalidate}
        />
      ) : null}
      {isStaffOutsider ? (
        <TeamModerationFlyout
          open={moderateOpen}
          onClose={() => setModerateOpen(false)}
          team={team}
          onInvalidate={onInvalidate}
        />
      ) : null}
    </PageStack>
  );
}

/**
 * The page's masthead — the directory hero, narrowed to one team. Same
 * notched `Well`, same primary wash and ruling, so arriving from a tile
 * in `/teams` lands on the surface the tile was a miniature of.
 *
 * The team's own banner, when it has one, replaces the flat wash: it is
 * masked out toward the copy rather than letterboxed above it, so the
 * masthead stays one panel instead of becoming a header plus a photo.
 *
 * The stat line at the foot carries the same figures the directory tile
 * showed, so the numbers a visitor clicked through on are still there.
 */
function TeamMasthead({
  team,
  isMember,
  isArchived,
  jamCount,
  onManage,
  onModerate,
  reportSlot,
}: {
  team: RpcTeam;
  isMember: boolean;
  isArchived: boolean;
  jamCount: number;
  onManage: () => void;
  onModerate?: () => void;
  reportSlot?: React.ReactNode;
}) {
  // Roster size always shows — a team with nobody on it is worth saying.
  // The rest drop out at zero rather than parading empty columns.
  const stats: { value: number; label: string }[] = [
    { value: team.members.length, label: team.members.length === 1 ? "MEMBER" : "MEMBERS" },
    { value: team.projects.length, label: "SHIPPED" },
    { value: jamCount, label: jamCount === 1 ? "JAM" : "JAMS" },
    {
      value: team.openPosts.length,
      label: team.openPosts.length === 1 ? "OPEN POST" : "OPEN POSTS",
    },
  ].filter((stat, i) => i === 0 || stat.value > 0);

  return (
    <Well
      notchOpts
      // The wash is the surface's alone — the notched corners fall outside
      // its clip path, and `Well` fills those with the frame's lighter face.
      surfaceClassName="bg-card bg-linear-to-br from-deboss-surface via-deboss-surface to-primary/12 backdrop-blur-none"
    >
      {team.bannerUrl ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-25"
          style={{
            // Quoted and encoded: the banner is a user-supplied URL, and a
            // bare `url(…)` lets a stray quote or paren close the function
            // and open a second declaration.
            // Rewrite before encodeURI — the transform path must stay raw.
            backgroundImage: `url("${encodeURI(itchImageUrl(team.bannerUrl, { width: 960, quality: 50 }))}")`,
            maskImage: "linear-gradient(to bottom left, #000 0%, transparent 75%)",
            WebkitMaskImage: "linear-gradient(to bottom left, #000 0%, transparent 75%)",
          }}
        />
      ) : (
        <GraphPaper fade="bottom-left" />
      )}

      <div className="relative flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-64 flex-1 items-start gap-4">
            <UserAvatar
              avatarUrl={team.avatarUrl}
              username={team.name}
              shape="round"
              size={64}
              className="ring-2 ring-card"
            />
            <div className="flex min-w-0 flex-col gap-2">
              <MicroLabel>/{team.slug}</MicroLabel>
              <div className="flex flex-wrap items-center gap-2">
                <Heading as="h1" className="text-2xl tracking-widest uppercase">
                  {team.name}
                </Heading>
                {team.recruiting && !isArchived ? (
                  <Badge variant="success" size="label">
                    RECRUITING
                  </Badge>
                ) : null}
                {isArchived ? (
                  <Badge variant="outline" size="label">
                    ARCHIVED
                  </Badge>
                ) : null}
                {team.hiddenAt ? (
                  <Badge variant="destructive" size="label">
                    HIDDEN
                  </Badge>
                ) : null}
              </div>
              {team.tagline ? (
                <Text size="sm" variant="muted" className="max-w-prose">
                  <Censored>{team.tagline}</Censored>
                </Text>
              ) : null}
              {team.websiteUrl || team.itchUrl ? (
                <div className="flex flex-wrap items-center gap-3">
                  {team.websiteUrl ? <ExternalLink href={team.websiteUrl} label="WEBSITE" /> : null}
                  {team.itchUrl ? <ExternalLink href={team.itchUrl} label="ITCH.IO" /> : null}
                </div>
              ) : null}
            </div>
          </div>

          {/* Members recruit and manage; everyone else gets the way in,
              if there is one. A page with neither is simply a read-only
              profile. */}
          {isMember ? (
            <div className="flex flex-wrap items-center gap-2">
              {!isArchived ? (
                // Enters the create wizard with this team pre-linked —
                // what makes the RECRUITING badge actionable (§8.4).
                <Button
                  size="lg"
                  nativeButton={false}
                  className="tracking-widest"
                  render={<Link to="/collab" search={{ new: true, team: team.id }} />}
                >
                  <HugeiconsIcon icon={UserGroupIcon} size={14} />
                  POST AN OPENING
                </Button>
              ) : null}
              <Button variant="outline" size="lg" onClick={onManage} className="tracking-widest">
                <HugeiconsIcon icon={Settings02Icon} size={14} />
                MANAGE
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {team.openPosts.length > 0 && !isArchived ? (
                <Button
                  size="lg"
                  nativeButton={false}
                  className="tracking-widest"
                  render={<Link to="/collab" search={{ team: team.id }} />}
                >
                  <HugeiconsIcon icon={UserGroupIcon} size={14} />
                  SEE OPEN POSTS
                </Button>
              ) : null}
              {onModerate ? (
                <Button
                  variant="outline"
                  size="lg"
                  onClick={onModerate}
                  className="tracking-widest"
                >
                  <HugeiconsIcon icon={Settings02Icon} size={14} />
                  MODERATE
                </Button>
              ) : null}
              {reportSlot}
            </div>
          )}
        </div>

        {team.bio ? (
          <MarkedText className="max-w-prose text-foreground/90">{team.bio}</MarkedText>
        ) : null}
      </div>

      <div className="relative flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-dashed border-muted-foreground/25 px-6 py-3">
        {stats.map((stat) => (
          <div key={stat.label} className="flex items-baseline gap-1.5">
            <Text as="span" size="sm" bold tabular>
              {stat.value}
            </Text>
            <MicroLabel>{stat.label}</MicroLabel>
          </div>
        ))}
      </div>
    </Well>
  );
}

/**
 * Section marker — the directory shelf's header, with an optional count
 * and a right-aligned slot for the section's "see all". The marker is a
 * `MicroLabel` rather than a `Heading`: this is the label voice, and the
 * section takes its accessible name from `aria-label` instead of
 * borrowing a display heading for a 10px caption.
 */
function Section({
  title,
  hint,
  count,
  action,
  children,
}: {
  title: string;
  hint?: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex items-center gap-3 border-b border-dashed border-muted-foreground/25 pb-1.5">
        <MicroLabel>{title}</MicroLabel>
        {count !== undefined ? (
          <Text as="span" size="xs" variant="muted" tabular>
            {count}
          </Text>
        ) : null}
        {hint ? <MicroLabel>{hint}</MicroLabel> : null}
        {action ? <span className="ml-auto">{action}</span> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * A showcase entry. Linked projects are `Chonk` tiles like the directory's
 * — the whole tile is the destination; an entry with no link stays a
 * debossed `Well`, since there is nothing to press.
 */
function ShowcaseCard({ project }: { project: TeamProject }) {
  const body = (
    <>
      <span className="relative block h-32 w-full overflow-hidden border-b border-muted/40 bg-muted/20">
        {project.imageUrl ? <MediaCardImage src={project.imageUrl} alt="" /> : <DotGrid />}
      </span>
      <span className="flex flex-1 flex-col gap-1 p-3">
        <span className="flex items-center gap-2">
          <Text as="span" size="sm" bold ellipsis className="min-w-0 flex-1 tracking-wider">
            {project.title}
          </Text>
          {project.pinned ? (
            <Badge variant="outline" size="label">
              PINNED
            </Badge>
          ) : null}
        </span>
        {project.description ? (
          <Text as="span" size="xs" variant="muted" className="line-clamp-2">
            {project.description}
          </Text>
        ) : null}
        {project.jamName ? (
          <Badge variant="warning" size="label" className="mt-auto self-start uppercase">
            {project.jamName}
          </Badge>
        ) : null}
      </span>
    </>
  );

  // In-app first: a showcase row linked to a canonical project sends the
  // tile to that project's page — credits, the jam record, the type-aware
  // CTA. Only an unlinked row still exits straight to the provider.
  if (project.projectSlug) {
    return (
      <Chonk
        variant="surface"
        size="lg"
        className="h-full flex-col overflow-hidden bg-card backdrop-blur-none"
        render={
          <Link
            to="/projects/$projectSlug"
            params={{ projectSlug: project.projectSlug }}
            aria-label={project.title}
          />
        }
      >
        {body}
      </Chonk>
    );
  }
  if (project.url) {
    return (
      <Chonk
        variant="surface"
        size="lg"
        className="h-full flex-col overflow-hidden bg-card backdrop-blur-none"
        render={
          <a href={project.url} target="_blank" rel="noreferrer" aria-label={project.title} />
        }
      >
        {body}
      </Chonk>
    );
  }
  return <Well className="h-full overflow-hidden bg-card backdrop-blur-none">{body}</Well>;
}

/** Signed-in non-members only — matching the post and comment report
 * affordances, which never show anonymous. */
function TeamReportButton({ teamId }: { teamId: string }) {
  const report = useMutation({
    mutationFn: (reason: string) => client.reportTeam({ teamId, reason }),
    onError: (err) => toast.error(err.message || "Couldn't send the report."),
  });

  return (
    <ReportDialog
      title="Report this team?"
      message="Tell staff what's wrong with it. Only staff see this."
      onSubmit={async (reason) => {
        await report.mutateAsync(reason);
        toast.success("Report sent — staff will take a look.");
      }}
    >
      <Button variant="outline" size="lg" className="tracking-widest">
        <HugeiconsIcon icon={Flag01Icon} size={14} />
        REPORT
      </Button>
    </ReportDialog>
  );
}

/** An off-site destination, in the micro-label voice. */
function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <TextLink
      href={href}
      target="_blank"
      rel="noreferrer"
      size="xs"
      monospace
      className="inline-flex items-center gap-1 tracking-widest text-primary uppercase hover:underline"
    >
      <HugeiconsIcon icon={Link01Icon} size={11} />
      {label}
    </TextLink>
  );
}
