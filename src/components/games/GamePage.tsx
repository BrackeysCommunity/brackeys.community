import { Flag02Icon, PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
import { MediaCardImage } from "@/components/ui/media-card";
import { ReportDialog } from "@/components/ui/report-dialog";
import { Section } from "@/components/ui/section";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { Heading, Link as TextLink, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import type { GamePagePayload } from "@/lib/engine/game-page";
import { engineGamesAllowed } from "@/lib/engine/guard";
import { useFlagBlocks } from "@/lib/hooks/use-flag";
import { profileLinkParams } from "@/lib/profile-links";
import { teamLinkParams } from "@/lib/team-links";
import { toast } from "@/lib/toast";
import { client } from "@/orpc/client";

import { EmbedSnippet } from "./EmbedSnippet";
import { SaveNotice } from "./SaveNotice";
import { VersionList, type GameVersion } from "./VersionList";

/** The game page's payload, with each version's release id when it carries one. */
export type GamePageView = Omit<GamePagePayload, "versions"> & { versions: GameVersion[] };

const VISIBILITY_LABEL: Record<GamePagePayload["visibility"], string | null> = {
  public: null,
  unlisted: "UNLISTED",
  team: "TEAM ONLY",
  private: "PRIVATE",
};

/** "3 assets have no licence recorded" */
export function missingLicencesLine(count: number): string {
  return count === 1
    ? "1 asset has no licence recorded."
    : `${count} assets have no licence recorded.`;
}

/** True when hosted games are off for this viewer or this deployment. */
function useGamesBlocked(): boolean {
  const flagOff = useFlagBlocks("engine-games-enabled");
  return flagOff || !engineGamesAllowed();
}

function GameHeader({ page }: { page: GamePageView }) {
  const visibility = VISIBILITY_LABEL[page.visibility];
  const { contributors, teams } = page;

  const report = async (reason: string) => {
    try {
      await client.reportGame({ projectId: page.projectId, reason });
      toast.success("Thanks. Staff will take a look.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The report didn't send. Try again.");
      throw error;
    }
  };

  return (
    <Well data-header-hero className="overflow-hidden p-0">
      <div className="flex flex-col gap-0 sm:flex-row">
        <div className="relative aspect-[63/50] w-full shrink-0 overflow-hidden bg-muted/20 sm:w-72 lg:w-96">
          {page.cover.url ? (
            <MediaCardImage src={page.cover.url} alt={`${page.title} cover`} />
          ) : (
            <Text
              bold
              density="dense"
              className="absolute inset-0 flex items-center justify-center text-3xl tracking-tighter text-foreground/25"
            >
              GAME
            </Text>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:p-6">
          {visibility || page.reviewPending || page.hidden ? (
            <div className="flex flex-wrap items-center gap-2">
              {visibility ? (
                <Badge variant="outline" size="label">
                  {visibility}
                </Badge>
              ) : null}
              {page.reviewPending ? (
                <Badge variant="warning" size="label">
                  PUBLIC AFTER REVIEW
                </Badge>
              ) : null}
              {page.hidden ? (
                <Badge variant="destructive" size="label">
                  HIDDEN BY STAFF
                </Badge>
              ) : null}
            </div>
          ) : null}
          {page.hidden && page.publisher ? (
            <Text as="p" size="sm" variant="danger" role="status">
              Staff hid this game, so nobody can play it
              {page.hidden.reason ? `: ${page.hidden.reason}` : "."}
            </Text>
          ) : null}

          <Heading as="h1" className="text-3xl leading-tight md:text-4xl">
            {page.title}
          </Heading>

          {page.description ? (
            <Text size="md" variant="muted" className="max-w-prose">
              {page.description}
            </Text>
          ) : null}

          {contributors.length > 0 || teams.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2" aria-label="Made by">
              {contributors.map((person) => {
                const avatar = (
                  <UserAvatar
                    avatarUrl={person.avatarUrl}
                    guildAvatarUrl={person.guildAvatarUrl}
                    username={person.displayName}
                    size={28}
                  />
                );
                return (
                  <SimpleTooltip key={person.id} content={person.displayName}>
                    {person.profileId ? (
                      <Link
                        to="/profile/$userId"
                        params={profileLinkParams({
                          id: person.profileId,
                          urlStub: person.urlStub,
                        })}
                        aria-label={person.displayName}
                        className="flex"
                      >
                        {avatar}
                      </Link>
                    ) : (
                      <span className="flex" role="img" aria-label={person.displayName}>
                        {avatar}
                      </span>
                    )}
                  </SimpleTooltip>
                );
              })}
              {teams.map((team) => (
                <Chonk
                  key={team.id}
                  variant="surface"
                  size="sm"
                  className="items-center gap-2 bg-card px-2 py-1 backdrop-blur-none"
                  render={
                    <Link
                      to="/teams/$teamId"
                      params={teamLinkParams({ id: team.id, slug: team.slug })}
                    />
                  }
                >
                  <UserAvatar avatarUrl={team.avatarUrl} username={team.name} size={20} />
                  <Text as="span" size="sm" bold ellipsis>
                    {team.name}
                  </Text>
                </Chonk>
              ))}
            </div>
          ) : null}

          <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
            {page.live ? (
              <Button
                size="lg"
                className="h-11 px-6 text-base"
                nativeButton={false}
                render={
                  <Link
                    to="/games/$projectId/play/$version"
                    params={{ projectId: page.projectId, version: "latest" }}
                  />
                }
              >
                <HugeiconsIcon icon={PlayIcon} data-icon="inline-start" />
                Play
              </Button>
            ) : null}
            {page.embeddable ? (
              <EmbedSnippet projectId={page.projectId} title={page.title} />
            ) : null}
            {page.viewer.signedIn ? (
              <ReportDialog
                title="Report this game?"
                message="Tell staff what's wrong with this game. Only staff see this."
                onSubmit={report}
              >
                <Button variant="ghost" size="sm">
                  <HugeiconsIcon icon={Flag02Icon} data-icon="inline-start" />
                  Report
                </Button>
              </ReportDialog>
            ) : null}
          </div>
        </div>
      </div>
    </Well>
  );
}

/** `/games/<project>`: who made it, the versions to play, where saves go, and the credits. */
export function GamePage({
  page,
  onChanged,
}: {
  page: GamePageView | null;
  /** Reloads the page's data after a publisher's action. */
  onChanged: () => void;
}) {
  const blocked = useGamesBlocked();
  if (blocked || !page) return <NotFoundPage />;

  const missing = page.publisher ? page.creditsMissing : 0;
  return (
    <div className="flex flex-col gap-8 pb-8">
      <GameHeader page={page} />

      <Section
        id="versions"
        title="VERSIONS"
        blurb={page.publisher ? "Every version you can play, manage or download." : undefined}
      >
        <VersionList
          projectId={page.projectId}
          versions={page.versions}
          publisher={page.publisher}
          liveVersion={page.live?.version ?? null}
          liveScenes={page.live?.scenes}
          blockedScenes={page.publisher ? page.blockedScenes : []}
          onChanged={onChanged}
        />
      </Section>

      <Section id="saves" title="SAVES AND PRIVACY">
        <SaveNotice
          mode={page.saveMode}
          connectOrigins={page.connectOrigins}
          signedIn={page.viewer.signedIn}
        />
      </Section>

      {page.credits || missing > 0 ? (
        <Section id="credits" title="CREDITS">
          <div className="flex flex-col gap-2">
            {page.credits ? (
              <TextLink href={page.credits.url} target="_blank" rel="noopener noreferrer" size="sm">
                Credits and licences for v{page.credits.version}
              </TextLink>
            ) : null}
            {missing > 0 ? (
              <Text as="p" size="sm" variant="muted">
                {missingLicencesLine(missing)}
              </Text>
            ) : null}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
