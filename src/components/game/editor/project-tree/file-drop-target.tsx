import { useRef, useState, type DragEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Rows that take dropped files carry their folder (`moveAsset`'s `to`) in this attribute. */
export const DROP_FOLDER_ATTR = "data-drop-folder";

const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

function folderAt(target: EventTarget | null): string {
  const el = target instanceof Element ? target.closest(`[${DROP_FOLDER_ATTR}]`) : null;
  return el?.getAttribute(DROP_FOLDER_ATTR) ?? "";
}

/**
 * Takes files dragged in from the desktop: onto a folder row they go into
 * that folder, anywhere else into the root. `over` is the folder under the
 * pointer while a drag is on the panel, for rows to highlight.
 */
export function FileDropTarget({
  enabled,
  onDrop,
  children,
  className,
}: {
  enabled: boolean;
  onDrop: (files: File[], folder: string) => void;
  children: (over: string | null) => ReactNode;
  className?: string;
}) {
  const [over, setOver] = useState<string | null>(null);
  const depth = useRef(0);
  const reset = () => {
    depth.current = 0;
    setOver(null);
  };
  return (
    <div
      data-testid="project-drop-target"
      className={cn(
        "flex min-h-0 flex-1 flex-col rounded-md",
        over === "" && "ring-1 ring-primary",
      )}
      onDragEnter={(e) => {
        if (!enabled || !carriesFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(folderAt(e.target));
      }}
      onDragOver={(e) => {
        if (!enabled || !carriesFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        const folder = folderAt(e.target);
        if (folder !== over) setOver(folder);
      }}
      onDragLeave={() => {
        if (!enabled) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(null);
      }}
      onDrop={(e) => {
        if (!enabled || !carriesFiles(e)) return;
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        const folder = folderAt(e.target);
        reset();
        if (files.length > 0) onDrop(files, folder);
      }}
    >
      <div className={cn("flex min-h-0 flex-1 flex-col", className)}>{children(over)}</div>
    </div>
  );
}
