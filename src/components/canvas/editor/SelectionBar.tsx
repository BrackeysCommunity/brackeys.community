import {
  AlignBottomIcon,
  AlignHorizontalCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignTopIcon,
  AlignVerticalCenterIcon,
  ArrowUpRight01Icon,
  Copy01Icon,
  Delete02Icon,
  DistributeHorizontalCenterIcon,
  DistributeVerticalCenterIcon,
  FlowConnectionIcon,
  ImageUploadIcon,
  LayerBringToFrontIcon,
  LayerSendToBackIcon,
  Link01Icon,
  MoreHorizontalIcon,
  PencilEdit01Icon,
  SquareIcon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useStore } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isExternalUrl } from "@/lib/external-url";

import type { CanvasCard } from "../canvas-cards";
import type { CanvasFlowEdge } from "./canvas-doc";
import { ColorSwatches } from "./ColorSwatches";
import type { AlignKind, CanvasCommands } from "./use-canvas-commands";

const GAP = 12;
/** Room the top islands take; the bar flips below the selection rather than sit under them. */
const TOP_CLEARANCE = 64;

export const ALIGN_ACTIONS: { kind: AlignKind; label: string; icon: typeof AlignLeftIcon }[] = [
  { kind: "left", label: "Align left", icon: AlignLeftIcon },
  { kind: "center", label: "Align centres", icon: AlignHorizontalCenterIcon },
  { kind: "right", label: "Align right", icon: AlignRightIcon },
  { kind: "top", label: "Align tops", icon: AlignTopIcon },
  { kind: "middle", label: "Align middles", icon: AlignVerticalCenterIcon },
  { kind: "bottom", label: "Align bottoms", icon: AlignBottomIcon },
];

function EditUrlPopover({
  url,
  onSave,
  children,
}: {
  url: string;
  onSave: (url: string) => void;
  children: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(url);
  const valid = isExternalUrl(draft.trim());
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(url);
      }}
    >
      <PopoverTrigger render={children} />
      <PopoverContent side="top" sideOffset={10} className="w-80 p-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSave(draft.trim());
            setOpen(false);
          }}
        >
          <Input
            autoFocus
            type="url"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Link address"
          />
          <Button type="submit" disabled={!valid}>
            Save
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function BarButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: typeof Copy01Icon;
  onClick?: () => void;
}) {
  return (
    <Button variant="ghost" size="icon-sm" tooltip={label} aria-label={label} onClick={onClick}>
      <HugeiconsIcon icon={icon} size={15} />
    </Button>
  );
}

const Divider = () => <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />;

/** The selection's box in flow coordinates. */
function selectionBox(cards: CanvasCard[], edges: CanvasFlowEdge[], all: Map<string, CanvasCard>) {
  const boxes = cards.length
    ? cards
    : edges.flatMap((e) => {
        const a = all.get(e.source);
        const b = all.get(e.target);
        if (!a || !b) return [];
        const x = (a.x + a.w / 2 + b.x + b.w / 2) / 2;
        const y = (a.y + a.h / 2 + b.y + b.h / 2) / 2;
        return [{ x, y, w: 0, h: 0 }];
      });
  if (boxes.length === 0) return null;
  return {
    x: Math.min(...boxes.map((c) => c.x)),
    y: Math.min(...boxes.map((c) => c.y)),
    right: Math.max(...boxes.map((c) => c.x + c.w)),
    bottom: Math.max(...boxes.map((c) => c.y + c.h)),
  };
}

/**
 * The fast path for a selection, floating just above it. Flips below when
 * there's no room, stays inside the window, and the editor hides it while
 * something moves.
 */
export function SelectionBar({
  commands,
  cards,
  edges,
  allCards,
  onConnect,
  onRenameLabel,
  onColorCommit,
}: {
  commands: CanvasCommands;
  cards: CanvasCard[];
  edges: CanvasFlowEdge[];
  allCards: Map<string, CanvasCard>;
  onConnect: (cardId: string) => void;
  onRenameLabel: (id: string) => void;
  onColorCommit: () => void;
}) {
  const [tx, ty, zoom] = useStore((s) => s.transform);
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const bar = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const imageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const box = selectionBox(cards, edges, allCards);
  if (!box) return null;

  const left = box.x * zoom + tx;
  const right = box.right * zoom + tx;
  const top = box.y * zoom + ty;
  const bottom = box.bottom * zoom + ty;
  const above = top - GAP - size.h;
  const y = above >= TOP_CLEARANCE ? above : Math.min(bottom + GAP, height - size.h - GAP);
  const x = Math.max(GAP, Math.min((left + right) / 2 - size.w / 2, width - size.w - GAP));

  const single = cards.length === 1 ? cards[0]! : null;
  const edge = cards.length === 0 && edges.length === 1 ? edges[0]! : null;
  const color = single?.color ?? (cards.length ? undefined : edge?.data?.color);

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Selection"
      data-shell-region=""
      className="pointer-events-auto absolute z-30 flex items-center gap-1 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      style={{ transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)`, top: 0, left: 0 }}
    >
      <ColorSwatches
        current={color}
        onColor={commands.setColor}
        onCommit={onColorCommit}
        className="px-1"
      />

      {edge ? (
        <>
          <Divider />
          <BarButton label="Label" icon={Tag01Icon} onClick={() => onRenameLabel(edge.id)} />
          <Button
            variant={edge.markerStart ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={edge.markerStart != null}
            onClick={() =>
              commands.setEdgeEnds(edge.id, { fromEnd: edge.markerStart ? "none" : "arrow" })
            }
          >
            ← Start
          </Button>
          <Button
            variant={edge.markerEnd ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={edge.markerEnd != null}
            onClick={() =>
              commands.setEdgeEnds(edge.id, { toEnd: edge.markerEnd ? "none" : "arrow" })
            }
          >
            End →
          </Button>
        </>
      ) : null}

      {single ? (
        <>
          <Divider />
          <BarButton
            label="Connect"
            icon={FlowConnectionIcon}
            onClick={() => onConnect(single.id)}
          />
          {single.type === "link" && single.url ? (
            <>
              <EditUrlPopover url={single.url} onSave={(url) => commands.setUrl(single.id, url)}>
                <Button variant="ghost" size="icon-sm" tooltip="Edit URL" aria-label="Edit URL">
                  <HugeiconsIcon icon={Link01Icon} size={15} />
                </Button>
              </EditUrlPopover>
              <Button
                variant="ghost"
                size="icon-sm"
                tooltip="Open"
                render={
                  <a
                    href={single.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open link"
                  />
                }
              >
                <HugeiconsIcon icon={ArrowUpRight01Icon} size={15} />
              </Button>
            </>
          ) : null}
          {single.type === "entity" && single.url ? (
            <Button
              variant="ghost"
              size="icon-sm"
              tooltip="Open page"
              render={<a href={single.url} aria-label="Open page" />}
            >
              <HugeiconsIcon icon={ArrowUpRight01Icon} size={15} />
            </Button>
          ) : null}
          {single.type === "image" ? (
            <>
              <BarButton
                label="Replace image"
                icon={ImageUploadIcon}
                onClick={() => imageInput.current?.click()}
              />
              <input
                ref={imageInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                tabIndex={-1}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) commands.replaceImage(single.id, file);
                  e.target.value = "";
                }}
              />
            </>
          ) : null}
          {single.type === "group" ? (
            <BarButton
              label="Rename group"
              icon={PencilEdit01Icon}
              onClick={() => onRenameLabel(single.id)}
            />
          ) : null}
        </>
      ) : null}

      {cards.length > 1 ? (
        <>
          <Divider />
          <BarButton label="Group selection" icon={SquareIcon} onClick={commands.groupSelection} />
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Align and distribute"
              render={<Button variant="ghost" size="icon-sm" tooltip="Align and distribute" />}
            >
              <HugeiconsIcon icon={AlignLeftIcon} size={15} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" sideOffset={8}>
              {ALIGN_ACTIONS.map((a) => (
                <DropdownMenuItem key={a.kind} onClick={() => commands.align(a.kind)}>
                  <HugeiconsIcon icon={a.icon} size={14} />
                  {a.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={cards.length < 3}
                onClick={() => commands.distribute("horizontal")}
              >
                <HugeiconsIcon icon={DistributeHorizontalCenterIcon} size={14} />
                Distribute horizontally
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={cards.length < 3}
                onClick={() => commands.distribute("vertical")}
              >
                <HugeiconsIcon icon={DistributeVerticalCenterIcon} size={14} />
                Distribute vertically
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}

      <Divider />
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="More"
          render={<Button variant="ghost" size="icon-sm" tooltip="More" />}
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} size={15} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} className="min-w-52">
          {cards.length ? (
            <>
              <DropdownMenuItem onClick={commands.duplicate}>
                <HugeiconsIcon icon={Copy01Icon} size={14} />
                Duplicate
                <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void commands.copyMarkdown()}>
                <HugeiconsIcon icon={Copy01Icon} size={14} />
                Copy as Markdown
              </DropdownMenuItem>
              <DropdownMenuItem onClick={commands.bringToFront}>
                <HugeiconsIcon icon={LayerBringToFrontIcon} size={14} />
                Bring to front
              </DropdownMenuItem>
              <DropdownMenuItem onClick={commands.sendToBack}>
                <HugeiconsIcon icon={LayerSendToBackIcon} size={14} />
                Send to back
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem className="text-destructive" onClick={commands.remove}>
            <HugeiconsIcon icon={Delete02Icon} size={14} />
            Delete
            <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
