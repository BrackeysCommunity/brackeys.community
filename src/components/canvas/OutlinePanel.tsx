import { Cancel01Icon, Copy01Icon, File01Icon, Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { basename, folderTree, pathTitle, type FolderNode } from "@/lib/canvas/paths";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import type { CanvasCard } from "./canvas-cards";
import { canvasListQueryOptions, type CanvasListItem, type CanvasScope } from "./canvas-queries";
import {
  canvasOutline,
  cardTitle,
  outlineMarkdown,
  type OutlineEdge,
  type OutlineItem,
} from "./outline";

function OutlineList({
  items,
  onFocus,
}: {
  items: OutlineItem[];
  onFocus: (cardId: string) => void;
}) {
  return (
    <ul className="flex flex-col">
      {items.map(({ card, children }) => (
        <li key={card.id}>
          <button
            type="button"
            onClick={() => onFocus(card.id)}
            className="flex w-full min-w-0 items-baseline gap-2 rounded-md px-2 py-1 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
          >
            <Text as="span" size="sm" bold={card.type === "group"} ellipsis>
              {cardTitle(card)}
            </Text>
          </button>
          {children.length ? (
            <div className="ml-3 border-l border-border pl-1">
              <OutlineList items={children} onFocus={onFocus} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function FileTree({
  node,
  currentId,
  depth = 0,
}: {
  node: FolderNode<CanvasListItem>;
  currentId: string;
  depth?: number;
}) {
  const indent = { paddingLeft: `${0.5 + depth * 0.75}rem` };
  return (
    <ul className="flex flex-col">
      {node.folders.map((folder) => (
        <li key={folder.path}>
          <div
            style={indent}
            className="flex items-center gap-1.5 py-1 pr-2 text-xs text-muted-foreground"
          >
            <HugeiconsIcon icon={Folder01Icon} size={13} className="shrink-0" />
            <span className="truncate">{folder.name}</span>
          </div>
          <FileTree node={folder} currentId={currentId} depth={depth + 1} />
        </li>
      ))}
      {node.files.map((file) => (
        <li key={file.id}>
          <Link
            to="/canvases/$canvasId"
            params={{ canvasId: file.id }}
            aria-current={file.id === currentId ? "page" : undefined}
            title={basename(file.path)}
            style={indent}
            className={cn(
              "flex items-center gap-1.5 rounded-md py-1 pr-2 text-xs",
              file.id === currentId
                ? "bg-muted font-bold text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <HugeiconsIcon icon={File01Icon} size={13} className="shrink-0" />
            <span className="truncate">{pathTitle(file.path)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The current scope's paths, as a vault's file explorer shows them. */
function ScopeFiles({ scope, currentId }: { scope: CanvasScope; currentId: string }) {
  const list = useQuery(canvasListQueryOptions(scope));
  const tree = useMemo(() => folderTree(list.data ?? []), [list.data]);
  if (list.isPending) return <Skeleton className="h-24 w-full" />;
  if (list.isError) {
    return (
      <Text as="p" size="xs" variant="muted" className="p-2">
        This scope's files aren't available to you.
      </Text>
    );
  }
  return <FileTree node={tree} currentId={currentId} />;
}

/**
 * The left island. **Outline** is the canvas as a nested list in reading
 * order (groups hold what's inside them), a way round it without a pointer,
 * plus "Copy as Markdown". **Files** is the scope's path tree, for members
 * who can list it.
 */
export function OutlinePanel({
  cards,
  edges,
  onFocus,
  onClose,
  files,
}: {
  cards: CanvasCard[];
  edges: OutlineEdge[];
  onFocus: (cardId: string) => void;
  onClose: () => void;
  files?: { scope: CanvasScope; currentId: string };
}) {
  const items = useMemo(() => canvasOutline(cards), [cards]);
  const [tab, setTab] = useState<"outline" | "files">("outline");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(outlineMarkdown(items, edges));
    } catch {
      toast.error("Couldn't copy to the clipboard.");
      return;
    }
    toast.success("Copied as Markdown.");
  };

  return (
    <aside
      aria-label="Outline"
      data-shell-region=""
      className="pointer-events-auto flex min-h-0 w-full flex-col rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border p-2">
        {files ? (
          <SegmentedControl
            size="sm"
            value={tab}
            onChange={(next) => setTab(next as "outline" | "files")}
          >
            <SegmentedControl.Item value="outline">Outline</SegmentedControl.Item>
            <SegmentedControl.Item value="files">Files</SegmentedControl.Item>
          </SegmentedControl>
        ) : (
          <Text as="span" size="sm" bold className="px-1">
            Outline
          </Text>
        )}
        <div className="flex items-center gap-1">
          {tab === "outline" ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={copy}
              disabled={items.length === 0}
              aria-label="Copy as Markdown"
              tooltip="Copy as Markdown"
            >
              <HugeiconsIcon icon={Copy01Icon} size={14} />
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close outline">
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </Button>
        </div>
      </header>
      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        {tab === "files" && files ? (
          <ScopeFiles scope={files.scope} currentId={files.currentId} />
        ) : items.length ? (
          <OutlineList items={items} onFocus={onFocus} />
        ) : (
          <Text as="p" size="xs" variant="muted" className="p-2">
            Nothing on this canvas yet.
          </Text>
        )}
      </nav>
    </aside>
  );
}
