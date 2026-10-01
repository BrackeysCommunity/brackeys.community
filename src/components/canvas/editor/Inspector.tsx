import {
  Cancel01Icon,
  Copy01Icon,
  Delete02Icon,
  DistributeHorizontalCenterIcon,
  DistributeVerticalCenterIcon,
  FlowConnectionIcon,
  LayerBringToFrontIcon,
  LayerSendToBackIcon,
  PencilEdit01Icon,
  SquareIcon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { MicroLabel, Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import type { CanvasCard } from "../canvas-cards";
import { cardTitle } from "../outline";
import type { CanvasFlowEdge } from "./canvas-doc";
import { ColorSwatches } from "./ColorSwatches";
import { ALIGN_ACTIONS } from "./SelectionBar";
import type { CanvasCommands } from "./use-canvas-commands";

const TYPE_LABEL: Record<CanvasCard["type"], string> = {
  text: "Text card",
  file: "File card",
  link: "Link card",
  group: "Group",
  image: "Image",
  entity: "Live card",
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-b border-border px-3 py-3 last:border-b-0">
      <MicroLabel>{label}</MicroLabel>
      {children}
    </section>
  );
}

function SizeField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft != null && draft.trim() !== "") onCommit(Number(draft));
    setDraft(null);
  };
  return (
    <label className="flex flex-1 items-center gap-1.5 rounded-md border border-border px-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input
        inputMode="numeric"
        value={draft ?? String(Math.round(value))}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        className="h-7 w-full min-w-0 bg-transparent tabular-nums outline-none"
      />
    </label>
  );
}

function Action({
  label,
  icon,
  shortcut,
  danger,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof Copy01Icon;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-50",
        danger && "text-destructive",
      )}
    >
      <HugeiconsIcon icon={icon} size={14} className="shrink-0" />
      <span className="flex-1">{label}</span>
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </button>
  );
}

/**
 * The right island: the settings that need room, for the current
 * selection. It runs the same commands as the selection bar.
 */
export function Inspector({
  commands,
  cards,
  edges,
  allCards,
  allEdges,
  onConnect,
  onRenameLabel,
  onColorCommit,
  onFocusCard,
  onCollapse,
}: {
  commands: CanvasCommands;
  cards: CanvasCard[];
  edges: CanvasFlowEdge[];
  allCards: Map<string, CanvasCard>;
  allEdges: CanvasFlowEdge[];
  onConnect: (cardId: string) => void;
  onRenameLabel: (id: string) => void;
  onColorCommit: () => void;
  onFocusCard: (cardId: string) => void;
  onCollapse: () => void;
}) {
  const single = cards.length === 1 ? cards[0]! : null;
  const edge = cards.length === 0 && edges.length === 1 ? edges[0]! : null;
  const heading = single
    ? TYPE_LABEL[single.type]
    : cards.length
      ? `${cards.length} cards`
      : edges.length === 1
        ? "Connection"
        : `${edges.length} connections`;
  const connections = single
    ? allEdges.filter((e) => e.source === single.id || e.target === single.id)
    : [];

  return (
    <aside
      aria-label="Inspector"
      data-shell-region=""
      className="pointer-events-auto flex max-h-[calc(100%-10rem)] min-h-0 flex-col rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border py-1.5 pr-1.5 pl-3">
        <h2 className="truncate text-sm font-bold">{heading}</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onCollapse}
          aria-label="Hide inspector"
          tooltip="Hide inspector"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section label="COLOR">
          <ColorSwatches
            current={single?.color ?? edge?.data?.color}
            onColor={commands.setColor}
            onCommit={onColorCommit}
          />
        </Section>

        {single ? (
          <Section label="SIZE">
            <div className="flex gap-2">
              <SizeField
                label="W"
                value={single.w}
                onCommit={(w) => commands.setSize(single.id, { w })}
              />
              <SizeField
                label="H"
                value={single.h}
                onCommit={(h) => commands.setSize(single.id, { h })}
              />
            </div>
          </Section>
        ) : null}

        {single && (single.type === "file" || single.type === "image") && single.file ? (
          <Section label="VAULT PATH">
            <Text as="p" size="xs" className="break-all">
              {single.file}
            </Text>
          </Section>
        ) : null}

        {single ? (
          <Section label="CONNECTIONS">
            {connections.length ? (
              <ul className="flex flex-col">
                {connections.map((e) => {
                  const outgoing = e.source === single.id;
                  const other = allCards.get(outgoing ? e.target : e.source);
                  if (!other) return null;
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => onFocusCard(other.id)}
                        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-muted"
                      >
                        <span
                          aria-label={outgoing ? "To" : "From"}
                          className="text-muted-foreground"
                        >
                          {outgoing ? "→" : "←"}
                        </span>
                        <span className="truncate">{cardTitle(other)}</span>
                        {e.data?.label ? (
                          <span className="ml-auto shrink-0 text-muted-foreground">
                            {e.data.label}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Text as="p" size="xs" variant="muted">
                None yet.
              </Text>
            )}
          </Section>
        ) : null}

        <Section label="ACTIONS">
          <div className="flex flex-col">
            {single ? (
              <Action
                label="Connect"
                icon={FlowConnectionIcon}
                onClick={() => onConnect(single.id)}
              />
            ) : null}
            {single?.type === "group" ? (
              <Action
                label="Rename group"
                icon={PencilEdit01Icon}
                onClick={() => onRenameLabel(single.id)}
              />
            ) : null}
            {edge ? (
              <>
                <Action label="Label" icon={Tag01Icon} onClick={() => onRenameLabel(edge.id)} />
                <Action
                  label={edge.markerStart ? "Remove start arrow" : "Add start arrow"}
                  icon={FlowConnectionIcon}
                  onClick={() =>
                    commands.setEdgeEnds(edge.id, { fromEnd: edge.markerStart ? "none" : "arrow" })
                  }
                />
                <Action
                  label={edge.markerEnd ? "Remove end arrow" : "Add end arrow"}
                  icon={FlowConnectionIcon}
                  onClick={() =>
                    commands.setEdgeEnds(edge.id, { toEnd: edge.markerEnd ? "none" : "arrow" })
                  }
                />
              </>
            ) : null}
            {cards.length > 1 ? (
              <>
                <Action
                  label="Group selection"
                  icon={SquareIcon}
                  onClick={commands.groupSelection}
                />
                {ALIGN_ACTIONS.map((a) => (
                  <Action
                    key={a.kind}
                    label={a.label}
                    icon={a.icon}
                    onClick={() => commands.align(a.kind)}
                  />
                ))}
                <Action
                  label="Distribute horizontally"
                  icon={DistributeHorizontalCenterIcon}
                  disabled={cards.length < 3}
                  onClick={() => commands.distribute("horizontal")}
                />
                <Action
                  label="Distribute vertically"
                  icon={DistributeVerticalCenterIcon}
                  disabled={cards.length < 3}
                  onClick={() => commands.distribute("vertical")}
                />
              </>
            ) : null}
            {cards.length ? (
              <>
                <Action
                  label="Duplicate"
                  icon={Copy01Icon}
                  shortcut="⌘D"
                  onClick={commands.duplicate}
                />
                <Action
                  label="Copy as Markdown"
                  icon={Copy01Icon}
                  onClick={() => void commands.copyMarkdown()}
                />
                <Action
                  label="Bring to front"
                  icon={LayerBringToFrontIcon}
                  onClick={commands.bringToFront}
                />
                <Action
                  label="Send to back"
                  icon={LayerSendToBackIcon}
                  onClick={commands.sendToBack}
                />
              </>
            ) : null}
            <Action
              label="Delete"
              icon={Delete02Icon}
              shortcut="⌫"
              danger
              onClick={commands.remove}
            />
          </div>
        </Section>
      </div>
    </aside>
  );
}
