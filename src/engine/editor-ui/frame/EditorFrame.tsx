import { Store } from "@tanstack/store";
import { useEffect, useRef, type ComponentProps, type ReactNode, type RefObject } from "react";

import {
  createKeymap,
  selectionBounds,
  type EditorSession,
  type Ref,
  type SceneIssue,
} from "../../editor/index";
import type { RapierModule } from "../../index";
import type { AssetKey } from "../../project/index";
import { hostPeerColor, type EditorHost, type EditorNotify } from "../host";
import { cx, KitProvider } from "../kit/index";
import { CanvasLayer } from "../panels/canvas-layer/CanvasLayer";
import {
  createToolHostCell,
  useToolHost,
  useToolHostLifecycle,
} from "../panels/canvas-layer/tool-host";
import { CodeSkewNotice } from "../panels/CodeSkewNotice";
import { EditorCanvasOverlay } from "../panels/EditorCanvasOverlay";
import { EditorHistory } from "../panels/EditorHistory";
import { EditorInspector } from "../panels/EditorInspector";
import { EditorOutliner } from "../panels/EditorOutliner";
import { EditorPlayBar } from "../panels/EditorPlayBar";
import { EditorProject, useSelectedAsset } from "../panels/EditorProject";
import { EditorStatusBar } from "../panels/EditorStatusBar";
import { EditorToolbar } from "../panels/EditorToolbar";
import { LoadRunPanel } from "../panels/LoadRunPanel";
import { PeerColorProvider } from "../panels/peer-faces";
import { PrefabHeader } from "../panels/PrefabHeader";
import { ProblemsPanel } from "../panels/ProblemsPanel";
import { createLoadedRunStore } from "../session/loaded-run";
import { useEditorStore } from "../session/use-editor-store";
import { usePhysicalIssues } from "../session/use-physical-issues";
import type { EditorProjectLink } from "../session/use-scene-editor";
import { useStoreValue } from "../session/use-store-value";
import {
  useEditorClipboard,
  useEditorKeys,
  type EditorChromeProps,
  type EditorControls,
} from "./keys";

export type { EditorChromeProps, EditorControls } from "./keys";

// ─── The frame ───────────────────────────────────────────

/** A floating panel of chrome over the canvas. */
export function Island({
  className,
  region = true,
  ...props
}: ComponentProps<"div"> & {
  /** A stop for F6; off when the island sits inside a bar that is one. */
  region?: boolean;
}) {
  return (
    <div
      data-je-region={region ? "" : undefined}
      className={cx("je-island", className)}
      {...props}
    />
  );
}

const REGION = "[data-je-region]";
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** F6 and Shift+F6 move focus between the islands and the canvas, in document order. */
function useRegionCycling(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F6" || e.metaKey || e.ctrlKey || e.altKey) return;
      const frame = root.current;
      if (!frame) return;
      // An island inside a corner the frame already made a stop is not a second one.
      const all = [...frame.querySelectorAll<HTMLElement>(REGION)];
      const regions = all.filter((r) => !all.some((o) => o !== r && o.contains(r)));
      if (regions.length === 0) return;
      e.preventDefault();
      const current = regions.findIndex((r) => r.contains(document.activeElement));
      const step = e.shiftKey ? -1 : 1;
      const next = regions[(current + step + regions.length) % regions.length];
      if (!next) return;
      const target = next.hasAttribute("data-je-document")
        ? next
        : (next.querySelector<HTMLElement>(TABBABLE) ?? next);
      target.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [root]);
}

export type EditorFrameSlots = {
  /** The host's chrome: a site menu, a title, a way out. */
  topLeft?: ReactNode;
  topRight?: ReactNode;
  /** Where the editor is: the read-only notice and the prefab breadcrumb, atop the left column. */
  context?: ReactNode;
  /** The project tree and the outliner. */
  left?: ReactNode;
  /** The inspector, Problems, Run and History. */
  right?: ReactNode;
  /** The toolbar, or the play controls while playing. */
  dock?: ReactNode;
  /** The scene, its connection and who is here, bottom left. */
  status?: ReactNode;
  /** Chrome placed over the canvas by the scene itself: cursors, the tools' overlay. */
  overlay?: ReactNode;
};

export type EditorFrameProps = EditorFrameSlots & {
  /** The host's cues, storage and peer colours, for the kit and every face below. */
  host?: Pick<EditorHost, "cue" | "storage" | "peerColor">;
  /** Pins the theme; by default it follows the system's. */
  theme?: "light" | "dark";
  className?: string;
  /** The game's canvas. */
  children: ReactNode;
};

const NO_HOST: Pick<EditorHost, "cue" | "storage" | "peerColor"> = {};

/**
 * The editor's shell: the canvas fills the frame and the chrome floats over
 * it in islands, the columns fixed at their sides. Islands come first in the
 * DOM, so Tab reaches the host's chrome, the columns and the dock before the
 * canvas. Kit portals render into a `.je-root` container beside it.
 */
export function EditorFrame({
  topLeft,
  topRight,
  context,
  left,
  right,
  dock,
  status,
  overlay,
  host = NO_HOST,
  theme,
  className,
  children,
}: EditorFrameProps) {
  const root = useRef<HTMLDivElement>(null);
  useRegionCycling(root);
  return (
    <KitProvider host={host} theme={theme}>
      <PeerColorProvider value={hostPeerColor(host)}>
        <div ref={root} className={cx("je-root je-frame", className)} data-je-theme={theme}>
          <div className="je-frame-chrome">
            {topLeft ? (
              <div className="je-frame-top-left je-host" data-je-region="">
                {topLeft}
              </div>
            ) : null}
            {topRight ? (
              <div className="je-frame-top-right je-host" data-je-region="">
                {topRight}
              </div>
            ) : null}
            {context || left ? (
              <div className="je-frame-left">
                {context}
                {left}
              </div>
            ) : null}
            {right ? <div className="je-frame-right">{right}</div> : null}
            {dock ? <div className="je-frame-dock">{dock}</div> : null}
            {status ? <div className="je-frame-status">{status}</div> : null}
          </div>
          <div data-je-region="" data-je-document="" tabIndex={-1} className="je-frame-document">
            {children}
          </div>
          {overlay}
        </div>
      </PeerColorProvider>
    </KitProvider>
  );
}

// ─── The editor's chrome ─────────────────────────────────

export type EditorChrome = Pick<
  EditorFrameSlots,
  "context" | "left" | "right" | "dock" | "status" | "overlay"
>;

/**
 * The editor's islands for `EditorFrame`'s slots. In play mode only the dock
 * stays, as the play controls and the "scene changed" chip.
 */
export function editorChrome(props: EditorChromeProps): EditorChrome {
  const { session, host, game, notify } = props;
  const keymap = createKeymap(game.registry.game?.editorKeys);
  for (const b of keymap.shadowed) {
    console.warn(`[editor] the game's ${b.scope} key "${b.key}" (${b.command}) is the engine's`);
  }
  const physical = new Store<readonly SceneIssue[]>([]);
  const pickedAsset = new Store<AssetKey | null>(null);
  const controls: EditorControls = {
    ...props,
    rapier: props.rapier ?? null,
    runStore: props.runStore ?? createLoadedRunStore(),
    keymap,
    tools: createToolHostCell(),
    playHere() {
      const at = game.pointerWorld();
      if (!at) {
        notify("Point at the scene first", {
          description: "Play from here starts where the pointer last was over the scene.",
        });
        return;
      }
      props.onPlay({ at });
    },
    playFrom: (opts) => props.onPlay(opts),
    frame(refs) {
      const box = selectionBounds(session.getResolved(), session.registry, refs);
      if (!box) return false;
      game.frame(box);
      return true;
    },
  };
  return {
    context: (
      <EditMode session={session}>
        <CodeSkewNotice host={host} />
        {props.prefab ? <PrefabHeader session={session} {...props.prefab} /> : null}
      </EditMode>
    ),
    left: (
      <EditMode session={session}>
        <div className="je-frame-stack">
          {props.project ? (
            <Island className="je-island-project">
              <EditorProject
                project={props.project}
                selected={pickedAsset}
                prefab={props.prefab?.id}
                notify={notify}
              />
            </Island>
          ) : null}
          <Island className="je-island-outliner">
            <OutlinerWithProblems
              session={session}
              physical={physical}
              onOpenPrefab={props.onOpenPrefab}
            />
          </Island>
        </div>
      </EditMode>
    ),
    right: (
      <EditMode session={session}>
        <PhysicalWatch session={session} rapier={controls.rapier} store={physical} />
        <Island className="je-island-inspector">
          <InspectorWithAsset
            session={session}
            project={props.project}
            picked={pickedAsset}
            onOpenPrefab={props.onOpenPrefab}
            inPrefab={props.prefab !== undefined}
            notify={notify}
          />
        </Island>
        <Island className="je-island-problems">
          <ProblemsWithPhysical
            session={session}
            physical={physical}
            onFrame={(refs) => void controls.frame(refs)}
            notify={notify}
          />
        </Island>
        <Island className="je-island-run">
          <LoadRunPanel
            session={session}
            run={controls.runStore}
            onPlayFrom={controls.playFrom}
            onReplay={(run) => props.onReplay(run.recording)}
            notify={notify}
          />
        </Island>
        <Island className="je-island-history">
          <EditorHistory session={session} notify={notify} />
        </Island>
      </EditMode>
    ),
    dock: <EditorDock {...controls} />,
    status: (
      <EditMode session={session}>
        <Island>
          <EditorStatusBar session={session} host={host} />
        </Island>
      </EditMode>
    ),
    overlay: (
      <EditMode session={session}>
        <EditorCanvasOverlay session={session} store={game.getStore()} />
        <EditorCanvasLayer {...controls} />
      </EditMode>
    ),
  };
}

/** Physical validation, run once for the panels that show it. */
function PhysicalWatch({
  session,
  rapier,
  store,
}: {
  session: EditorSession;
  rapier: RapierModule | null;
  store: Store<readonly SceneIssue[]>;
}) {
  const issues = usePhysicalIssues(session, rapier);
  useEffect(() => store.setState(() => issues), [issues, store]);
  return null;
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

function EditMode({ session, children }: { session: EditorSession; children: ReactNode }) {
  const mode = useEditorStore(session, (s) => s.mode);
  return mode === "play" ? null : children;
}

function EditorCanvasLayer({ session, tools, game, runStore, canvas, notify }: EditorControls) {
  const host = useToolHost(tools);
  return (
    <CanvasLayer
      session={session}
      host={host}
      store={game.getStore()}
      runStore={runStore}
      canvas={canvas}
      notify={notify}
    />
  );
}

/** The toolbar, or the play controls while playing; owns the tool host and the editor keyboard. */
function EditorDock(controls: EditorControls) {
  const { session, game, tools, notify } = controls;
  const mode = useEditorStore(session, (s) => s.mode);
  useToolHostLifecycle(tools, session, game, notify, controls.project?.session);
  const host = useToolHost(tools);
  useEditorKeys(controls, host);
  useEditorClipboard(session, host);

  if (mode === "play") return <EditorPlayBar {...controls} />;
  return (
    <Island>
      <EditorToolbar
        session={session}
        keymap={controls.keymap}
        host={host}
        onPlay={() => controls.onPlay()}
        onPlayHere={controls.playHere}
      />
    </Island>
  );
}
