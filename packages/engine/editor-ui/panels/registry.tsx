import {
  Activity01Icon,
  AlertCircleIcon,
  DashboardSpeed01Icon,
  Folder01Icon,
  GridViewIcon,
  ListViewIcon,
  Rocket01Icon,
  Route01Icon,
  Settings02Icon,
  SlidersHorizontalIcon,
  WorkHistoryIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import type { Store } from "@tanstack/store";
import { useMemo, type ReactNode } from "react";

import type { EventLog } from "../../debug/event-log";
import type { EditorSession, Ref, SceneIssue } from "../../editor/index";
import type { AssetId, AssetKey } from "../../project/index";
import type { GameStoreState } from "../../types";
import type { EditorControls } from "../frame/keys";
import type { EditorNotify, EditorPublishHost } from "../host";
import { Skeleton, Text } from "../kit/index";
import type { PanelId } from "../layout/model";
import { useEditorStore } from "../session/use-editor-store";
import type { EditorProjectLink } from "../session/use-scene-editor";
import type { EditorChromeGame } from "../session/use-scene-editor";
import { useStoreValue, type ReadableStore } from "../session/use-store-value";
import { EditorHistory } from "./EditorHistory";
import { EditorInspector } from "./EditorInspector";
import { EditorOutliner } from "./EditorOutliner";
import { EditorProject, useSelectedAsset } from "./EditorProject";
import { EventLogPanel, type EventLogReplayHost } from "./EventLogPanel";
import { LoadRunPanel, type ReplaySource } from "./LoadRunPanel";
import { PerfReadout } from "./PerfReadout";
import { PlayInspector } from "./PlayInspector";
import { ProblemsPanel } from "./ProblemsPanel";
import { PublishPanel } from "./publish/PublishPanel";
import type { CaptureBinding } from "./settings/InputPanel";
import { ProjectSettings } from "./settings/ProjectSettings";
import { SpawnedGroup } from "./SpawnedGroup";
import { TilePalette } from "./TilePalette";

/** What the panels are drawn from: the editor's controls and the stores they share. */
export type PanelControls = Pick<
  EditorControls,
  | "session"
  | "notify"
  | "project"
  | "prefab"
  | "onOpenPrefab"
  | "onReplay"
  | "liveVersion"
  | "runStore"
  | "playFrom"
  | "frame"
> &
  Partial<Pick<EditorControls, "game" | "rapier" | "tools">> & {
    /** The host's publishing, when it publishes the project's releases. */
    publish?: EditorPublishHost;
  };

/** What a panel's tab and body are drawn with. */
export type PanelContext = {
  /** Reveals a panel wherever the viewer moved it, and selects its tab. */
  openPanel(id: PanelId): void;
  /** Calls `listener` whenever something a tab's badge reads changes. */
  subscribe: (listener: () => void) => () => void;
  controls: PanelControls;
  /** The physical checks' issues, written by whoever runs them. */
  physical: Store<readonly SceneIssue[]>;
  /** The asset picked in the project tree, shown by the inspector. */
  pickedAsset: Store<AssetKey | null>;
};

/** One panel of the frame's tab groups. */
export type PanelDef = {
  id: PanelId;
  title: string;
  icon: IconSvgElement;
  /** A count on the tab (Problems' errors and warnings); hidden at zero. Read again on `ctx.subscribe`. */
  badge?: (ctx: PanelContext) => { count: number; tone: "danger" | "warning" | "muted" } | null;
  /** Shown on the tab while a task in this scope runs: Problems while checks rerun. */
  busyScope?: string;
  /** Calls `reveal` when something should bring this panel's tab forward; returns the unsubscribe. */
  follow?: (ctx: PanelContext, reveal: () => void) => () => void;
  render: (ctx: PanelContext) => ReactNode;
  /** Shown instead while the editor boots. */
  skeleton?: () => ReactNode;
};

/** The context for `PANELS`; `subscribe` covers the session's store and the physical issues. */
export function createPanelContext(args: Omit<PanelContext, "subscribe">): PanelContext {
  const { controls, physical } = args;
  return {
    ...args,
    subscribe: (listener) => {
      const offSession = controls.session.store.subscribe(listener);
      const offPhysical = physical.subscribe(listener);
      return () => {
        offSession();
        offPhysical();
      };
    },
  };
}

const sameIssues = (issues: readonly SceneIssue[]) => issues;

const NO_GAME: ReadableStore<Partial<GameStoreState>> = {
  state: {},
  subscribe: () => () => {},
};

/** Whether the editor's game is in Play: its inspector and outliner show the play world then. */
function usePlaying(game: EditorChromeGame | undefined): boolean {
  return useStoreValue<Partial<GameStoreState>, boolean>(
    game?.getStore() ?? NO_GAME,
    (s) => s.mode === "play",
    Object.is,
  );
}

function OutlinerWithProblems({
  session,
  physical,
  notify,
  onOpenPrefab,
  game,
}: {
  session: EditorSession;
  physical: Store<readonly SceneIssue[]>;
  notify: EditorNotify;
  onOpenPrefab?: (prefab: string, from: Ref) => void;
  game?: EditorChromeGame;
}) {
  const playing = usePlaying(game);
  return (
    <>
      <EditorOutliner
        session={session}
        physical={useStoreValue(physical, sameIssues, Object.is)}
        notify={notify}
        onOpenPrefab={onOpenPrefab}
      />
      {playing && game ? <SpawnedGroup game={game} session={session} /> : null}
    </>
  );
}

/** The inspector: the play world's entity during Play, else the edit inspector. */
function InspectorForMode(
  props: Parameters<typeof InspectorWithAsset>[0] & { game?: EditorChromeGame },
) {
  const { game, ...edit } = props;
  const playing = usePlaying(game);
  return playing && game ? (
    <PlayInspector game={game} session={edit.session} notify={edit.notify} />
  ) : (
    <InspectorWithAsset {...edit} />
  );
}

/** The event log, picking entities for the play inspector during Play. */
function EventLogForMode({ controls }: { controls: PanelControls }) {
  const { game, session, rapier, project, liveVersion } = controls;
  const playing = usePlaying(game);
  const registry = game?.registry ?? session.registry;
  const runtime = project?.runtime;
  const sceneId = project?.scene;
  const replayHost = useMemo<EventLogReplayHost>(
    () => ({
      rapier: rapier ?? null,
      registry,
      ...(runtime ? { project: runtime } : {}),
      ...(liveVersion ? { versions: liveVersion } : {}),
      ...(sceneId ? { sceneId } : {}),
    }),
    [rapier, registry, runtime, liveVersion, sceneId],
  );
  return (
    <EventLogPanel
      events={debugEventsOf(game)}
      session={session}
      notify={controls.notify}
      run={controls.runStore}
      replay={replaySourceOf(game)}
      replayHost={replayHost}
      playing={playing}
    />
  );
}

/** The inspector, showing the asset picked in the project tree until something in the scene is picked. */
function InspectorWithAsset({
  session,
  project,
  picked,
  onOpenPrefab,
  inPrefab,
  notify,
}: {
  session: EditorSession;
  project?: EditorProjectLink;
  picked: Store<AssetKey | null>;
  onOpenPrefab?: (prefab: string, from: Ref) => void;
  inPrefab: boolean;
  notify: EditorNotify;
}) {
  const selection = useEditorStore(session, (s) => s.selection);
  const asset = useSelectedAsset(project, picked, selection, notify);
  return (
    <EditorInspector
      session={session}
      onOpenPrefab={onOpenPrefab}
      inPrefab={inPrefab}
      project={project?.session ?? null}
      runtime={project?.runtime ?? null}
      {...(asset ? { asset } : {})}
    />
  );
}

function ProblemsWithPhysical({
  session,
  physical,
  onFrame,
  notify,
}: {
  session: EditorSession;
  physical: Store<readonly SceneIssue[]>;
  onFrame: (refs: Ref[]) => void;
  notify: EditorNotify;
}) {
  return (
    <ProblemsPanel
      session={session}
      physical={useStoreValue(physical, sameIssues, Object.is)}
      onFrame={onFrame}
      notify={notify}
    />
  );
}

/** Errors and warnings, structural and physical; info doesn't count. */
export function problemsBadge(ctx: PanelContext): {
  count: number;
  tone: "danger" | "warning";
} | null {
  const issues = [...ctx.controls.session.store.state.issues, ...ctx.physical.state];
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warn").length;
  if (errors + warnings === 0) return null;
  return { count: errors + warnings, tone: errors > 0 ? "danger" : "warning" };
}

/** A new, non-empty scene selection. */
function followSelection(ctx: PanelContext, reveal: () => void): () => void {
  const { store } = ctx.controls.session;
  let last = store.state.selection;
  return store.subscribe(() => {
    const next = store.state.selection;
    if (next === last) return;
    last = next;
    if (next.length > 0) reveal();
  });
}

const rows = (count: number) => () => (
  <div className="je-panel-skeleton">
    {Array.from({ length: count }, (_, i) => (
      <Skeleton key={i} className="je-panel-skeleton-row" />
    ))}
  </div>
);

/** The editor's panels, in the order their tabs first appear. Their home groups are `DEFAULT_LAYOUT`'s. */
export const PANELS: readonly PanelDef[] = [
  {
    id: "outliner",
    title: "Outliner",
    icon: ListViewIcon,
    render: (ctx) => (
      <OutlinerWithProblems
        session={ctx.controls.session}
        physical={ctx.physical}
        notify={ctx.controls.notify}
        onOpenPrefab={ctx.controls.onOpenPrefab}
        game={ctx.controls.game}
      />
    ),
    skeleton: rows(8),
  },
  {
    id: "project",
    title: "Project",
    icon: Folder01Icon,
    render: ({ controls, pickedAsset }) =>
      controls.project ? (
        <EditorProject
          project={controls.project}
          selected={pickedAsset}
          prefab={controls.prefab?.id}
          notify={controls.notify}
        />
      ) : (
        <Text as="p" size="xs" variant="muted" className="je-panel-empty">
          This scene isn't part of a project.
        </Text>
      ),
    skeleton: rows(5),
  },
  {
    id: "inspector",
    title: "Inspector",
    icon: SlidersHorizontalIcon,
    follow: followSelection,
    render: ({ controls, pickedAsset }) => (
      <InspectorForMode
        session={controls.session}
        project={controls.project}
        picked={pickedAsset}
        onOpenPrefab={controls.onOpenPrefab}
        inPrefab={controls.prefab !== undefined}
        notify={controls.notify}
        game={controls.game}
      />
    ),
    skeleton: rows(6),
  },
  {
    id: "problems",
    title: "Problems",
    icon: AlertCircleIcon,
    badge: problemsBadge,
    busyScope: "panel:problems",
    render: ({ controls, physical }) => (
      <ProblemsWithPhysical
        session={controls.session}
        physical={physical}
        onFrame={(refs) => void controls.frame(refs)}
        notify={controls.notify}
      />
    ),
    skeleton: rows(3),
  },
  {
    id: "event-log",
    title: "Event log",
    icon: Activity01Icon,
    render: ({ controls }) => <EventLogForMode controls={controls} />,
    skeleton: rows(3),
  },
  {
    id: "perf",
    title: "Perf",
    icon: DashboardSpeed01Icon,
    render: ({ controls }) => <PerfReadout game={controls.game ?? null} />,
    skeleton: rows(3),
  },
  {
    id: "run",
    title: "Run",
    icon: Route01Icon,
    render: ({ controls }) => (
      <LoadRunPanel
        session={controls.session}
        run={controls.runStore}
        onPlayFrom={controls.playFrom}
        onReplay={(run) => controls.onReplay(run.recording)}
        liveVersion={controls.liveVersion}
        notify={controls.notify}
        replay={replaySourceOf(controls.game)}
      />
    ),
    skeleton: rows(2),
  },
  {
    id: "history",
    title: "History",
    icon: WorkHistoryIcon,
    render: ({ controls }) => <EditorHistory session={controls.session} notify={controls.notify} />,
    skeleton: rows(4),
  },
  {
    id: "settings",
    title: "Project settings",
    icon: Settings02Icon,
    render: ({ controls }) =>
      controls.project ? (
        <ProjectSettings
          project={controls.project}
          notify={controls.notify}
          capture={captureOf(controls.game)}
          publish={controls.publish}
        />
      ) : (
        <Text as="p" size="xs" variant="muted" className="je-panel-empty">
          This scene isn't part of a project.
        </Text>
      ),
    skeleton: rows(5),
  },
  {
    id: "tiles",
    title: "Tiles",
    icon: GridViewIcon,
    render: (ctx) => (
      <TilePalette
        session={ctx.controls.session}
        runtime={ctx.controls.project?.runtime ?? null}
        imageUrl={ctx.controls.project?.assetImage}
        tools={ctx.controls.tools}
        onOpenTileset={openAssetIn(ctx)}
      />
    ),
    skeleton: rows(4),
  },
];

/** Releases, channels and usage before publishing; only among a host's panels when it publishes. */
export const PUBLISH_PANEL: PanelDef = {
  id: "publish",
  title: "Publish",
  icon: Rocket01Icon,
  render: ({ controls }) => (
    <PublishPanel
      publish={controls.publish}
      notify={controls.notify}
      sceneTitle={(id) => controls.project?.flow?.scenes.find((e) => e.scene === id)?.title}
      gameLive={controls.session.registry.game?.live}
    />
  ),
  skeleton: rows(4),
};

/** The panels for a host: `PANELS`, and the Publish panel when it publishes. */
export function editorPanels(host: { publish?: EditorPublishHost }): readonly PanelDef[] {
  return host.publish ? [...PANELS, PUBLISH_PANEL] : PANELS;
}

/** The game's event log; none for a host game that lends no debug reads. */
function debugEventsOf(game: PanelControls["game"]): EventLog | null {
  const debug = (game as Partial<Pick<EditorChromeGame, "debug">> | undefined)?.debug;
  return debug?.events ?? null;
}

/** The game's replay controls; none for a host game that lends no replay handle. */
function replaySourceOf(game: PanelControls["game"]): ReplaySource | null {
  const g = game as Partial<ReplaySource> | null | undefined;
  return g?.replayHandle && g.getStore ? (g as ReplaySource) : null;
}

/**
 * Opens a project asset by id as picking it in the project tree does: in the
 * inspector, revealed. None outside a project.
 */
function openAssetIn(ctx: PanelContext): ((id: AssetId) => void) | undefined {
  const session = ctx.controls.project?.session;
  if (!session) return undefined;
  return (id) => {
    const entry = session.view().byId.get(id);
    if (!entry || entry.deleted) return;
    ctx.pickedAsset.setState(() => entry.key);
    ctx.openPanel("inspector");
  };
}

/** The running game's binding capture. */
function captureOf(game: PanelControls["game"]): CaptureBinding | null {
  return game ? (opts) => game.input.capture(opts) : null;
}

export const PANEL_IDS: readonly PanelId[] = PANELS.map((p) => p.id);

export const panelDef = (id: PanelId): PanelDef | undefined => PANELS.find((p) => p.id === id);
