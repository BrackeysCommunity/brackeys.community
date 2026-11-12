import { Cancel01Icon, Copy01Icon } from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  EditorNotify,
  EditorPublishHost,
  GameSaveMode,
  GameSettingsPatch,
  GameSettingsView,
  GameVisibility,
  ReleaseView,
  UsageView,
} from "../../host";
import { Button, IconButton, Input, MicroLabel, Radio, Skeleton, Text } from "../../kit/index";
import type { Pending } from "../../pending/pending";
import { PendingProvider, useBusy, useOwnOrSharedPending } from "../../pending/use-pending";
import { channelScope, PromoteButton, ReleaseList, unplayable } from "./ReleaseList";

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

/** A date as "12 Nov 2026", in UTC like every release date. */
function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The project's releases, channels and usage before publishing; nothing while the host doesn't publish. */
export function PublishPanel({
  publish,
  notify,
}: {
  publish: EditorPublishHost | undefined;
  /** Where copies and failures outside a pending task are said; the editor's toasts. */
  notify?: EditorNotify;
}) {
  if (!publish) return null;
  return <PublishBody key={publish.project} publish={publish} notify={notify ?? silentNotify} />;
}

function PublishBody({ publish, notify }: { publish: EditorPublishHost; notify: EditorNotify }) {
  const pending = useOwnOrSharedPending(notify);
  const [usage, reloadUsage] = useLoaded(() => publish.usage());
  const [releases, reloadReleases] = useLoaded(() => publish.releases());

  const move = async (
    label: string,
    channel: "production",
    work: () => Promise<{ to: number }>,
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
    return result.ok;
  };
  const promote = (version: number) =>
    move(
      `Promoting v${version}`,
      "production",
      () => publish.promote(version, "production"),
      `Couldn't promote v${version}`,
    );
  const rollback = (to: number) =>
    move(
      `Rolling back to v${to}`,
      "production",
      () => publish.rollback("production", to),
      `Couldn't roll back to v${to}`,
    );

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
              <Channels releases={releases.value} onPromote={promote} onRollback={rollback} />
              <RemovedSoon releases={releases.value} />
              <ReleaseList releases={releases.value} onPromote={promote} />
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
}: {
  releases: readonly ReleaseView[];
  onPromote: (version: number) => Promise<boolean>;
  onRollback: (version: number) => Promise<boolean>;
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
          ? `Production: v${production.version}${production.firstPromotedAt ? ` (live since ${dayOf(production.firstPromotedAt)})` : ""}`
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
            onPromote={() => onPromote(preview.version)}
          />
        ) : null}
        {back ? (
          <Button
            size="xs"
            variant="outline"
            busyScope={channelScope("production")}
            onClick={() => void onRollback(back.version)}
          >
            Roll back production to v{back.version}
          </Button>
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

/** "https://api.example.com/x" → "https://api.example.com"; null for anything but an http(s) URL. */
export function originOf(text: string): string | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
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
        onPick={(saveMode) => void save({ saveMode }, "Changing where the game saves")}
      />
      <ConnectsTo
        view={view}
        text={publish.wording.connectsTo}
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
  disabled,
  onChange,
}: {
  view: GameSettingsView;
  text: string;
  disabled: boolean;
  onChange: (origins: readonly string[]) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const add = async () => {
    const origin = originOf(draft);
    if (!origin) return setInvalid(true);
    setInvalid(false);
    if (view.connectOrigins.includes(origin)) return setDraft("");
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
          disabled={!draft.trim()}
        >
          Add
        </Button>
      </form>
      {invalid ? (
        <Text as="p" size="xs" variant="danger">
          An origin is an http or https address, such as https://api.example.com.
        </Text>
      ) : null}
    </div>
  );
}
