import { useCallback, useEffect, useState, type ReactNode } from "react";

import { applyProjectBatch, type ProjectSession } from "../../../collab/index";
import type { ProjectOp } from "../../../project/index";
import type {
  EditorNotify,
  EditorPublishHost,
  UsageLevel,
  UsageLineView,
  UsageView,
} from "../../host";
import {
  Button,
  Confirm,
  MicroLabel,
  Progress,
  type ProgressTone,
  Skeleton,
  Text,
} from "../../kit/index";
import { PendingProvider, useOwnOrSharedPending } from "../../pending/use-pending";
import { useProjectView } from "../EditorProject";
import { SettingsNote } from "./SettingsRows";

/** The pending scope of emptying the trash, which keeps its button busy. */
const EMPTY_TRASH_SCOPE = "usage:empty-trash";

type Loaded =
  | { status: "loading" }
  | { status: "ready"; usage: UsageView }
  | { status: "error"; message: string };

const assetsLabel = (n: number) => `${n} ${n === 1 ? "asset" : "assets"}`;

const BAR_TONE = { ok: "primary", warn: "warning", full: "danger" } as const satisfies Record<
  UsageLevel,
  ProgressTone
>;

/**
 * Purges every trashed entry in one batch. An entry someone restored since
 * the view was read is refused as `asset-not-trashed`; it is left out and the
 * rest go again. Resolves to how many were deleted.
 */
async function emptyTrash(session: ProjectSession): Promise<number> {
  let ops: ProjectOp[] = session.view().deleted.map((e) => ({ op: "purgeAsset", id: e.id }));
  while (ops.length > 0) {
    const result = await applyProjectBatch(
      session,
      { v: 1, label: "Empty the trash", ops },
      session.origin,
    );
    if (result.ok) return ops.length;
    if (result.issue.code !== "asset-not-trashed" || ops[result.opIndex] === undefined)
      throw new Error(result.issue.message);
    const refused = result.opIndex;
    ops = ops.filter((_, i) => i !== refused);
  }
  return 0;
}

/**
 * The project's storage against the host's quotas, one bar per quota, with
 * every sentence the host's own; Empty trash deletes the trashed assets for
 * good. Nothing while the host doesn't publish.
 */
export function UsagePanel({
  publish,
  session,
  notify,
}: {
  publish: EditorPublishHost | undefined;
  session: ProjectSession;
  notify: EditorNotify;
}) {
  if (!publish) return null;
  return <Usage publish={publish} session={session} notify={notify} />;
}

function Usage({
  publish,
  session,
  notify,
}: {
  publish: EditorPublishHost;
  session: ProjectSession;
  notify: EditorNotify;
}) {
  const pending = useOwnOrSharedPending(notify);
  const view = useProjectView(session);
  const trashed = view.deleted.length;
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [asking, setAsking] = useState(false);
  const [reloads, setReloads] = useState(0);
  const reload = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    publish.usage().then(
      (usage) => live && setLoaded({ status: "ready", usage }),
      (error: unknown) =>
        live &&
        setLoaded({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      live = false;
    };
  }, [publish, reloads]);

  const purge = async () => {
    const result = await pending.run(
      {
        label: "Emptying the trash",
        scope: EMPTY_TRASH_SCOPE,
        success: (n: number) =>
          n > 0 ? `Deleted ${assetsLabel(n)} for good` : "The trash was already empty",
        error: "Couldn't empty the trash",
      },
      () => emptyTrash(session),
    );
    if (!result.ok) return false;
    reload();
    return true;
  };

  if (loaded.status === "loading") {
    return (
      <section className="je-insp-stack" aria-label="Usage" aria-busy>
        <Text as="p" size="sm" bold>
          Usage
        </Text>
        <Skeleton style={{ height: 32 }} />
        <Skeleton style={{ height: 32 }} />
      </section>
    );
  }

  if (loaded.status === "error") {
    return (
      <section className="je-insp-stack" aria-label="Usage">
        <Text as="p" size="sm" bold>
          Usage
        </Text>
        <Text as="p" size="xs" variant="danger" role="alert">
          Couldn't load this project's usage: {loaded.message}
        </Text>
        <Button variant="outline" size="xs" onClick={reload}>
          Try again
        </Button>
      </section>
    );
  }

  const { usage } = loaded;
  const trash = usage.trash;
  const trashButton = trash ? (
    <Button
      variant="outline"
      size="xs"
      busyScope={EMPTY_TRASH_SCOPE}
      disabled={trashed === 0}
      tooltip={trashed === 0 ? "Nothing in this project's trash to delete" : undefined}
      onClick={() => setAsking(true)}
    >
      Empty trash
    </Button>
  ) : null;
  const hasAssetRow = usage.lines.some((l) => l.quota === "assetBytes");

  return (
    <PendingProvider pending={pending}>
      <section className="je-insp-stack" aria-label="Usage">
        <Text as="p" size="sm" bold>
          Usage
        </Text>
        {usage.lines.map((line) => (
          <UsageRow
            key={line.quota}
            line={line}
            action={line.quota === "assetBytes" ? trashButton : null}
          />
        ))}
        {hasAssetRow ? null : trashButton}
        {usage.notice ? (
          <Text
            as="p"
            size="xs"
            variant={usage.notice.level === "full" ? "danger" : "warning"}
            role={usage.notice.level === "full" ? "alert" : "status"}
            data-level={usage.notice.level}
          >
            {usage.notice.text}
          </Text>
        ) : null}
        <SettingsNote>{usage.footer}</SettingsNote>
        {trash ? (
          <Confirm
            open={asking}
            onOpenChange={setAsking}
            title="Empty the trash?"
            message={trash.confirm}
            confirmText="Delete for good"
            variant="destructive"
            onConfirm={purge}
          />
        ) : null}
      </section>
    </PendingProvider>
  );
}

function UsageRow({ line, action }: { line: UsageLineView; action: ReactNode }) {
  return (
    <div className="je-insp-stack" data-quota={line.quota} data-level={line.level}>
      <Progress
        value={Math.min(Math.max(line.used, 0), Math.max(line.max, 1))}
        max={Math.max(line.max, 1)}
        tone={BAR_TONE[line.level]}
        label={<MicroLabel>{line.text}</MicroLabel>}
      />
      {line.detail ? (
        <Text as="p" size="xs" variant="muted">
          {line.detail}
        </Text>
      ) : null}
      {action}
    </div>
  );
}
