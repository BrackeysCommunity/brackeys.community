import {
  AlertCircleIcon,
  Folder01Icon,
  ListViewIcon,
  Route01Icon,
  SlidersHorizontalIcon,
  WorkHistoryIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import type { Store } from "@tanstack/store";
import type { ReactNode } from "react";

import type { EditorSession, Ref, SceneIssue } from "../../editor/index";
import type { AssetKey } from "../../project/index";
import type { EditorControls } from "../frame/keys";
import type { EditorNotify } from "../host";
import { Skeleton, Text } from "../kit/index";
import type { PanelId } from "../layout/model";
import { useEditorStore } from "../session/use-editor-store";
import type { EditorProjectLink } from "../session/use-scene-editor";
import { useStoreValue } from "../session/use-store-value";
import { EditorHistory } from "./EditorHistory";
import { EditorInspector } from "./EditorInspector";
import { EditorOutliner } from "./EditorOutliner";
import { EditorProject, useSelectedAsset } from "./EditorProject";
import { LoadRunPanel } from "./LoadRunPanel";
import { ProblemsPanel } from "./ProblemsPanel";

/** What the panels are drawn from: the editor's controls and the stores they share. */
export type PanelControls = Pick<
  EditorControls,
  | "session"
  | "notify"
  | "project"
  | "prefab"
  | "onOpenPrefab"
  | "onReplay"
  | "runStore"
  | "playFrom"
  | "frame"
>;

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

function OutlinerWithProblems({
  session,
  physical,
  onOpenPrefab,
}: {
  session: EditorSession;
  physical: Store<readonly SceneIssue[]>;
  onOpenPrefab?: (prefab: string, from: Ref) => void;
}) {
  return (
    <EditorOutliner
      session={session}
      physical={useStoreValue(physical, sameIssues, Object.is)}
      onOpenPrefab={onOpenPrefab}
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
        onOpenPrefab={ctx.controls.onOpenPrefab}
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
      <InspectorWithAsset
        session={controls.session}
        project={controls.project}
        picked={pickedAsset}
        onOpenPrefab={controls.onOpenPrefab}
        inPrefab={controls.prefab !== undefined}
        notify={controls.notify}
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
    id: "run",
    title: "Run",
    icon: Route01Icon,
    render: ({ controls }) => (
      <LoadRunPanel
        session={controls.session}
        run={controls.runStore}
        onPlayFrom={controls.playFrom}
        onReplay={(run) => controls.onReplay(run.recording)}
        notify={controls.notify}
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
];

export const PANEL_IDS: readonly PanelId[] = PANELS.map((p) => p.id);

export const panelDef = (id: PanelId): PanelDef | undefined => PANELS.find((p) => p.id === id);
