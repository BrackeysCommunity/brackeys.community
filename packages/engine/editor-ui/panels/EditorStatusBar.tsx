import {
  Alert02Icon,
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import type { Store } from "@tanstack/store";

import type { EditorSession, SceneIssue } from "../../editor/index";
import { plural } from "../../scene/plural";
import { Activity, SaveState } from "../frame/Activity";
import { usePanelOpener } from "../frame/EditorFrame";
import { Button, Icon, type IconSvgElement } from "../kit/index";
import type { EditorHostState } from "../session/live-scene-editor";
import { useEditorStore } from "../session/use-editor-store";
import type { SceneNotice } from "../session/use-scene-editor";
import { useStoreValue, type ReadableStore } from "../session/use-store-value";
import { distinctPeople, PeerFaces } from "./peer-faces";

const NO_NOTICE: ReadableStore<SceneNotice | null> = { state: null, subscribe: () => () => {} };

const NO_ISSUES: ReadableStore<readonly SceneIssue[]> = { state: [], subscribe: () => () => {} };

const SEVERITY_WORDS = [
  ["error", "error", "errors"],
  ["warn", "warning", "warnings"],
  ["info", "info", "info"],
] as const;

/** The problems overview's words: "No problems", or each severity's count. */
export function problemsSummary(issues: readonly SceneIssue[]): string {
  const counted = SEVERITY_WORDS.flatMap(([severity, one, many]) => {
    const n = issues.filter((i) => i.severity === severity).length;
    return n > 0 ? [plural(n, one, many)] : [];
  });
  return counted.length > 0 ? counted.join(" · ") : "No problems";
}

/**
 * The status bar: the save state, why the editor last opened this scene by
 * itself, who is here and what is running on the left; the scene's problems
 * in one line on the right, which opens the Problems panel. Each part keeps
 * its own line and is cut short when the bar runs out of room.
 */
export function EditorStatusBar({
  session,
  host,
  physical = NO_ISSUES,
  named = false,
  notice: noticeStore = NO_NOTICE,
}: {
  session: EditorSession;
  host: Store<EditorHostState>;
  /** The physical issues the Problems panel lists beside the session's own. */
  physical?: ReadableStore<readonly SceneIssue[]>;
  /** Names the scene first, for an editor with no scene picker to name it. */
  named?: boolean;
  /** Why the editor switched to this scene by itself. */
  notice?: ReadableStore<SceneNotice | null>;
}) {
  const sceneName = useEditorStore(session, (s) => s.sceneName);
  const notice = useStoreValue(noticeStore, (n) => n?.text ?? null);
  const refusal = useEditorStore(session, (s) => s.notice);
  const structural = useEditorStore(session, (s) => s.issues);
  const physicalIssues = useStoreValue(physical, (s) => s);
  const peers = useEditorStore(session, (s) => s.peers);
  const connection = useStoreValue(host, (s) => s.connection);
  const unsynced = useStoreValue(host, (s) => s.unsynced ?? 0);
  const openProblems = usePanelOpener("problems");
  const issues = [...structural, ...physicalIssues];
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warn").length;
  const others = distinctPeople(peers).length;
  const here = others === 0 ? "Just you" : plural(others, "other here", "others here");
  const summary = problemsSummary(issues);
  const tone =
    errors > 0 ? "danger" : warnings > 0 ? "warning" : issues.length > 0 ? "info" : "muted";
  const icon: IconSvgElement =
    errors > 0
      ? AlertCircleIcon
      : warnings > 0
        ? Alert02Icon
        : issues.length > 0
          ? InformationCircleIcon
          : CheckmarkCircle02Icon;

  return (
    <div className="je-status">
      <div role="status" className="je-status-start">
        {named ? <span className="je-status-scene">{sceneName}</span> : null}
        <SaveState connection={connection} unsynced={unsynced} />
        {notice ? (
          <span className="je-status-notice" data-tone="muted">
            {notice}
          </span>
        ) : null}
        {refusal ? (
          <span className="je-status-notice" data-tone="warning" data-tool-notice="">
            {refusal}
          </span>
        ) : null}
        {others > 0 ? (
          <span className="je-status-peers" data-tone="muted">
            <PeerFaces peers={peers} label="Here:" size={16} />
            <span className="je-status-text">{here}</span>
          </span>
        ) : (
          <span className="je-sr-only">{here}</span>
        )}
        <Activity />
      </div>
      {openProblems ? (
        <Button
          variant="ghost"
          size="xs"
          icon={icon}
          className="je-status-problems"
          data-tone={tone}
          aria-label={`${summary}. Show the Problems panel`}
          tooltip="Show the Problems panel"
          tooltipSide="top"
          onClick={openProblems}
        >
          {summary}
        </Button>
      ) : (
        <span className="je-status-problems" data-tone={tone}>
          <Icon icon={icon} size={12} />
          <span className="je-status-text">{summary}</span>
        </span>
      )}
    </div>
  );
}
