import { Alert02Icon, AlertCircleIcon, InformationCircleIcon } from "@hugeicons/core-free-icons";
import { useMemo } from "react";

import type { EditorSession, Ref, SceneIssue } from "../../editor/index";
import type { EditorNotify } from "../host";
import { Button, Hint, Icon, MicroLabel, Text, type IconSvgElement } from "../kit/index";
import { useEditorStore } from "../session/use-editor-store";

type Severity = SceneIssue["severity"];

const SEVERITIES: readonly { id: Severity; title: string; icon: IconSvgElement }[] = [
  { id: "error", title: "Errors", icon: AlertCircleIcon },
  { id: "warn", title: "Warnings", icon: Alert02Icon },
  { id: "info", title: "Info", icon: InformationCircleIcon },
];

/** Structural issues first, then physical ones, each tagged so rows keep stable keys. */
function merged(structural: readonly SceneIssue[], physical: readonly SceneIssue[]) {
  return [
    ...structural.map((issue, i) => ({ issue, key: `s${i}:${issue.code}` })),
    ...physical.map((issue, i) => ({ issue, key: `p${i}:${issue.code}` })),
  ];
}

/**
 * The scene's problems by severity: the session's structural issues and the
 * physical ones passed in. A row is one line (two when its message needs
 * them) of icon, message and code, its hint on hover; in a narrow panel the
 * code moves to a line of its own under the message. A row selects and
 * frames what it names, and **Fix** applies the issue's own repair as one
 * batch.
 */
export function ProblemsPanel({
  session,
  physical,
  onFrame,
  notify,
}: {
  session: EditorSession;
  physical: readonly SceneIssue[];
  onFrame: (refs: Ref[]) => void;
  notify: EditorNotify;
}) {
  const structural = useEditorStore(session, (s) => s.issues);
  const rows = useMemo(() => merged(structural, physical), [structural, physical]);

  const show = (issue: SceneIssue) => {
    if (issue.entityIds.length === 0) return;
    session.select(issue.entityIds);
    onFrame(issue.entityIds);
  };

  const fix = (issue: SceneIssue) => {
    if (!issue.fix) return;
    const result = session.dispatch(issue.fix);
    if (!result.ok)
      notify.error(`Couldn't fix ${issue.code}`, { description: result.issue.message });
  };

  return (
    <section aria-label="Problems" className="je-scene-panel je-problems">
      {rows.length === 0 ? (
        <Text as="p" size="xs" variant="muted" className="je-scene-panel-empty">
          No problems found.
        </Text>
      ) : (
        <div className="je-scene-panel-scroll">
          {SEVERITIES.map(({ id, title, icon }) => {
            const group = rows.filter((r) => r.issue.severity === id);
            if (group.length === 0) return null;
            return (
              <section
                key={id}
                aria-label={`${title} (${group.length})`}
                className="je-problems-group"
              >
                <h3 className="je-problems-group-title">
                  <MicroLabel>
                    {title} · {group.length}
                  </MicroLabel>
                </h3>
                <ul>
                  {group.map(({ issue, key }) => (
                    <li key={key} aria-label={issue.message} className="je-problems-row">
                      <Hint content={issue.hint} disabled={!issue.hint} side="left">
                        <button
                          type="button"
                          disabled={issue.entityIds.length === 0}
                          onClick={() => show(issue)}
                          className="je-problems-show"
                        >
                          <span className="je-problems-icon" data-severity={id}>
                            <Icon icon={icon} size={12} />
                          </span>
                          <span className="je-problems-message">{issue.message}</span>
                          <span className="je-problems-code">{issue.code}</span>
                        </button>
                      </Hint>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="je-problems-fix"
                        disabled={!issue.fix}
                        onClick={() => fix(issue)}
                        tooltip={
                          issue.fix ? (issue.fix.label ?? "Apply the fix") : "No automatic fix"
                        }
                      >
                        Fix
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
