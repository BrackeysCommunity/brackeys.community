import { Cancel01Icon, Copy01Icon } from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useRef, useState } from "react";

import { timingWords, type SwapTiming } from "../../../game/live";
import {
  checkSceneVersion,
  parseReleaseManifest,
  parseSceneVersion,
  type AssetId,
} from "../../../project/index";
import type {
  EditorLiveHost,
  EditorNotify,
  EditorPublishHost,
  GameSaveMode,
  GameSettingsPatch,
  GameSettingsView,
  GameVisibility,
  LivePointerView,
  LiveVersionView,
  PublishChannel,
  ReleaseView,
  UsageView,
} from "../../host";
import { formatDay } from "../../kit/format";
import {
  Badge,
  Button,
  Confirm,
  IconButton,
  Input,
  MicroLabel,
  Radio,
  Skeleton,
  Text,
  TimeAgo,
} from "../../kit/index";
import type { Pending } from "../../pending/pending";
import { PendingProvider, useBusy, useOwnOrSharedPending } from "../../pending/use-pending";
import {
  channelScope,
  PromoteButton,
  ReleaseList,
  rollbackMessage,
  unplayable,
  type PromoteReplaces,
  type ReplacedScene,
} from "./ReleaseList";

const SETTINGS_SCOPE = "publish:settings";

const VISIBILITIES = [
  "private",
  "team",
  "unlisted",
  "public",
] as const satisfies readonly GameVisibility[];
const SAVE_MODES = ["site", "own", "none"] as const satisfies readonly GameSaveMode[];

type Loaded<T> =
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "error"; message: string };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** `read()` on mount and on `reload()`; a reply to an older call is dropped. */
function useLoaded<T>(read: () => Promise<T>): [Loaded<T>, () => void, (value: T) => void] {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const call = useRef(0);
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  });
  const load = useCallback(() => {
    const id = ++call.current;
    readRef.current().then(
      (value) => {
        if (id === call.current) setLoaded({ state: "ready", value });
      },
      (error: unknown) => {
        if (id === call.current) setLoaded({ state: "error", message: messageOf(error) });
      },
    );
  }, []);
  const reload = useCallback(() => {
    setLoaded((last) => (last.state === "ready" ? last : { state: "loading" }));
    load();
  }, [load]);
  const set = useCallback((value: T) => {
    call.current++;
    setLoaded({ state: "ready", value });
  }, []);
  useEffect(load, [load]);
  return [loaded, reload, set];
}

const silentNotify: EditorNotify = Object.assign(() => undefined, {
  success: () => undefined,
  warning: () => undefined,
  error: () => undefined,
});

/** A scene's title for the editor's rows, or undefined when it has none. */
export type SceneTitleOf = (scene: AssetId) => string | undefined;

/** The project's releases, channels, live scenes and usage before publishing; nothing while the host doesn't publish. */
export function PublishPanel({
  publish,
  notify,
  sceneTitle,
}: {
  publish: EditorPublishHost | undefined;
  /** Where copies and failures outside a pending task are said; the editor's toasts. */
  notify?: EditorNotify;
  /** Names the live scenes' rows by title; without it they go by their version name alone. */
  sceneTitle?: SceneTitleOf;
}) {
  if (!publish) return null;
  return (
    <PublishBody
      key={publish.project}
      publish={publish}
      notify={notify ?? silentNotify}
      sceneTitle={sceneTitle ?? noTitle}
    />
  );
}

const noTitle: SceneTitleOf = () => undefined;
const noLiveVersions = async (): Promise<readonly LiveVersionView[]> => [];

function PublishBody({
  publish,
  notify,
  sceneTitle,
}: {
  publish: EditorPublishHost;
  notify: EditorNotify;
  sceneTitle: SceneTitleOf;
}) {
  const pending = useOwnOrSharedPending(notify);
  const live = publish.live;
  const [usage, reloadUsage] = useLoaded(() => publish.usage());
  const [releases, reloadReleases] = useLoaded(() => publish.releases());
  const [liveVersions, reloadLive] = useLoaded(() => (live ? live.list() : noLiveVersions()));

  const move = async <T extends { to: number }>(
    label: string,
    channel: "production",
    work: () => Promise<T>,
    error: string,
  ) => {
    const result = await pending.run(
      {
        label,
        scope: channelScope(channel),
        success: (moved) => `v${moved.to} is on production.`,
        error,
      },
      work,
    );
    reloadReleases();
    reloadUsage();
    if (live) reloadLive();
    return result;
  };
  const promote = async (version: number, keep: readonly AssetId[] = []) =>
    (
      await move(
        `Promoting v${version}`,
        "production",
        () =>
          keep.length > 0
            ? publish.promote(version, "production", { keepScenes: keep })
            : publish.promote(version, "production"),
        `Couldn't promote v${version}`,
      )
    ).ok;
  const rollback = async (to: number) => {
    const result = await move(
      `Rolling back to v${to}`,
      "production",
      () => publish.rollback("production", to),
      `Couldn't roll back to v${to}`,
    );
    if (result.ok) for (const s of result.value.skipped ?? []) notify.warning(s.reason);
    return result.ok;
  };
  const replaces =
    live && releases.state === "ready"
      ? (version: number): PromoteReplaces => ({
          read: () => replacedScenes(live, version, releases.value, sceneTitle),
          canKeep: live.role().publisher,
        })
      : undefined;

  return (
    <PendingProvider pending={pending}>
      <section className="je-scene-panel je-scene-panel-scroll" aria-label="Publish">
        <div className="je-insp-stack">
          <Text as="p" size="sm" bold>
            Publish
          </Text>
          {releases.state === "ready" && releases.value.length === 0 ? (
            <ReleaseCommand publish={publish} notify={notify} />
          ) : null}
          <UsageLines usage={usage} onRetry={reloadUsage} />
          {releases.state === "loading" ? (
            <Skeleton style={{ height: 48 }} />
          ) : releases.state === "error" ? (
            <LoadError
              what="Couldn't load the releases."
              message={releases.message}
              onRetry={reloadReleases}
            />
          ) : releases.value.length > 0 ? (
            <>
              <Channels
                releases={releases.value}
                onPromote={promote}
                onRollback={rollback}
                replaces={replaces}
              />
              {live ? (
                <LiveScenes
                  live={live}
                  versions={liveVersions}
                  releases={releases.value}
                  sceneTitle={sceneTitle}
                  pending={pending}
                  onRetry={reloadLive}
                  onMoved={reloadLive}
                />
              ) : null}
              <RemovedSoon releases={releases.value} />
              <ReleaseList releases={releases.value} onPromote={promote} replaces={replaces} />
            </>
          ) : null}
          <GameSettings publish={publish} pending={pending} />
        </div>
      </section>
    </PendingProvider>
  );
}

function LoadError({
  what,
  message,
  onRetry,
}: {
  what: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="je-insp-stack" role="alert" data-gap="tight">
      <Text as="p" size="xs" variant="danger">
        {what} {message}
      </Text>
      <div className="je-insp-row">
        <Button size="xs" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

function ReleaseCommand({ publish, notify }: { publish: EditorPublishHost; notify: EditorNotify }) {
  const { command, noRelease, token } = publish.wording;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      notify.success("Copied the command.");
    } catch (error) {
      notify.error("Couldn't copy the command", { description: messageOf(error) });
    }
  };
  return (
    <div className="je-insp-stack" aria-label="Create a release">
      <Text as="p" size="xs">
        {noRelease}
      </Text>
      <div className="je-insp-row" data-gap="tight">
        <Text as="div" size="xs" className="je-insp-grow">
          <code>{command}</code>
        </Text>
        <IconButton
          size="icon-xs"
          icon={Copy01Icon}
          label="Copy the command"
          onClick={() => void copy()}
        />
      </div>
      <div className="je-insp-row je-insp-wrap" data-gap="tight">
        <Text size="xs" variant="muted">
          {token}
        </Text>
        <Button size="xs" variant="link" onClick={() => publish.openTokenDialog()}>
          Create one
        </Button>
      </div>
    </div>
  );
}

function UsageLines({ usage, onRetry }: { usage: Loaded<UsageView>; onRetry: () => void }) {
  if (usage.state === "loading") return <Skeleton style={{ height: 32 }} />;
  if (usage.state === "error")
    return <LoadError what="Couldn't load the usage." message={usage.message} onRetry={onRetry} />;
  const { lines, notice } = usage.value;
  return (
    <div className="je-insp-stack" data-gap="tight" aria-label="Usage before publishing">
      <MicroLabel>Usage</MicroLabel>
      {lines.map((line) => (
        <Text
          key={line.quota}
          as="p"
          size="xs"
          tabular
          variant={line.level === "full" ? "danger" : line.level === "warn" ? "warning" : "primary"}
        >
          {line.text}
        </Text>
      ))}
      {notice ? (
        <Text
          as="p"
          size="xs"
          role="status"
          variant={notice.level === "full" ? "danger" : "warning"}
        >
          {notice.text}
        </Text>
      ) : null}
    </div>
  );
}

/** The newest release production was on before `current`, that can still be played. */
function rollbackTarget(
  releases: readonly ReleaseView[],
  current: ReleaseView | undefined,
): ReleaseView | undefined {
  if (!current) return undefined;
  return releases.find(
    (r) => r.version < current.version && r.firstPromotedAt !== null && unplayable(r) === null,
  );
}

function Channels({
  releases,
  onPromote,
  onRollback,
  replaces,
}: {
  releases: readonly ReleaseView[];
  onPromote: (version: number, keep: readonly AssetId[]) => Promise<boolean>;
  onRollback: (version: number) => Promise<boolean>;
  replaces: ((version: number) => PromoteReplaces) | undefined;
}) {
  const production = releases.find((r) => r.channels.includes("production"));
  const preview = releases.find((r) => r.channels.includes("preview"));
  const back = rollbackTarget(releases, production);
  const canPromote =
    preview !== undefined && preview !== production && unplayable(preview) === null;
  return (
    <div className="je-insp-stack" data-gap="tight" aria-label="Channels">
      <MicroLabel>Channels</MicroLabel>
      <Text as="p" size="xs" tabular>
        {production
          ? `Production: v${production.version}${production.firstPromotedAt ? ` (first live ${formatDay(production.firstPromotedAt)})` : ""}`
          : "Production: none yet"}
      </Text>
      <Text as="p" size="xs" tabular>
        {preview ? `Preview: v${preview.version}` : "Preview: none"}
      </Text>
      <div className="je-insp-row je-insp-wrap" data-gap="tight">
        {canPromote ? (
          <PromoteButton
            version={preview.version}
            label={`Promote v${preview.version} to production`}
            variant="default"
            onPromote={(keep) => onPromote(preview.version, keep)}
            replaces={replaces?.(preview.version)}
          />
        ) : null}
        {back ? (
          <Confirm
            title={`Roll back to v${back.version}?`}
            message={rollbackMessage(back.version, production?.version ?? null)}
            confirmText="Roll back"
            onConfirm={() => onRollback(back.version)}
          >
            <Button size="xs" variant="outline" busyScope={channelScope("production")}>
              Roll back production to v{back.version}
            </Button>
          </Confirm>
        ) : null}
      </div>
    </div>
  );
}

function RemovedSoon({ releases }: { releases: readonly ReleaseView[] }) {
  const due = releases.filter((r) => r.removal !== null && !r.collected);
  if (due.length === 0) return null;
  return (
    <div className="je-insp-stack" data-gap="tight" aria-label="Removed soon">
      <MicroLabel>Removed soon</MicroLabel>
      {due.map((r) => (
        <Text key={r.id} as="p" size="xs" variant="warning">
          {r.removal?.text}
        </Text>
      ))}
    </div>
  );
}

// ─── Live scenes ─────────────────────────────────────────

const CHANNELS = ["production", "preview"] as const satisfies readonly PublishChannel[];
const CHANNEL_TITLE = { production: "Production", preview: "Preview" } as const;
const PUBLISHERS_ONLY = "Only publishers can change production.";

/** `level-1@4`: a scene version as the CLI and the site name it. */
export const liveName = (scene: AssetId, number: number): string => `${scene}@${number}`;

/** When a production move reaches players, after "Players will get level-1@4 ". */
const PLAYERS_GET: Readonly<Record<SwapTiming, string>> = {
  "next-load": "next time the level loads",
  boundary: "at the next safe moment",
  now: "now",
};

/** The question a move of `name` to production asks. */
export const livePromoteMessage = (name: string, timing: SwapTiming): string =>
  `Players will get ${name} ${PLAYERS_GET[timing]}. You can roll back or stop it at any time.`;

/** The question Unblock asks. */
const unblockMessage = (name: string): string => `Players will get ${name} again.`;

/** The live scenes' pending scope: one per scene and channel, so a row's buttons go busy together. */
const liveScope = (scene: AssetId, channel: PublishChannel): string =>
  `publish:live:${channel}:${scene}`;

/**
 * Whether the scene version `descriptor` (its `scene-version.json`) may
 * stay live over the release `manifest` (its `release.json`): both read,
 * and the version check finds no error.
 */
export function stillFits(manifest: string, descriptor: string): boolean {
  const release = parseReleaseManifest(manifest);
  const version = parseSceneVersion(descriptor);
  if (!release.ok || !version.ok) return false;
  return !checkSceneVersion(release.manifest, version.version).some((i) => i.severity === "error");
}

/**
 * The live scenes on production that promoting `version` replaces. Only the
 * release on preview can be checked here (its manifest is preview's base);
 * any other release's scenes are listed without the offer to keep them.
 */
async function replacedScenes(
  live: EditorLiveHost,
  version: number,
  releases: readonly ReleaseView[],
  sceneTitle: SceneTitleOf,
): Promise<ReplacedScene[]> {
  const onPreview = releases.some((r) => r.version === version && r.channels.includes("preview"));
  const onProduction = (await live.list()).filter((v) =>
    v.pointers.some((p) => p.channel === "production"),
  );
  const fits = async (v: LiveVersionView): Promise<boolean> => {
    if (!onPreview || v.blocked || v.hidden !== null || v.collected) return false;
    try {
      const [target, current] = await Promise.all([
        live.base(v.scene, "preview"),
        live.base(v.scene, "production"),
      ]);
      if (target.release?.version !== version || current.live?.number !== v.number) return false;
      return stillFits(target.release.manifest, current.live.descriptor);
    } catch {
      return false;
    }
  };
  return Promise.all(
    onProduction.map(async (v) => ({
      scene: v.scene,
      name: liveName(v.scene, v.number),
      title: sceneTitle(v.scene) ?? v.scene,
      fits: await fits(v),
    })),
  );
}

type LiveRow = { version: LiveVersionView; pointer: LivePointerView };

function LiveScenes({
  live,
  versions,
  releases,
  sceneTitle,
  pending,
  onRetry,
  onMoved,
}: {
  live: EditorLiveHost;
  versions: Loaded<readonly LiveVersionView[]>;
  releases: readonly ReleaseView[];
  sceneTitle: SceneTitleOf;
  pending: Pending;
  onRetry: () => void;
  onMoved: () => void;
}) {
  if (versions.state === "loading") return <Skeleton style={{ height: 32 }} />;
  if (versions.state === "error")
    return (
      <LoadError
        what="Couldn't load the live scenes."
        message={versions.message}
        onRetry={onRetry}
      />
    );
  const rows = versions.value.flatMap((version) =>
    version.pointers.map((pointer): LiveRow => ({ version, pointer })),
  );
  const due = versions.value.filter((v) => v.removal !== null && !v.collected);
  const publisher = live.role().publisher;
  return (
    <div className="je-insp-stack" data-gap="tight" aria-label="Live scenes">
      <MicroLabel>Live scenes</MicroLabel>
      {rows.length === 0 ? (
        <Text as="p" size="xs" variant="muted">
          No live scenes. Publish a scene from the editor to update one level without a release.
        </Text>
      ) : (
        CHANNELS.map((channel) => {
          const here = rows.filter((r) => r.pointer.channel === channel);
          if (here.length === 0) return null;
          const release = releases.find((r) => r.channels.includes(channel));
          return (
            <div
              key={channel}
              className="je-insp-stack"
              data-gap="tight"
              role="list"
              aria-label={`Live on ${channel}`}
            >
              <Text as="p" size="xs" bold>
                {CHANNEL_TITLE[channel]}
              </Text>
              {here.map((row) => (
                <LiveSceneRow
                  key={`${row.version.scene}:${channel}`}
                  row={row}
                  live={live}
                  release={release?.version ?? null}
                  onProduction={rows.find(
                    (r) =>
                      r.pointer.channel === "production" && r.version.scene === row.version.scene,
                  )}
                  title={sceneTitle(row.version.scene)}
                  publisher={publisher}
                  pending={pending}
                  onMoved={onMoved}
                />
              ))}
            </div>
          );
        })
      )}
      {due.map((v) => (
        <Text key={v.id} as="p" size="xs" variant="warning">
          {v.removal?.text}
        </Text>
      ))}
    </div>
  );
}

function LiveSceneRow({
  row: { version, pointer },
  live,
  release,
  onProduction,
  title,
  publisher,
  pending,
  onMoved,
}: {
  row: LiveRow;
  live: EditorLiveHost;
  /** The channel's release version; null when the channel has none. */
  release: number | null;
  /** The scene's row on production, when it has one. */
  onProduction: LiveRow | undefined;
  title: string | undefined;
  publisher: boolean;
  pending: Pending;
  onMoved: () => void;
}) {
  const { scene, number } = version;
  const { channel, timing } = pointer;
  const name = liveName(scene, number);
  const called = title ?? scene;
  const scope = liveScope(scene, channel);
  const unblockScope = `publish:live:unblock:${name}`;
  const locked = channel === "production" && !publisher;
  const lockedTip = locked ? { tooltip: PUBLISHERS_ONLY } : {};
  const unblockLocked = !publisher && version.pointers.some((p) => p.channel === "production");

  const act = async <T,>(
    label: string,
    error: string,
    success: (value: T) => string,
    work: () => Promise<T>,
    at = scope,
  ) => {
    const result = await pending.run({ label, scope: at, success, error }, work);
    onMoved();
    return result.ok;
  };
  const movedWords = (to: number | null, on: PublishChannel) =>
    to === null
      ? `${called} plays the release's version on ${on} again.`
      : `${liveName(scene, to)} is live on ${on}.`;

  const canPromote =
    channel === "preview" && version.blocked === null && onProduction?.version.number !== number;

  return (
    <div role="listitem" className="je-insp-stack" data-gap="tight">
      <Text as="p" size="xs" tabular>
        {title ? `${title} · ` : ""}
        {name} · {timingWords(timing)} · <TimeAgo date={pointer.since} />
        {pointer.by ? ` · ${pointer.by}` : ""}
      </Text>
      {version.blocked ? (
        <div className="je-insp-row je-insp-wrap" data-gap="tight" data-align="start">
          <Badge size="label" variant="destructive">
            blocked
          </Badge>
          <Text size="xs" variant="danger" className="je-insp-grow">
            {version.blocked.text}
          </Text>
          <Confirm
            title={`Unblock ${name}?`}
            message={unblockMessage(name)}
            confirmText="Unblock"
            onConfirm={() =>
              act(
                `Unblocking ${name}`,
                `Couldn't unblock ${name}`,
                () => `${name} is unblocked.`,
                () => live.unblock(scene, number),
                unblockScope,
              )
            }
          >
            <Button
              size="xs"
              variant="outline"
              busyScope={unblockScope}
              disabled={unblockLocked}
              {...(unblockLocked ? { tooltip: PUBLISHERS_ONLY } : {})}
            >
              Unblock
            </Button>
          </Confirm>
        </div>
      ) : null}
      <div className="je-insp-row je-insp-wrap" data-gap="tight">
        {canPromote ? (
          <Confirm
            title={`Promote ${name} to production?`}
            message={livePromoteMessage(name, timing)}
            confirmText="Promote"
            onConfirm={() =>
              act(
                `Promoting ${name}`,
                `Couldn't promote ${name}`,
                (moved: { to: number | null }) => movedWords(moved.to, "production"),
                () => live.promote(scene, number, "production", timing),
                liveScope(scene, "production"),
              )
            }
          >
            <Button
              size="xs"
              variant="default"
              busyScope={liveScope(scene, "production")}
              disabled={!publisher}
              {...(!publisher ? { tooltip: PUBLISHERS_ONLY } : {})}
            >
              Promote to production
            </Button>
          </Confirm>
        ) : null}
        <Button
          size="xs"
          variant="outline"
          busyScope={scope}
          disabled={locked}
          {...lockedTip}
          onClick={() =>
            void act(
              `Rolling back ${called} on ${channel}`,
              `Couldn't roll back ${called} on ${channel}`,
              (moved: { to: number | null }) => movedWords(moved.to, channel),
              () => live.rollback(scene, channel, { timing }),
            )
          }
        >
          Roll back
        </Button>
        <Confirm
          title={`Stop ${name} on ${channel}?`}
          message={
            release === null
              ? `Players go back to the release's version of ${called}.`
              : live.wording.stopConfirm({ release, scene: called, timing })
          }
          confirmText="Stop"
          variant="destructive"
          onConfirm={() =>
            act(
              `Stopping ${name} on ${channel}`,
              `Couldn't stop ${name}`,
              () => movedWords(null, channel),
              () => live.clear(scene, channel, timing),
            )
          }
        >
          <Button size="xs" variant="outline" busyScope={scope} disabled={locked} {...lockedTip}>
            Stop
          </Button>
        </Confirm>
      </div>
    </div>
  );
}

/** "https://api.example.com/x" → "https://api.example.com"; null for anything but an https or wss URL. */
export function originOf(text: string): string | null {
  try {
    const url = new URL(text.trim());
    if ((url.protocol !== "https:" && url.protocol !== "wss:") || !url.host) return null;
    return `${url.protocol}//${url.host.toLowerCase()}`;
  } catch {
    return null;
  }
}

function GameSettings({ publish, pending }: { publish: EditorPublishHost; pending: Pending }) {
  const [settings, reload, set] = useLoaded(() => publish.settings());
  const [saveError, setSaveError] = useState<string | null>(null);
  const busy = useBusy(SETTINGS_SCOPE) !== undefined;

  if (settings.state === "loading") return <Skeleton style={{ height: 64 }} />;
  if (settings.state === "error")
    return (
      <LoadError
        what="Couldn't load the game's settings."
        message={settings.message}
        onRetry={reload}
      />
    );

  const view = settings.value;
  const save = async (patch: GameSettingsPatch, label: string) => {
    const result = await pending.run(
      { label, scope: SETTINGS_SCOPE, error: "Couldn't save the game's settings" },
      () => publish.setSettings(patch),
    );
    if (result.ok) {
      setSaveError(null);
      set(result.value);
    } else {
      setSaveError(messageOf(result.error));
    }
    return result.ok;
  };

  return (
    <div className="je-insp-stack" aria-label="Game settings">
      <ChoiceGroup
        legend="Visibility"
        name={`${publish.project}:visibility`}
        choices={VISIBILITIES}
        value={view.visibility}
        text={publish.wording.visibility}
        disabled={busy}
        unavailable={(v) => v === "team" && view.team === null}
        onPick={(visibility) => void save({ visibility }, "Changing who can play")}
      />
      {view.reviewPending ? (
        <Text as="p" size="xs" variant="warning">
          Waiting for staff review; the game stays unlisted until then.
        </Text>
      ) : null}
      <Text as="p" size="xs" variant="muted">
        {publish.wording.privateLinks}
      </Text>
      <ChoiceGroup
        legend="Where this game saves"
        name={`${publish.project}:save-mode`}
        choices={SAVE_MODES}
        value={view.saveMode}
        text={publish.wording.saveModes}
        disabled={busy}
        unavailable={(mode) => mode === "own" && view.connectOrigins.length === 0}
        onPick={(saveMode) => void save({ saveMode }, "Changing where the game saves")}
      />
      {view.saveMode !== "own" && view.connectOrigins.length === 0 ? (
        <Text as="p" size="xs" variant="muted">
          To save on the game's own servers, add the save server under Connects to first.
        </Text>
      ) : null}
      <ConnectsTo
        view={view}
        text={publish.wording.connectsTo}
        max={publish.wording.connectOriginsMax}
        disabled={busy}
        onChange={(connectOrigins) => save({ connectOrigins }, "Changing the game's origins")}
      />
      {saveError ? (
        <Text as="p" size="xs" variant="danger" role="alert">
          Not saved: {saveError}
        </Text>
      ) : null}
    </div>
  );
}

function ChoiceGroup<T extends string>({
  legend,
  name,
  choices,
  value,
  text,
  disabled,
  unavailable,
  onPick,
}: {
  legend: string;
  name: string;
  choices: readonly T[];
  value: T;
  text: Readonly<Record<T, string>>;
  disabled: boolean;
  unavailable?: (choice: T) => boolean;
  onPick: (choice: T) => void;
}) {
  return (
    <div className="je-insp-stack" data-gap="tight" role="radiogroup" aria-label={legend}>
      <MicroLabel as="div">{legend}</MicroLabel>
      {choices.map((choice) => (
        <label key={choice} className="je-insp-row" data-align="start" data-gap="tight">
          <Radio
            name={name}
            value={choice}
            checked={value === choice}
            disabled={disabled || unavailable?.(choice)}
            onChange={() => onPick(choice)}
          />
          <Text size="xs">{text[choice]}</Text>
        </label>
      ))}
    </div>
  );
}

function ConnectsTo({
  view,
  text,
  max,
  disabled,
  onChange,
}: {
  view: GameSettingsView;
  text: string;
  max: number;
  disabled: boolean;
  onChange: (origins: readonly string[]) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const full = view.connectOrigins.length >= max;
  const add = async () => {
    const origin = originOf(draft);
    if (!origin) return setInvalid(true);
    setInvalid(false);
    if (view.connectOrigins.includes(origin)) return setDraft("");
    if (view.connectOrigins.length >= max) return;
    if (await onChange([...view.connectOrigins, origin])) setDraft("");
  };
  return (
    <div className="je-insp-stack" data-gap="tight" aria-label="Connects to">
      <MicroLabel>Connects to</MicroLabel>
      <Text as="p" size="xs" variant="muted">
        {text}
      </Text>
      {view.connectOrigins.map((origin) => (
        <div key={origin} className="je-insp-row" data-gap="tight">
          <Text size="xs" className="je-insp-grow" ellipsis>
            {origin}
          </Text>
          <IconButton
            size="icon-xs"
            icon={Cancel01Icon}
            label={`Remove ${origin}`}
            disabled={disabled}
            onClick={() => void onChange(view.connectOrigins.filter((o) => o !== origin))}
          />
        </div>
      ))}
      <form
        className="je-insp-row"
        data-gap="tight"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <Input
          size="sm"
          className="je-insp-grow"
          aria-label="Origin to add"
          aria-invalid={invalid || undefined}
          placeholder="https://api.example.com"
          value={draft}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.target.value);
            setInvalid(false);
          }}
        />
        <Button
          size="xs"
          variant="outline"
          type="submit"
          busyScope={SETTINGS_SCOPE}
          disabled={!draft.trim() || full}
          {...(full ? { tooltip: `A game connects to at most ${max} origins` } : {})}
        >
          Add
        </Button>
      </form>
      {invalid ? (
        <Text as="p" size="xs" variant="danger">
          An origin is an https:// or wss:// address, such as https://api.example.com.
        </Text>
      ) : null}
    </div>
  );
}
