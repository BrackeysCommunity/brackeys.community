import { useRef, useState } from "react";

import { releasePromoteMessage } from "../../../game/live";
import type { AssetId } from "../../../project/index";
import { shortId } from "../../../scene/short-id";
import type { PublishChannel, ReleaseView } from "../../host";
import {
  Confirm,
  Badge,
  Button,
  MicroLabel,
  Skeleton,
  Switch,
  Text,
  TimeAgo,
  formatBytes,
} from "../../kit/index";

/** The pending scope a promote or rollback of `channel` runs under. */
export const channelScope = (channel: PublishChannel): string => `publish:channel:${channel}`;

/** What a release can't be moved to a channel for, or null when it can. */
export function unplayable(release: ReleaseView): string | null {
  if (release.collected) return "Its files have been removed.";
  if (release.hidden !== null) return `Hidden by staff: ${release.hidden}`;
  return null;
}

/** The release promote and rollback questions, shared with the game page. */
export {
  releasePromoteMessage as promoteMessage,
  releaseRollbackMessage as rollbackMessage,
} from "../../../game/live";

/** A live scene on production that a release promote replaces; `fits` when it may be kept over the new release. */
export type ReplacedScene = {
  scene: AssetId;
  /** `level-1@4`. */
  name: string;
  /** The scene's title, or its id when the editor has none. */
  title: string;
  fits: boolean;
};

/** The live scenes a promote of a release replaces, and whether the promoter may keep the ones that fit. */
export type PromoteReplaces = {
  read: () => Promise<readonly ReplacedScene[]>;
  canKeep: boolean;
};

/** A button that moves production to `version`, after asking; with `replaces`, the question lists the live scenes it replaces. */
export function PromoteButton({
  version,
  label,
  onPromote,
  replaces,
  size = "xs",
  variant = "outline",
}: {
  version: number;
  label: string;
  /** `keep`: the live scenes chosen to stay on production. */
  onPromote: (keep: readonly AssetId[]) => Promise<unknown>;
  replaces?: PromoteReplaces;
  size?: "xs" | "sm";
  variant?: "default" | "outline";
}) {
  const [scenes, setScenes] = useState<readonly ReplacedScene[]>([]);
  const [reading, setReading] = useState<"idle" | "loading" | "failed">("idle");
  const [keep, setKeep] = useState<ReadonlySet<AssetId>>(new Set());
  const asked = useRef(0);
  const onOpenChange = (open: boolean) => {
    if (!open || !replaces) return;
    const id = ++asked.current;
    setScenes([]);
    setKeep(new Set());
    setReading("loading");
    replaces.read().then(
      (read) => {
        if (id !== asked.current) return;
        setScenes(read);
        setReading("idle");
      },
      () => {
        if (id === asked.current) setReading("failed");
      },
    );
  };
  const kept = scenes.filter((s) => keep.has(s.scene) && s.fits).map((s) => s.scene);
  const keepable = replaces?.canKeep ? scenes.filter((s) => s.fits) : [];
  return (
    <Confirm
      title={`Promote v${version} to production?`}
      message={
        reading !== "idle" ? (
          <div className="je-insp-stack" data-gap="tight">
            <Text as="p" size="sm" variant="muted">
              {releasePromoteMessage(version)}
            </Text>
            {reading === "loading" ? (
              <Skeleton style={{ height: 16 }} />
            ) : (
              <Text as="p" size="sm" variant="muted">
                {REPLACES_UNREAD}
              </Text>
            )}
          </div>
        ) : scenes.length === 0 ? (
          releasePromoteMessage(version)
        ) : (
          <div className="je-insp-stack" data-gap="tight">
            <Text as="p" size="sm" variant="muted">
              {releasePromoteMessage(version)}
            </Text>
            <Text as="p" size="sm">
              {replacesMessage(version, scenes)}
            </Text>
            {keepable.length > 0 ? (
              <div className="je-insp-stack" data-gap="tight" aria-label="Keep">
                <MicroLabel as="div">Keep</MicroLabel>
                {keepable.map((s) => (
                  <label key={s.scene} className="je-insp-row" data-gap="tight">
                    <Switch
                      checked={keep.has(s.scene)}
                      aria-label={`Keep ${s.title}`}
                      onCheckedChange={(on) =>
                        setKeep((last) => {
                          const next = new Set(last);
                          if (on) next.add(s.scene);
                          else next.delete(s.scene);
                          return next;
                        })
                      }
                    />
                    <Text size="sm">
                      {s.title} (still fits v{version})
                    </Text>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        )
      }
      confirmText="Promote"
      confirmDisabled={reading === "loading"}
      onOpenChange={onOpenChange}
      onConfirm={() => onPromote(kept)}
    >
      <Button size={size} variant={variant} busyScope={channelScope("production")}>
        {label}
      </Button>
    </Confirm>
  );
}

/** Said in the promote question when the live scenes it replaces couldn't be read. */
export const REPLACES_UNREAD = "Couldn't check the live scenes this replaces.";

/** "Promoting v8 replaces these live scenes: The ford (level-1@4)." */
const replacesMessage = (version: number, scenes: readonly ReplacedScene[]): string =>
  `Promoting v${version} replaces these live scenes: ${scenes.map((s) => `${s.title} (${s.name})`).join(", ")}.`;

/** Every release, newest first, with its channels, pins and cleanup date. */
export function ReleaseList({
  releases,
  onPromote,
  replaces,
}: {
  releases: readonly ReleaseView[];
  onPromote: (version: number, keep: readonly AssetId[]) => Promise<unknown>;
  /** The live scenes a promote of `version` replaces; none without live scenes. */
  replaces?: (version: number) => PromoteReplaces;
}) {
  return (
    <div className="je-insp-stack" role="list" aria-label="Releases">
      <MicroLabel>Releases</MicroLabel>
      {releases.map((release) => (
        <ReleaseRow
          key={release.id}
          release={release}
          onPromote={onPromote}
          replaces={replaces?.(release.version)}
        />
      ))}
    </div>
  );
}

function ReleaseRow({
  release,
  onPromote,
  replaces,
}: {
  release: ReleaseView;
  onPromote: (version: number, keep: readonly AssetId[]) => Promise<unknown>;
  replaces: PromoteReplaces | undefined;
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
        {blocked === null ? (
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
            onPromote={(keep) => onPromote(release.version, keep)}
            replaces={replaces}
          />
        ) : null}
      </div>
    </div>
  );
}
