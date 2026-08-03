import { Link01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MediaCardImage } from "@/components/ui/media-card";
import { MicroLabel, Heading, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { authStore } from "@/lib/auth-store";
import { timeAgo } from "@/lib/format-time";
import { profileLinkParams } from "@/lib/profile-links";
import { client } from "@/orpc/client";

import { TeamManageFlyout } from "./TeamManageFlyout";

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
  submissionUrl: string | null;
  result: string | null;
  participatedAt: string | Date | null;
  addedBy: string | null;
}

const MAX_STACK_CHIPS = 12;

/**
 * A team's public page: hero, roster, derived stack, showcase, jam log,
 * open positions. The team's stack is its members' skills counted at
 * read time — there is no stored team stack to go stale.
 */
export function TeamPage({ team, queryKey }: { team: RpcTeam; queryKey: readonly unknown[] }) {
  const { session } = useStore(authStore);
  const queryClient = useQueryClient();
  const [manageOpen, setManageOpen] = useState(false);

  const isMember = team.viewerRole !== null;
  const isArchived = team.status === "archived";
  const jamLog = team.projects.filter((p) => p.jamId != null || p.jamName);
  const showcase = team.projects;

  const respondMutation = useMutation({
    mutationFn: (accept: boolean) =>
      client.respondToInvite({ inviteId: team.viewerInvite!.id, accept }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return (
    <div className="flex flex-col gap-8 selection:bg-primary selection:text-white">
      {isArchived ? (
        <Well variant="ghost" className="border-warning/40 bg-warning/5 p-3">
          <Text size="xs" className="tracking-widest text-warning uppercase">
            This team is archived — the page is read-only.
          </Text>
        </Well>
      ) : null}

      {/* Pending invite for the signed-in viewer. */}
      {team.viewerInvite && session?.user ? (
        <Well className="flex-row flex-wrap items-center justify-between gap-3 border-primary/40 bg-primary/5 p-4">
          <div className="flex flex-col gap-0.5">
            <Text size="sm" bold>
              You've been invited to join {team.name}.
            </Text>
            {team.viewerInvite.message ? (
              <Text size="xs" variant="muted">
                “{team.viewerInvite.message}”
              </Text>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={respondMutation.isPending}
              onClick={() => respondMutation.mutate(true)}
            >
              ACCEPT
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={respondMutation.isPending}
              onClick={() => respondMutation.mutate(false)}
            >
              DECLINE
            </Button>
          </div>
        </Well>
      ) : null}

      {/* Hero */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start gap-4">
          <UserAvatar avatarUrl={team.avatarUrl} username={team.name} size={72} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Heading as="h1" className="text-2xl tracking-widest uppercase">
                {team.name}
              </Heading>
              {team.recruiting && !isArchived ? (
                <Badge variant="success" size="label" className="uppercase">
                  Recruiting
                </Badge>
              ) : null}
              {isArchived ? (
                <Badge variant="outline" size="label" className="uppercase">
                  Archived
                </Badge>
              ) : null}
            </div>
            {team.tagline ? (
              <Text size="sm" variant="muted">
                {team.tagline}
              </Text>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <MicroLabel>/{team.slug}</MicroLabel>
              {team.websiteUrl ? <ExternalLink href={team.websiteUrl} label="WEBSITE" /> : null}
              {team.itchUrl ? <ExternalLink href={team.itchUrl} label="ITCH.IO" /> : null}
            </div>
          </div>
          {isMember ? (
            <Button variant="outline" size="sm" onClick={() => setManageOpen(true)}>
              MANAGE
            </Button>
          ) : null}
        </div>
        {team.bio ? (
          <Text size="sm" className="max-w-prose whitespace-pre-wrap text-foreground/90">
            {team.bio}
          </Text>
        ) : null}
      </div>

      {/* Roster */}
      <Section title="Roster" count={team.members.length}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {team.members.map((m) => (
            <Link
              key={m.id}
              to="/profile/$userId"
              params={profileLinkParams({ id: m.userId, urlStub: m.urlStub })}
              className="flex items-center gap-3 border border-muted/40 bg-card/40 p-3 transition-colors hover:border-primary/50 hover:bg-muted/10"
            >
              <UserAvatar avatarUrl={m.avatarUrl} username={m.username} size={36} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <Text as="span" size="sm" bold ellipsis>
                    {m.username ?? "Unknown"}
                  </Text>
                  {m.role === "owner" ? <MicroLabel>OWNER</MicroLabel> : null}
                </span>
                {m.title ? (
                  <Text as="span" size="xs" variant="muted" ellipsis>
                    {m.title}
                  </Text>
                ) : null}
              </span>
            </Link>
          ))}
        </div>
      </Section>

      {/* Stack — derived from the roster's skills. */}
      {team.skills.length > 0 ? (
        <Section title="Stack" hint="what the roster works in">
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
      ) : null}

      {/* Open positions */}
      {team.openPosts.length > 0 ? (
        <Section title="Open positions" count={team.openPosts.length}>
          <div className="flex flex-col gap-2">
            {team.openPosts.map((p) => (
              <Link
                key={p.id}
                to="/collab"
                search={{ post: p.id }}
                className="flex flex-wrap items-center gap-2 border border-muted/40 bg-card/40 p-3 transition-colors hover:border-primary/50 hover:bg-muted/10"
              >
                <Text as="span" size="sm" bold className="min-w-0 flex-1 tracking-wider uppercase">
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
                <Text as="span" size="xs" variant="muted" className="tracking-widest">
                  {timeAgo(p.createdAt)}
                </Text>
              </Link>
            ))}
          </div>
          <Link
            to="/collab"
            search={{ team: team.id }}
            className="self-start text-xs tracking-widest text-primary uppercase hover:underline"
          >
            See all posts by this team →
          </Link>
        </Section>
      ) : null}

      {/* Showcase */}
      {showcase.length > 0 ? (
        <Section title="Showcase" count={showcase.length}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {showcase.map((p) => (
              <ShowcaseCard key={p.id} project={p} />
            ))}
          </div>
        </Section>
      ) : null}

      {/* Jam log */}
      {jamLog.length > 0 ? (
        <Section title="Jam log" count={jamLog.length}>
          <div className="flex flex-col divide-y divide-dashed divide-muted/40 border border-muted/40 bg-card/40">
            {jamLog.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <Text as="span" size="sm" bold className="min-w-0 flex-1">
                  {p.jamName ?? p.title}
                </Text>
                {p.result ? (
                  <Badge variant="warning" size="label" className="uppercase">
                    {p.result}
                  </Badge>
                ) : null}
                {p.participatedAt ? (
                  <Text
                    as="span"
                    size="xs"
                    variant="muted"
                    className="tracking-widest tabular-nums"
                  >
                    {/* Jam dates are UTC everywhere in this app. */}
                    {new Date(p.participatedAt).toLocaleDateString("en-US", {
                      month: "short",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </Text>
                ) : null}
                {(p.submissionUrl ?? p.url) ? (
                  <ExternalLink href={(p.submissionUrl ?? p.url)!} label="ENTRY" />
                ) : null}
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {team.members.length === 0 && showcase.length === 0 ? (
        <Well variant="ghost" className="items-center gap-2 p-8">
          <HugeiconsIcon icon={UserGroupIcon} size={20} className="text-muted-foreground" />
          <Text size="sm" variant="muted">
            Nothing here yet.
          </Text>
        </Well>
      ) : null}

      {isMember ? (
        <TeamManageFlyout
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          team={team}
          queryKey={queryKey}
        />
      ) : null}
    </div>
  );
}

function Section({
  title,
  hint,
  count,
  children,
}: {
  title: string;
  hint?: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2 border-b border-dashed border-muted-foreground/25 pb-2">
        <Heading as="h2" className="text-sm tracking-widest uppercase">
          {title}
        </Heading>
        {count !== undefined ? (
          <Text as="span" size="xs" variant="muted" className="tabular-nums">
            {count}
          </Text>
        ) : null}
        {hint ? (
          <Text as="span" size="xs" variant="muted" className="tracking-widest uppercase">
            {hint}
          </Text>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function ShowcaseCard({ project }: { project: TeamProject }) {
  const body = (
    <>
      <div className="relative h-32 w-full overflow-hidden border-b border-muted/40 bg-muted/20">
        {project.imageUrl ? (
          <MediaCardImage src={project.imageUrl} alt="" />
        ) : (
          <span
            aria-hidden
            className="block h-full w-full"
            style={{
              backgroundImage:
                "radial-gradient(circle, var(--color-muted-foreground) 1px, transparent 1px)",
              backgroundSize: "7px 7px",
              opacity: 0.3,
            }}
          />
        )}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-center gap-1.5">
          <Text as="span" size="sm" bold ellipsis className="min-w-0 flex-1">
            {project.title}
          </Text>
          {project.pinned ? <MicroLabel>PINNED</MicroLabel> : null}
        </div>
        {project.description ? (
          <Text as="span" size="xs" variant="muted" className="line-clamp-2">
            {project.description}
          </Text>
        ) : null}
        {project.jamName ? (
          <Badge variant="warning" size="label" className="self-start uppercase">
            {project.jamName}
          </Badge>
        ) : null}
      </div>
    </>
  );

  const frame = "flex flex-col overflow-hidden border border-muted/40 bg-card/40";
  if (project.url) {
    return (
      <a
        href={project.url}
        target="_blank"
        rel="noreferrer"
        className={`${frame} transition-colors hover:border-primary/50`}
      >
        {body}
      </a>
    );
  }
  return <div className={frame}>{body}</div>;
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs tracking-widest text-primary uppercase hover:underline"
    >
      <HugeiconsIcon icon={Link01Icon} size={11} />
      {label}
    </a>
  );
}
