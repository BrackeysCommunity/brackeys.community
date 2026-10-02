import {
  Calendar03Icon,
  File01Icon,
  ImageNotFound01Icon,
  Link01Icon,
  Message01Icon,
  UserGroupIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  type CSSProperties,
  memo,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { SimpleTooltip } from "@/components/ui/tooltip";
import { MicroLabel, Text } from "@/components/ui/typography";
import { MarkedText } from "@/components/ui/typography/marked-text";
import { UserAvatar } from "@/components/ui/user-avatar";
import { createBatchLoader } from "@/lib/batch-loader";
import type { EntityKind, EntityRef, JsonCanvasNode } from "@/lib/canvas/json-canvas";
import { basename } from "@/lib/canvas/paths";
import { type Wikilink, wikilinkLabel, wikilinkMatches } from "@/lib/canvas/wikilinks";
import { externalUrlHost } from "@/lib/external-url";
import { cn } from "@/lib/utils";
import { client } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import type { CanvasAttachmentMap, CanvasEntity } from "./canvas-queries";
import { firstLine } from "./outline";

/** One card, whether it came from a snapshot or a live doc. */
export interface CanvasCard {
  id: string;
  type: "text" | "file" | "link" | "group" | "image" | "entity";
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  text?: string;
  file?: string;
  subpath?: string;
  url?: string;
  label?: string;
  attachmentId?: string;
  entity?: EntityRef;
}

/**
 * How much a card draws: `blocks` is its colored surface alone (text there
 * would be a pixel or two tall, and painting it is most of the cost of
 * panning a whole big canvas), `far` adds its title, `mid` skips heavy media.
 */
export type CanvasDetailLevel = "blocks" | "far" | "mid" | "near";

export function detailLevelFor(zoom: number): CanvasDetailLevel {
  if (zoom < 0.2) return "blocks";
  if (zoom < 0.4) return "far";
  if (zoom < 0.7) return "mid";
  return "near";
}

export function cardFromJson(node: JsonCanvasNode): CanvasCard | null {
  const base = {
    id: node.id,
    x: node.x,
    y: node.y,
    w: node.width,
    h: node.height,
    color: node.color,
  };
  if (node.brackeys?.type === "image") {
    return { ...base, type: "image", attachmentId: node.brackeys.attachmentId, file: node.file };
  }
  if (node.brackeys?.type === "entity") {
    return { ...base, type: "entity", entity: node.brackeys.entity, url: node.url };
  }
  switch (node.type) {
    case "text":
      return { ...base, type: "text", text: node.text ?? "" };
    case "file":
      return { ...base, type: "file", file: node.file ?? "", subpath: node.subpath };
    case "link":
      return { ...base, type: "link", url: node.url ?? "" };
    case "group":
      return { ...base, type: "group", label: node.label };
    default:
      return null;
  }
}

// ── Colors ────────────────────────────────────────────────────────────────

/** JSON Canvas's six presets as theme tokens, so they follow light and dark. */
const PRESET_COLORS: Record<string, string> = {
  "1": "var(--destructive)",
  "2": "var(--color-brand-yellow)",
  "3": "var(--warning)",
  "4": "var(--success)",
  "5": "var(--info)",
  "6": "var(--primary)",
};

export const CARD_COLOR_CHOICES = ["1", "2", "3", "4", "5", "6"] as const;

export function isHexColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

export function cardColor(color: string | undefined): string | null {
  if (!color) return null;
  if (PRESET_COLORS[color]) return PRESET_COLORS[color];
  return isHexColor(color) ? color : null;
}

/** The card's accent as a CSS variable, for its border and tint. */
export function cardColorStyle(color: string | undefined): CSSProperties | undefined {
  const accent = cardColor(color);
  return accent ? ({ "--card-accent": accent } as CSSProperties) : undefined;
}

/** The canvas's dot grid, shared by the editor and the snapshot view. */
export const GRID_GAP = 24;
export const GRID_DOT = "color-mix(in srgb, var(--muted-foreground) 22%, transparent)";

/** Connection stroke width; a selected connection draws one pixel wider. */
export const EDGE_WIDTH = 1.75;

/** Shared card chrome: a surface tinted by its accent, contained so it lays out alone. */
export const CARD_SURFACE =
  "h-full w-full overflow-hidden rounded-md border bg-card text-card-foreground [contain:layout_paint_style] border-[color-mix(in_srgb,var(--card-accent,var(--border))_70%,transparent)] bg-[color-mix(in_srgb,var(--card-accent,var(--card))_8%,var(--card))]";

/**
 * A group's box: tinted and outlined in its accent, and not clipped, since
 * its label sits above it.
 */
export const GROUP_SURFACE =
  "relative h-full w-full rounded-lg border-2 border-[color-mix(in_srgb,var(--card-accent,var(--muted-foreground))_45%,transparent)] bg-[color-mix(in_srgb,var(--card-accent,var(--muted-foreground))_7%,transparent)]";

// ── Text ──────────────────────────────────────────────────────────────────

/** What a wikilink on this canvas can land on: a file or image card with that path. */
interface CanvasLinks {
  resolve: (target: string) => { cardId: string; imageUrl?: string } | null;
  focus: (cardId: string) => void;
}

export const CanvasLinksContext = createContext<CanvasLinks | null>(null);

/**
 * The link targets on a canvas. Rebuilt only when a file or image card's
 * path changes, so moving or typing into cards doesn't re-render every chip.
 */
export function useCanvasLinks(
  cards: Iterable<CanvasCard>,
  attachments: CanvasAttachmentMap,
  focus: (cardId: string) => void,
): CanvasLinks {
  const targets: { id: string; path: string; imageUrl?: string }[] = [];
  for (const card of cards) {
    if (card.type !== "file" && card.type !== "image") continue;
    const attachment = card.attachmentId ? attachments[card.attachmentId] : undefined;
    const path = attachment?.path ?? card.file;
    if (!path) continue;
    targets.push({
      id: card.id,
      path,
      imageUrl: attachment && !attachment.quarantined ? (attachment.url ?? undefined) : undefined,
    });
  }
  const key = JSON.stringify(targets);
  return useMemo(() => {
    const list = JSON.parse(key) as typeof targets;
    return {
      resolve: (target) => {
        const hit = list.find((t) => wikilinkMatches(target, t.path));
        return hit ? { cardId: hit.id, imageUrl: hit.imageUrl } : null;
      },
      focus,
    };
  }, [key, focus]);
}

const CHIP = "inline-flex max-w-full items-center rounded-sm px-1 font-medium align-baseline";

/**
 * A `[[link]]` as a chip: it focuses the card it names when that card is on
 * the canvas, and is muted and inert otherwise. `![[image.png]]` shows the
 * image when the canvas holds it.
 */
function WikilinkChip({ link }: { link: Wikilink }) {
  const links = use(CanvasLinksContext);
  const hit = links?.resolve(link.target);
  const label = wikilinkLabel(link);

  if (link.embed && hit?.imageUrl) {
    return <img src={hit.imageUrl} alt={label} loading="lazy" draggable={false} />;
  }
  if (!hit || !links) {
    return (
      <SimpleTooltip content={`${link.target} isn't on this canvas`}>
        <span className={cn(CHIP, "bg-muted text-muted-foreground")}>{label}</span>
      </SimpleTooltip>
    );
  }
  return (
    <button
      type="button"
      className={cn(
        CHIP,
        "nodrag cursor-pointer bg-primary/10 text-primary hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      )}
      onClick={(e) => {
        e.stopPropagation();
        links.focus(hit.cardId);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {label}
    </button>
  );
}

const renderWikilink = (link: Wikilink) => <WikilinkChip link={link} />;

/** Headings, lists, quotes, code, tables, emphasis, links or embeds: anything that lays out bigger than plain text. */
const MARKDOWN = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|\|)|\*\*|__|`|\[\[|\]\(/m;

export function hasMarkdown(text: string): boolean {
  return MARKDOWN.test(text);
}

const TextCardBody = memo(function TextCardBody({
  text,
  detail,
  scrollable = false,
}: {
  text: string;
  detail: CanvasDetailLevel;
  /** A selected card scrolls its text; the wheel then scrolls it rather than the canvas. */
  scrollable?: boolean;
}) {
  if (detail === "far") {
    return (
      <Text as="span" size="lg" bold className="line-clamp-3 p-3">
        {firstLine(text)}
      </Text>
    );
  }
  if (!text.trim()) {
    return (
      <Text as="span" size="xs" variant="muted" className="p-3 italic">
        Empty card
      </Text>
    );
  }
  return (
    <MarkedText
      className={cn(
        "h-full p-3 text-sm/relaxed",
        scrollable ? "nowheel overflow-y-auto overscroll-contain" : "overflow-hidden",
      )}
      wikilink={renderWikilink}
    >
      {text}
    </MarkedText>
  );
});

// ── Link, file, image ─────────────────────────────────────────────────────

function LinkCardBody({ url }: { url: string }) {
  const host = externalUrlHost(url);
  return (
    <div className="flex h-full flex-col justify-center gap-1 p-3">
      <span className="flex items-center gap-1.5">
        <HugeiconsIcon icon={Link01Icon} size={14} className="shrink-0 text-muted-foreground" />
        <Text as="span" size="sm" bold ellipsis>
          {host ?? "Link"}
        </Text>
      </span>
      {host ? (
        <a
          href={url}
          target="_blank"
          rel="nofollow ugc noopener noreferrer"
          className="nodrag truncate text-xs text-primary underline-offset-2 hover:underline"
        >
          {url}
        </a>
      ) : (
        <Text as="span" size="xs" variant="muted" ellipsis>
          {url || "No address"}
        </Text>
      )}
    </div>
  );
}

function FileCardBody({ file, subpath }: { file: string; subpath?: string }) {
  return (
    <div className="flex h-full flex-col justify-center gap-1 p-3">
      <span className="flex items-center gap-1.5">
        <HugeiconsIcon icon={File01Icon} size={14} className="shrink-0 text-muted-foreground" />
        <Text as="span" size="sm" bold ellipsis>
          {basename(file) || "File"}
          {subpath ?? ""}
        </Text>
      </span>
      <Text as="span" size="xs" variant="muted" ellipsis>
        {file} · not included
      </Text>
    </div>
  );
}

function ImageCardBody({
  attachmentId,
  attachments,
  detail,
}: {
  attachmentId: string | undefined;
  attachments: CanvasAttachmentMap;
  detail: CanvasDetailLevel;
}) {
  const attachment = attachmentId ? attachments[attachmentId] : undefined;
  if (detail === "far") return <div className="h-full w-full bg-muted/40" />;
  if (!attachment?.url) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center text-muted-foreground">
        <HugeiconsIcon icon={ImageNotFound01Icon} size={20} />
        <Text as="span" size="xs" variant="muted">
          {attachment?.quarantined ? "Hidden while staff review it" : "Image unavailable"}
        </Text>
      </div>
    );
  }
  return (
    <img
      src={attachment.url}
      alt={basename(attachment.path)}
      loading="lazy"
      draggable={false}
      className="h-full w-full object-contain"
    />
  );
}

// ── Entity cards ──────────────────────────────────────────────────────────

const ENTITY_ICON: Record<EntityKind, IconSvgElement> = {
  jam: Calendar03Icon,
  team: UserGroupIcon,
  profile: UserIcon,
  "forum-post": Message01Icon,
  game: File01Icon,
};

const ENTITY_LABEL: Record<EntityKind, string> = {
  jam: "JAM",
  team: "TEAM",
  profile: "MEMBER",
  "forum-post": "FORUM",
  game: "GAME",
};

const loadEntity = createBatchLoader<CanvasEntity>(
  async (keys) => {
    const refs = keys.map((key) => {
      const [kind, ...rest] = key.split(":");
      return { kind: kind as EntityKind, id: rest.join(":") };
    });
    const found = await client.getCanvasEntities({ refs });
    return found.filter((e): e is CanvasEntity => e != null);
  },
  (entity) => `${entity.kind}:${entity.id}`,
);

function useCanvasEntity(entity: EntityRef | undefined, enabled = true) {
  return useQuery({
    queryKey: ["canvas-entity", entity?.kind, entity?.id],
    queryFn: () => loadEntity(`${entity!.kind}:${entity!.id}`),
    enabled: enabled && entity != null,
    staleTime: STALE.listing,
  });
}

// The card's padding, its kind line, and room for a two-line title and a
// two-line subtitle: what's left is what the art may take.
const ENTITY_PAD = 24;
const ENTITY_HEADER = 24;
const ENTITY_TEXT = 72;
const MIN_ART = 56;

type EntityArtLayout =
  | { mode: "top"; height: number }
  | { mode: "side"; width: number }
  | { mode: "none" };

/**
 * Where a live card's art goes at this size. A banner's box sits on top
 * while it would stay between 1.25:1 and 3:1, beside the text when the card
 * is too wide or short for that, and drops out when there's no room for it.
 * The banner is contained in its box, never cropped. An avatar sits beside
 * the name, or on top in a narrow, tall card.
 */
export function entityArtLayout(w: number, h: number, avatar: boolean): EntityArtLayout {
  const innerW = w - ENTITY_PAD;
  const innerH = h - ENTITY_PAD - ENTITY_HEADER;
  const topRoom = innerH - ENTITY_TEXT - 8;
  if (avatar) {
    if (innerW < 220 && topRoom >= 96) {
      return { mode: "top", height: Math.min(topRoom, innerW * 0.6, 128) };
    }
    const size = Math.min(96, innerH, innerW * 0.3);
    return size >= 32 ? { mode: "side", width: size } : { mode: "none" };
  }
  if (topRoom >= MIN_ART && innerW / topRoom <= 3) {
    return { mode: "top", height: Math.min(topRoom, innerW / 1.25) };
  }
  const side = Math.min(innerW * 0.45, (h - ENTITY_PAD) * 1.6);
  return side >= MIN_ART && h - ENTITY_PAD >= 40 ? { mode: "side", width: side } : { mode: "none" };
}

interface CardSizeLimits {
  minWidth: number;
  minHeight: number;
  /** Width over height, for cards whose layout breaks when stretched too far. */
  ratio?: [min: number, max: number];
}

/** How small, and how stretched, a card may be resized before its content is cut off. */
export function cardSizeLimits(card: Pick<CanvasCard, "type" | "text">): CardSizeLimits {
  switch (card.type) {
    case "text":
      return card.text && hasMarkdown(card.text)
        ? { minWidth: 200, minHeight: 100 }
        : { minWidth: 120, minHeight: 60 };
    case "entity":
      return {
        minWidth: 200,
        minHeight: ENTITY_PAD + ENTITY_HEADER + ENTITY_TEXT,
        ratio: [0.5, 4],
      };
    case "group":
      return { minWidth: 120, minHeight: 80 };
    case "image":
      return { minWidth: 60, minHeight: 40 };
    default:
      return { minWidth: 120, minHeight: 60 };
  }
}

/**
 * Whether one resize step stays inside the ratio range, or at least moves
 * toward it: a card saved outside the range (from Obsidian, say) can always
 * be brought back.
 */
export function ratioStepAllowed(
  ratio: [number, number] | undefined,
  from: { w: number; h: number },
  to: { w: number; h: number },
): boolean {
  if (!ratio) return true;
  const [min, max] = ratio;
  const distance = (r: number) => (r < min ? min - r : r > max ? r - max : 0);
  const next = distance(to.w / to.h);
  return next === 0 || next < distance(from.w / from.h);
}

/**
 * A live card's subtitle, given whatever height is left under the title,
 * clamped to the whole lines that fit there with an ellipsis on the last.
 */
function FittedSubtitle({ children }: { children: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState(2);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 16;
    const observer = new ResizeObserver(() =>
      setLines(Math.max(1, Math.floor(el.clientHeight / lineHeight))),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={box} className="min-h-4 flex-1 overflow-hidden text-xs">
      <Text
        as="span"
        size="xs"
        variant="muted"
        className="line-clamp-2 break-words"
        style={{ WebkitLineClamp: lines }}
      >
        {children}
      </Text>
    </div>
  );
}

function EntityCardBody({
  entity,
  detail,
  w,
  h,
}: {
  entity: EntityRef | undefined;
  detail: CanvasDetailLevel;
  w: number;
  h: number;
}) {
  const { data, isPending } = useCanvasEntity(entity, detail !== "far");
  const icon = entity ? ENTITY_ICON[entity.kind] : Link01Icon;

  if (detail === "far" || !entity) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <HugeiconsIcon icon={icon} size={32} />
      </div>
    );
  }

  const header = (
    <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
      <HugeiconsIcon icon={icon} size={13} />
      <MicroLabel as="span">{ENTITY_LABEL[entity.kind]}</MicroLabel>
    </span>
  );

  if (!data) {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        {header}
        <Text as="span" size="xs" variant="muted" className={cn(isPending && "animate-pulse")}>
          {isPending ? "Loading…" : "Not available"}
        </Text>
      </div>
    );
  }

  const avatar = entity.kind === "team" || entity.kind === "profile";
  const layout =
    data.imageUrl || avatar ? entityArtLayout(w, h, avatar) : { mode: "none" as const };
  // Mid zoom keeps the art's space but skips loading it.
  const showImage = detail === "near";

  const art =
    layout.mode === "none" ? null : avatar ? (
      <UserAvatar
        avatarUrl={showImage ? data.imageUrl : null}
        username={data.title}
        size={Math.round(layout.mode === "top" ? layout.height : layout.width)}
        className={cn("shrink-0", layout.mode === "top" && "self-center")}
      />
    ) : (
      <div
        className="shrink-0 overflow-hidden rounded-md bg-muted"
        style={
          layout.mode === "top"
            ? { height: layout.height, width: "100%" }
            : { width: layout.width, height: "100%" }
        }
      >
        {showImage && data.imageUrl ? (
          <img
            src={data.imageUrl}
            alt=""
            loading="lazy"
            draggable={false}
            className="h-full w-full object-contain"
          />
        ) : null}
      </div>
    );

  const text = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 self-stretch">
      <a
        href={data.href}
        className="nodrag line-clamp-2 shrink-0 text-sm font-bold break-words hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {data.title}
      </a>
      {data.subtitle ? <FittedSubtitle>{data.subtitle}</FittedSubtitle> : null}
    </div>
  );

  if (layout.mode === "side") {
    return (
      <div className="flex h-full min-h-0 gap-3 p-3">
        {avatar ? null : art}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          {header}
          {avatar ? (
            <div className="flex min-h-0 min-w-0 flex-1 items-start gap-3">
              {art}
              {text}
            </div>
          ) : (
            text
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      {header}
      {art}
      {text}
    </div>
  );
}

/** Where a group's label, or its rename field, sits: just above the box's top-left. */
export const GROUP_LABEL_SLOT = "absolute bottom-full left-0 mb-1.5 max-w-full";

export function GroupLabel({ label }: { label?: string }) {
  if (!label) return null;
  return (
    <span
      data-group-label=""
      className={cn(
        GROUP_LABEL_SLOT,
        "truncate px-0.5 text-base leading-tight font-bold text-[color-mix(in_srgb,var(--card-accent,var(--foreground))_80%,var(--foreground))]",
      )}
    >
      {label}
    </span>
  );
}

/** A non-group card's body, by type. */
export function CardBody({
  card,
  detail,
  attachments,
  size,
  scrollable,
}: {
  card: CanvasCard;
  detail: CanvasDetailLevel;
  attachments: CanvasAttachmentMap;
  /** The size on screen, when it runs ahead of the saved one (mid-resize). */
  size?: { w: number; h: number };
  /** Text scrolls inside the card (while it's selected). */
  scrollable?: boolean;
}) {
  if (detail === "blocks") return null;
  switch (card.type) {
    case "text":
      return <TextCardBody text={card.text ?? ""} detail={detail} scrollable={scrollable} />;
    case "link":
      return detail === "far" ? null : <LinkCardBody url={card.url ?? ""} />;
    case "file":
      return detail === "far" ? null : (
        <FileCardBody file={card.file ?? ""} subpath={card.subpath} />
      );
    case "image":
      return (
        <ImageCardBody attachmentId={card.attachmentId} attachments={attachments} detail={detail} />
      );
    case "entity":
      return (
        <EntityCardBody
          entity={card.entity}
          detail={detail}
          w={size?.w ?? card.w}
          h={size?.h ?? card.h}
        />
      );
    case "group":
      return null;
  }
}
