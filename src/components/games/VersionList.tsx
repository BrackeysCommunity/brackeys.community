import {
  ArrowUp02Icon,
  Download04Icon,
  Link01Icon,
  MoreHorizontalIcon,
  PlayIcon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

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
import { Well } from "@/components/ui/well";
import type { GamePageVersion } from "@/lib/engine/game-page";
import { readItchIssuesHeader, ITCH_ISSUES_HEADER } from "@/lib/engine/release-zip-header";
import { engineReleaseZipPath } from "@/lib/engine/route-paths";
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

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

type MenuDialog = "promote" | "rollback" | "jam" | null;

/** The file name a zip response's Content-Disposition gives, else `fallback`. */
function attachmentName(response: Response, fallback: string): string {
  const named = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "");
  return named?.[1] ?? fallback;
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
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
    saveBlob(await response.blob(), attachmentName(response, `${input.projectId}-v${v}.zip`));
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
  onChanged: () => void;
};

/** Promote, roll back, link to a jam, download: a publisher's actions on one version. */
function PublisherMenu({ projectId, version, liveVersion, onChanged }: PublisherMenuProps) {
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
        message={`Players will get v${v} the next time they open the game. You can roll back at any time.`}
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
        message={
          liveVersion === null
            ? `Players get v${v} again the next time they open the game.`
            : `Players get v${v} again the next time they open the game. v${liveVersion} stays in the list.`
        }
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
  onChanged: () => void;
};

/** The versions this viewer may play, newest first, with a publisher's menu on each. */
export function VersionList({
  projectId,
  versions,
  publisher,
  liveVersion,
  onChanged,
}: VersionListProps) {
  if (versions.length === 0) {
    return (
      <Text as="p" size="sm" variant="muted">
        There's no version here for you to play yet.
      </Text>
    );
  }
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
              </Text>
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
                render={
                  <Link
                    to="/games/$projectId/play/$version"
                    params={{ projectId, version: String(version.version) }}
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
                onChanged={onChanged}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </Well>
  );
}
