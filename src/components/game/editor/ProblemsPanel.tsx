import { Alert02Icon, AlertCircleIcon, InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { EditorSession, Ref, SceneIssue } from "@jams/engine/editor";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { MicroLabel, Text } from "@/components/ui/typography";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { useEditorStore } from "./use-editor-store";

type Severity = SceneIssue["severity"];

const SEVERITIES: readonly { id: Severity; title: string; icon: typeof AlertCircleIcon }[] = [
  { id: "error", title: "Errors", icon: AlertCircleIcon },
  { id: "warn", title: "Warnings", icon: Alert02Icon },
  { id: "info", title: "Info", icon: InformationCircleIcon },
];

const TONE: Record<Severity, string> = {
  error: "text-destructive",
  warn: "text-warning",
  info: "text-muted-foreground",
};

/** Structural issues first, then physical ones, each tagged so rows keep stable keys. */
function merged(structural: readonly SceneIssue[], physical: readonly SceneIssue[]) {
  return [
    ...structural.map((issue, i) => ({ issue, key: `s${i}:${issue.code}` })),
    ...physical.map((issue, i) => ({ issue, key: `p${i}:${issue.code}` })),
  ];
}

/**
 * The scene's problems by severity: the session's structural issues and the
 * physical ones passed in. A row selects and frames what it names; **Fix**
 * applies the issue's own repair as one batch.
 */
export function ProblemsPanel({
  session,
  physical,
  onFrame,
}: {
  session: EditorSession;
  physical: readonly SceneIssue[];
  onFrame: (refs: Ref[]) => void;
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
      toast.error(`Couldn't fix ${issue.code}`, { description: result.issue.message });
  };

  return (
    <section aria-label="Problems" className="flex min-h-0 w-full flex-col">
      <h2 className="flex items-center gap-2 px-2 pt-1 pb-1 text-sm font-medium">
        Problems
        {SEVERITIES.map(({ id, icon }) => {
          const n = rows.filter((r) => r.issue.severity === id).length;
          return n > 0 ? (
            <span
              key={id}
              className={cn("flex items-center gap-0.5 text-xs tabular-nums", TONE[id])}
            >
              <HugeiconsIcon icon={icon} className="size-3" aria-hidden />
              {n}
            </span>
          ) : null;
        })}
      </h2>
      {rows.length === 0 ? (
        <Text as="p" size="xs" variant="muted" className="px-2 pb-2">
          No problems found.
        </Text>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {SEVERITIES.map(({ id, title, icon }) => {
            const group = rows.filter((r) => r.issue.severity === id);
            if (group.length === 0) return null;
            return (
              <section key={id} aria-label={`${title} (${group.length})`} className="pb-1">
                <h3 className="px-2 py-0.5">
                  <MicroLabel>
                    {title} · {group.length}
                  </MicroLabel>
                </h3>
                <ul>
                  {group.map(({ issue, key }) => (
                    <li
                      key={key}
                      aria-label={issue.message}
                      className="flex items-start gap-1 rounded-md px-1 hover:bg-muted/60"
                    >
                      <SimpleTooltip content={issue.hint} disabled={!issue.hint} side="left">
                        <button
                          type="button"
                          disabled={issue.entityIds.length === 0}
                          onClick={() => show(issue)}
                          className="flex min-w-0 flex-1 items-start gap-1.5 py-1 text-left text-xs disabled:cursor-default"
                        >
                          <HugeiconsIcon
                            icon={icon}
                            className={cn("mt-0.5 size-3 shrink-0", TONE[id])}
                            aria-hidden
                          />
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span>{issue.message}</span>
                            <Badge size="label" variant="outline" className="h-4 px-1">
                              {issue.code}
                            </Badge>
                          </span>
                        </button>
                      </SimpleTooltip>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="mt-0.5"
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
