import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
import { Section } from "@/components/ui/section";
import { Link as TextLink, MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { jamLinkParams } from "@/lib/jam-links";
import { teamLinkParams } from "@/lib/team-links";

import { ProjectCredits } from "./ProjectCredits";
import { ProjectHero } from "./ProjectHero";
import type { ProjectDetail, ProjectJamAppearance } from "./types";

/**
 * A project's canonical page.
 *
 * The reason it exists is the credits section: before the project entity,
 * "who worked on this?" was unanswerable — the answer was scattered across
 * `profile_projects.team_members text[]`, an unused team-credits table, and
 * `itch.jam_entries.contributors` jsonb, in three incompatible shapes. Every
 * other section is additive and disappears when it has nothing: a library
 * has no jam record, a solo tool has no team, and neither should render an
 * empty box saying so.
 */
export function ProjectPage({ detail }: { detail: ProjectDetail }) {
  const { project, contributors, teams, jamRecord, viewerCanEdit, openPostCount } = detail;

  return (
    <div className="flex flex-col gap-8 pb-8">
      <ProjectHero
        project={project}
        canEdit={viewerCanEdit}
        recruitTeamId={teams.length === 1 ? teams[0]!.teamId : undefined}
      />

      {/* The page as a recruiting surface, not just a trophy case: only
          when linked posts are open — a wall of closed ones would
          advertise a dead end. */}
      {openPostCount > 0 ? (
        <Section
          id="recruiting"
          title="RECRUITING"
          blurb={
            openPostCount === 1
              ? "One open post is looking for collaborators on this project."
              : `${openPostCount} open posts are looking for collaborators on this project.`
          }
        >
          <div>
            <Button
              variant="outline"
              className="tracking-widest"
              nativeButton={false}
              render={<Link to="/collab" search={{ project: project.id }} />}
            >
              SEE THE POSTS →
            </Button>
          </div>
        </Section>
      ) : null}

      <ProjectCredits projectId={project.id} contributors={contributors} canEdit={viewerCanEdit} />

      {teams.length > 0 ? (
        <Section
          id="teams"
          title="MADE BY"
          blurb={teams.length === 1 ? "The team behind it." : "The teams behind it."}
        >
          <div className="flex flex-wrap gap-2">
            {teams.map((team) => (
              <Chonk
                key={team.teamId}
                variant="surface"
                size="lg"
                className="items-center gap-3 bg-card px-3 py-2 backdrop-blur-none"
                render={
                  <Link
                    to="/teams/$teamId"
                    params={teamLinkParams({ id: team.teamId, slug: team.slug })}
                    aria-label={team.name}
                  />
                }
              >
                <UserAvatar avatarUrl={team.avatarUrl} username={team.name} size={28} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <Text as="span" size="sm" bold ellipsis className="tracking-wider">
                    {team.name}
                  </Text>
                  {team.tagline ? (
                    <Text as="span" size="xs" variant="muted" ellipsis className="max-w-56">
                      {team.tagline}
                    </Text>
                  ) : null}
                </span>
              </Chonk>
            ))}
          </div>
        </Section>
      ) : null}

      {/* A game with three jam appearances finally reads as a body of work.
          A website simply doesn't have this section. */}
      {jamRecord.length > 0 ? (
        <Section
          id="jams"
          title="JAM RECORD"
          blurb={
            jamRecord.length === 1 ? "One jam appearance." : `${jamRecord.length} jam appearances.`
          }
        >
          <Well className="gap-0 divide-y divide-dashed divide-muted/40 p-0 backdrop-blur-none">
            {jamRecord.map((appearance) => (
              <JamAppearanceRow key={appearance.key} appearance={appearance} />
            ))}
          </Well>
        </Section>
      ) : null}
    </div>
  );
}

function JamAppearanceRow({ appearance }: { appearance: ProjectJamAppearance }) {
  const rankChip =
    appearance.rank != null
      ? appearance.entriesCount
        ? `#${appearance.rank} / ${appearance.entriesCount.toLocaleString()}`
        : `#${appearance.rank}`
      : appearance.result;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
      {/* A jam we track links to its page here; an off-itch jam with only a
          free-text URL still links out; one with neither stays plain. */}
      {appearance.jamSlug || appearance.jamId != null ? (
        <Link
          to="/jams/$jamSlug"
          params={jamLinkParams({ jamId: appearance.jamId ?? 0, slug: appearance.jamSlug })}
          className="min-w-0 flex-1 truncate text-xs font-bold hover:text-primary hover:underline"
        >
          {appearance.jamName ?? "Untitled jam"}
        </Link>
      ) : appearance.jamUrl ? (
        <TextLink
          href={appearance.jamUrl}
          target="_blank"
          rel="noopener noreferrer"
          size="sm"
          bold
          className="min-w-0 flex-1 hover:text-primary hover:underline"
        >
          {appearance.jamName ?? "Untitled jam"}
        </TextLink>
      ) : (
        <Text as="span" size="sm" bold className="min-w-0 flex-1">
          {appearance.jamName ?? "Untitled jam"}
        </Text>
      )}

      {appearance.participatedAt ? (
        <MicroLabel tabular>
          {/* Jam dates are UTC everywhere in this app. */}
          {new Date(appearance.participatedAt)
            .toLocaleDateString(undefined, {
              month: "short",
              year: "numeric",
              timeZone: "UTC",
            })
            .toUpperCase()}
        </MicroLabel>
      ) : null}

      {rankChip ? (
        <Badge
          variant={appearance.rank != null && appearance.rank <= 3 ? "warning" : "outline"}
          size="label"
        >
          {rankChip}
        </Badge>
      ) : null}

      {appearance.submissionUrl ? (
        <TextLink
          href={
            appearance.submissionUrl.startsWith("http")
              ? appearance.submissionUrl
              : `https://itch.io${appearance.submissionUrl}`
          }
          target="_blank"
          rel="noopener noreferrer"
          size="xs"
          className="tracking-widest uppercase"
        >
          ENTRY →
        </TextLink>
      ) : null}
    </div>
  );
}
