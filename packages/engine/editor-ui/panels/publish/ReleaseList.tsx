import type { PublishChannel, ReleaseView } from "../../host";
import { Confirm, Badge, Button, MicroLabel, Text, TimeAgo, formatBytes } from "../../kit/index";

/** The pending scope a promote or rollback of `channel` runs under. */
export const channelScope = (channel: PublishChannel): string => `publish:channel:${channel}`;

/** What a release can't be moved to a channel for, or null when it can. */
export function unplayable(release: ReleaseView): string | null {
  if (release.collected) return "Its files have been removed.";
  if (release.hidden !== null) return `Hidden by staff: ${release.hidden}`;
  return null;
}

/** The first twelve hex digits of a release id, as the CLI prints it. */
export const shortId = (id: string): string => id.slice(0, 12);

/** A button that moves production to `version`, after asking. */
export function PromoteButton({
  version,
  label,
  onPromote,
  size = "xs",
  variant = "outline",
}: {
  version: number;
  label: string;
  onPromote: () => Promise<unknown>;
  size?: "xs" | "sm";
  variant?: "default" | "outline";
}) {
  return (
    <Confirm
      title={`Promote v${version} to production?`}
      message={`Players will get v${version} the next time they open the game. You can roll back at any time.`}
      confirmText="Promote"
      onConfirm={onPromote}
    >
      <Button size={size} variant={variant} busyScope={channelScope("production")}>
        {label}
      </Button>
    </Confirm>
  );
}

/** Every release, newest first, with its channels, pins and cleanup date. */
export function ReleaseList({
  releases,
  onPromote,
}: {
  releases: readonly ReleaseView[];
  onPromote: (version: number) => Promise<unknown>;
}) {
  return (
    <div className="je-insp-stack" role="list" aria-label="Releases">
      <MicroLabel>Releases</MicroLabel>
      {releases.map((release) => (
        <ReleaseRow key={release.id} release={release} onPromote={onPromote} />
      ))}
    </div>
  );
}

function ReleaseRow({
  release,
  onPromote,
}: {
  release: ReleaseView;
  onPromote: (version: number) => Promise<unknown>;
}) {
  const blocked = unplayable(release);
  const live = release.channels.includes("production");
  return (
    <div role="listitem" className="je-insp-stack" data-gap="tight">
      <div className="je-insp-row je-insp-wrap" data-gap="tight">
        <Text size="sm" bold tabular>
          v{release.version}
        </Text>
        {release.channels.map((channel) => (
          <Badge
            key={channel}
            size="label"
            variant={channel === "production" ? "success" : "secondary"}
          >
            {channel}
          </Badge>
        ))}
        {release.jams.map((jam) => (
          <Badge key={jam} size="label" variant="outline">
            {jam}
          </Badge>
        ))}
        {release.hidden !== null ? (
          <Badge size="label" variant="destructive">
            hidden
          </Badge>
        ) : null}
        {release.collected ? (
          <Badge size="label" variant="ghost">
            removed
          </Badge>
        ) : release.removal ? (
          <Badge size="label" variant="warning">
            removed soon
          </Badge>
        ) : null}
      </div>
      <Text as="p" size="xs" variant="muted" tabular>
        {shortId(release.id)} · {formatBytes(release.bytes)} · engine {release.engine} · uploaded{" "}
        <TimeAgo date={release.createdAt} />
      </Text>
      {release.hidden !== null ? (
        <Text as="p" size="xs" variant="danger">
          {release.hidden}
        </Text>
      ) : null}
      <div className="je-insp-row" data-gap="tight">
        {!release.collected ? (
          <Button
            size="xs"
            variant="ghost"
            render={
              <a
                href={release.playUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Play v${release.version}`}
              />
            }
            nativeButton={false}
            cue={null}
          >
            Play
          </Button>
        ) : null}
        {!live && blocked === null ? (
          <PromoteButton
            version={release.version}
            label="Promote"
            variant="outline"
            onPromote={() => onPromote(release.version)}
          />
        ) : null}
      </div>
    </div>
  );
}
