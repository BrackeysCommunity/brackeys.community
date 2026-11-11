import type { ReactNode } from "react";

import { Button, Skeleton } from "../../kit/index";
import { usePresenceIn, type SettingsDoc } from "./settings-doc";
import { SettingsNote } from "./SettingsRows";

/**
 * A settings tab over one doc: "Create" while the project has none (the
 * kind's empty asset), a placeholder while it opens, then `children` with
 * the doc's value. Focus inside it shows the doc in this client's presence.
 */
export function DocGate({
  doc,
  noun,
  children,
}: {
  doc: SettingsDoc;
  /** What the doc is called in "This project has no …". */
  noun: string;
  children: (value: Record<string, unknown>) => ReactNode;
}) {
  const presence = usePresenceIn(doc.session, doc.docName);
  if (!doc.entry) {
    return (
      <div className="je-insp-stack">
        <SettingsNote>This project has no {noun} yet.</SettingsNote>
        <div className="je-insp-line">
          <Button
            size="sm"
            variant="secondary"
            disabled={doc.readOnly !== null}
            busyScope={`settings:create:${doc.kind}`}
            tooltip={doc.readOnly ?? undefined}
            onClick={() => void doc.create()}
          >
            Create {noun}
          </Button>
        </div>
      </div>
    );
  }
  if (!doc.value) {
    return (
      <div className="je-panel-skeleton">
        <Skeleton className="je-panel-skeleton-row" />
        <Skeleton className="je-panel-skeleton-row" />
      </div>
    );
  }
  return (
    <div className="je-insp-stack" onFocus={presence.onFocus} onBlur={presence.onBlur}>
      {doc.readOnly ? <SettingsNote>{doc.readOnly}</SettingsNote> : null}
      {children(doc.value)}
    </div>
  );
}
