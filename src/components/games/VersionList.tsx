import {
  ArrowUp02Icon,
  Download04Icon,
  Link01Icon,
  MoreHorizontalIcon,
  PlayIcon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  releasePromoteMessage,
  releaseReplacesMessage,
  releaseRollbackMessage,
  sceneVersionName,
} from "@jams/engine/game";
import { Link } from "@tanstack/react-router";
import { Fragment, useState } from "react";

import {
  JamPickerField,
  type PickableJam,
} from "@/components/collab/CollabCreateFlyout/JamPickerField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TimeAgo } from "@/components/ui/time-ago";
import { Text } from "@/components/ui/typography";
import { RouterTextLink } from "@/components/ui/typography/router-text-link";
import { Well } from "@/components/ui/well";
import { downloadBlob } from "@/lib/download";
import type {
  GamePageBlockedScene,
  GamePageLiveScene,
  GamePageVersion,
} from "@/lib/engine/game-page";
import { readItchIssuesHeader, ITCH_ISSUES_HEADER } from "@/lib/engine/release-zip-header";
import { EDITOR_ROOM, editorSearch, engineReleaseZipPath } from "@/lib/engine/route-paths";
import { formatBytes } from "@/lib/format-bytes";
import { releaseDay } from "@/lib/jam-links";
import { toast } from "@/lib/toast";
import { client } from "@/orpc/client";

/** A version as the list shows it; a release id, when the payload carries it, names the version's zip. */
export type GameVersion = GamePageVersion & { id?: string };

/** `v7 · 12 Nov 2026 · 38 MB · engine 0.14.3` */
export function versionLine(
  version: Pick<GamePageVersion, "version" | "createdAt" | "bytes" | "engineVersion">,
): string {
  return [
    `v${version.version}`,
    releaseDay(version.createdAt),
    formatBytes(version.bytes),
    `engine ${version.engineVersion}`,
  ].join(" · ");
}

function badgesOf(version: GameVersion): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  if (version.hidden) out.push({ key: "hidden", label: "HIDDEN" });
  for (const badge of version.badges) {
    if (badge === "live") out.push({ key: "live", label: "LIVE" });
    else if (badge === "preview") out.push({ key: "preview", label: "PREVIEW" });
    else if (version.jams.length === 0) out.push({ key: "jam", label: "JAM VERSION" });
    else {
      for (const jam of version.jams) {
        out.push({ key: `jam-${jam.jamId}`, label: `JAM VERSION: ${jam.title}` });
      }
    }
  }
  return out;
}

/**
 * "with updated levels: The ford (12m ago)": the levels production plays
 * from live versions, at the end of the live version's row.
 */
export function LiveLevelsLine({ scenes }: { scenes: readonly GamePageLiveScene[] }) {
  return (
    <span data-live-levels="">
      with updated levels:{" "}
      {scenes.map((s, i) => (
        <Fragment key={s.scene}>
          {i > 0 ? ", " : null}
          {s.title} (<TimeAgo date={s.since} />)
        </Fragment>
      ))}
    </span>
  );
}

/** "The ford update blocked (5 of 12 players' games failed after this update)" */
export function blockedSceneLine(blocked: Pick<GamePageBlockedScene, "title" | "reason">): string {
  return blocked.reason
    ? `${blocked.title} update blocked (${blocked.reason})`
    : `${blocked.title} update blocked`;
}

/** Publishers only: each blocked level update on a version's channel, linking to the editor's Publish panel for its scene. */
function BlockedLevelsLine({
  projectId,
  blocked,
}: {
  projectId: string;
  blocked: readonly GamePageBlockedScene[];
}) {
  return (
    <ul aria-label="Blocked level updates" className="flex flex-col gap-0.5">
      {blocked.map((b) => (
        <li key={`${b.channel}:${b.scene}@${b.number}`}>
          <RouterTextLink
            to="/game/$roomId"
            params={{ roomId: EDITOR_ROOM }}
            search={editorSearch(projectId, { scene: b.scene, panel: "publish" })}
            size="xs"
            variant="danger"
            underline
          >
            {blockedSceneLine(b)}
          </RouterTextLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * What a promote asks when production plays live levels the new version
 * replaces: the release question, the levels it drops, and where to keep
 * the ones that still fit. Without any, the question is the plain string.
 */
function PromoteMessage({
  projectId,
  version,
  replaces,
}: {
  projectId: string;
  version: number;
  replaces: readonly GamePageLiveScene[];
}) {
  const scenes = replaces.map((s) => ({
    title: s.title,
    name: sceneVersionName(s.scene, s.number),
  }));
  return (
    <span className="flex flex-col gap-2">
      <span>{releasePromoteMessage(version)}</span>
      <span data-promote-replaces="">{releaseReplacesMessage(version, scenes)}</span>
      <span>
        To keep the ones that still fit, promote from the{" "}
        <RouterTextLink
          to="/game/$roomId"
          params={{ roomId: EDITOR_ROOM }}
          search={editorSearch(projectId, { panel: "publish" })}
          variant="inherit"
          underline
          className="text-xs/relaxed hover:text-foreground"
        >
          Publish panel in the editor
        </RouterTextLink>
        .
      </span>
    </span>
  );
}

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

type MenuDialog = "promote" | "rollback" | "jam" | null;

/** The file name a zip response's Content-Disposition gives, else `fallback`. */
function attachmentName(response: Response, fallback: string): string {
  const named = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "");
  return named?.[1] ?? fallback;
}

/**
 * Builds and saves a version's zip, saying so while the server packs it,
 * then what itch.io will make of its layout, so the publisher hears before
 * uploading it there.
 */
export async function downloadReleaseZip(
  input: { projectId: string; version: number; releaseId: string },
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const v = input.version;
  const pending = toast.loading(`Building the v${v} zip…`, {
    description: "Large games take a moment to pack.",
  });
  try {
    const response = await fetcher(engineReleaseZipPath(input.releaseId), {
      credentials: "same-origin",
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
      throw new Error(
        typeof body?.message === "string"
          ? body.message
          : `The zip didn't build (${response.status}).`,
      );
    }
    const issues = readItchIssuesHeader(response.headers.get(ITCH_ISSUES_HEADER));
    downloadBlob(attachmentName(response, `${input.projectId}-v${v}.zip`), await response.blob());
    toast.dismiss(pending);
    if (issues && issues.count > 0) {
      const more = issues.count - issues.messages.length;
      toast.warning(
        `v${v}'s zip has ${issues.count === 1 ? "1 thing" : `${issues.count} things`} to fix before itch.io takes it`,
        {
          description: [...issues.messages, ...(more > 0 ? [`…and ${more} more.`] : [])].join(" "),
          duration: Number.POSITIVE_INFINITY,
        },
      );
    } else {
      toast.success(`v${v}'s zip is downloading.`);
    }
  } catch (error) {
    toast.dismiss(pending);
    toast.error(errorText(error, "The zip didn't download. Try again."));
  }
}

type PublisherMenuProps = {
  projectId: string;
  version: GameVersion;
  liveVersion: number | null;
  /** The live levels production plays over `liveVersion`, which a promote replaces. */
  liveScenes: readonly GamePageLiveScene[];
  onChanged: () => void;
};

/** Promote, roll back, link to a jam, download: a publisher's actions on one version. */
function PublisherMenu({
  projectId,
  version,
  liveVersion,
  liveScenes,
  onChanged,
}: PublisherMenuProps) {
  const [dialog, setDialog] = useState<MenuDialog>(null);
  const [jam, setJam] = useState<PickableJam | null>(null);
  const v = version.version;
  const promote = version.actions.includes("promote");
  const rollback = version.actions.includes("rollback");
  const linkJam = version.actions.includes("jam-link");
  const zip = version.actions.includes("download-zip") ? version.id : undefined;
  if (!promote && !rollback && !linkJam && !zip) return null;

  const run = async (work: () => Promise<unknown>, done: string, failed: string) => {
    try {
      await work();
      toast.success(done);
      onChanged();
    } catch (error) {
      toast.error(errorText(error, failed));
      throw error;
    }
  };

  const close = (open: boolean) => {
    if (open) return;
    setDialog(null);
    setJam(null);
  };

  const label = `Actions for v${v}`;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" tooltip={label} aria-label={label} />}
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {promote ? (
            <DropdownMenuItem onClick={() => setDialog("promote")}>
              <HugeiconsIcon icon={ArrowUp02Icon} size={14} />
              Promote
            </DropdownMenuItem>
          ) : null}
          {rollback ? (
            <DropdownMenuItem onClick={() => setDialog("rollback")}>
              <HugeiconsIcon icon={Undo02Icon} size={14} />
              Roll back to this
            </DropdownMenuItem>
          ) : null}
          {linkJam ? (
            <DropdownMenuItem onClick={() => setDialog("jam")}>
              <HugeiconsIcon icon={Link01Icon} size={14} />
              Link to a jam…
            </DropdownMenuItem>
          ) : null}
          {zip ? (
            <DropdownMenuItem
              onClick={() => void downloadReleaseZip({ projectId, version: v, releaseId: zip })}
            >
              <HugeiconsIcon icon={Download04Icon} size={14} />
              Download zip
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Confirm
        open={dialog === "promote"}
        onOpenChange={close}
        title={`Promote v${v} to production?`}
        message={
          v === liveVersion || liveScenes.length === 0 ? (
            releasePromoteMessage(v)
          ) : (
            <PromoteMessage projectId={projectId} version={v} replaces={liveScenes} />
          )
        }
        confirmText="Promote"
        onConfirm={() =>
          run(
            () => client.promoteRelease({ projectId, version: v, channel: "production" }),
            `v${v} is live.`,
            "The version didn't move. Try again.",
          )
        }
      />
      <Confirm
        open={dialog === "rollback"}
        onOpenChange={close}
        title={`Roll back to v${v}?`}
        message={releaseRollbackMessage(v, liveVersion)}
        confirmText="Roll back"
        onConfirm={() =>
          run(
            () => client.rollbackRelease({ projectId, channel: "production", to: v }),
            `v${v} is live again.`,
            "The version didn't move. Try again.",
          )
        }
      />
      <Confirm
        open={dialog === "jam"}
        onOpenChange={close}
        title={`Link v${v} to a jam?`}
        message={
          <>
            <JamPickerField value={jam?.jamId} onChange={setJam} />
            <Text as="p" size="xs" variant="muted">
              Judges play this version from the jam's page. You can move it to another version until
              the jam ends.
            </Text>
          </>
        }
        confirmText="Link"
        confirmDisabled={jam === null}
        onConfirm={() => {
          if (!jam) return;
          return run(
            () => client.linkReleaseJam({ projectId, version: v, jamId: jam.jamId }),
            `v${v} is the version for ${jam.title}.`,
            "The jam link didn't save. Try again.",
          );
        }}
      />
    </>
  );
}

type VersionListProps = {
  projectId: string;
  versions: readonly GameVersion[];
  /** Shows each version's menu. */
  publisher: boolean;
  /** The version production plays. */
  liveVersion: number | null;
  /** The levels production plays from live versions over `liveVersion`. */
  liveScenes?: readonly GamePageLiveScene[];
  /** Publishers only: blocked level updates a channel still points at, shown on that channel's version. */
  blockedScenes?: readonly GamePageBlockedScene[];
  onChanged: () => void;
};

/** The live row's Play tooltip: it plays production, updated levels included. */
export const LIVE_LEVELS_PLAY = "Plays this version with its updated levels";

/** The channels a version is on, read from its LIVE and PREVIEW badges. */
const channelsOf = (version: GameVersion): GamePageBlockedScene["channel"][] => [
  ...(version.badges.includes("live") ? (["production"] as const) : []),
  ...(version.badges.includes("preview") ? (["preview"] as const) : []),
];

/** The versions this viewer may play, newest first, with a publisher's menu on each. */
export function VersionList({
  projectId,
  versions,
  publisher,
  liveVersion,
  liveScenes = [],
  blockedScenes = [],
  onChanged,
}: VersionListProps) {
  if (versions.length === 0) {
    return (
      <Text as="p" size="sm" variant="muted">
        There's no version here for you to play yet.
      </Text>
    );
  }
  // The live row plays what it lists: its version with the updated levels, as production does.
  const withLiveLevels = (version: GameVersion) =>
    version.version === liveVersion && liveScenes.length > 0;
  return (
    <Well className="gap-0 p-0 backdrop-blur-none">
      <ul aria-label="Versions" className="divide-y divide-dashed divide-muted/40">
        {versions.map((version) => (
          <li
            key={version.version}
            data-version={version.version}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Text as="span" size="sm" bold className="tabular-nums">
                {versionLine(version)}
              </Text>
              <Text as="span" size="xs" variant="muted">
                <TimeAgo date={version.createdAt} />
                {version.removalNotice ? <> · {version.removalNotice}</> : null}
                {version.hidden?.reason ? <> · Hidden: {version.hidden.reason}</> : null}
                {withLiveLevels(version) ? (
                  <>
                    {" · "}
                    <LiveLevelsLine scenes={liveScenes} />
                  </>
                ) : null}
              </Text>
              {publisher ? (
                <BlockedOn
                  projectId={projectId}
                  channels={channelsOf(version)}
                  blocked={blockedScenes}
                />
              ) : null}
            </span>
            {badgesOf(version).map((badge) => (
              <Badge
                key={badge.key}
                size="label"
                variant={badge.key === "live" ? "default" : "outline"}
              >
                {badge.label}
              </Badge>
            ))}
            {version.hidden ? null : (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                {...(withLiveLevels(version) ? { tooltip: LIVE_LEVELS_PLAY } : {})}
                render={
                  <Link
                    to="/games/$projectId/play/$version"
                    params={{
                      projectId,
                      version: withLiveLevels(version) ? "latest" : String(version.version),
                    }}
                  />
                }
              >
                <HugeiconsIcon icon={PlayIcon} data-icon="inline-start" />
                Play v{version.version}
              </Button>
            )}
            {publisher ? (
              <PublisherMenu
                projectId={projectId}
                version={version}
                liveVersion={liveVersion}
                liveScenes={liveScenes}
                onChanged={onChanged}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </Well>
  );
}

function BlockedOn({
  projectId,
  channels,
  blocked,
}: {
  projectId: string;
  channels: readonly GamePageBlockedScene["channel"][];
  blocked: readonly GamePageBlockedScene[];
}) {
  const here = blocked.filter((b) => channels.includes(b.channel));
  return here.length > 0 ? <BlockedLevelsLine projectId={projectId} blocked={here} /> : null;
}
