import DOMPurify from "dompurify";
import { useMemo } from "react";

import { useCensorFn } from "@/lib/hooks/use-censored";
import { useIsHydrated } from "@/lib/hooks/use-is-hydrated";
import { cn } from "@/lib/utils";

const PROSE_CLASSES = [
  "text-sm/relaxed text-foreground",
  "[&_em]:italic [&_strong]:font-bold",
  "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-accent/80",
  "[&_code]:rounded [&_code]:bg-card [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs",
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-card [&_pre]:p-3 [&_pre]:text-xs",
  "[&_pre_code]:border-none [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:mb-1",
  "[&_p]:mb-2 [&_p:last-child]:mb-0",
  "[&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-bold [&_h1:first-child]:mt-0",
  "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_h2:first-child]:mt-0",
  "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-bold",
  "[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-sm [&_h4]:font-bold",
  "[&_h5]:mt-3 [&_h5]:mb-1 [&_h5]:text-sm [&_h5]:font-semibold",
  "[&_h6]:mt-3 [&_h6]:mb-1 [&_h6]:text-xs [&_h6]:font-semibold [&_h6]:uppercase [&_h6]:tracking-wide",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_blockquote]:italic",
  "[&_hr]:my-6 [&_hr]:border-border",
  // No width/height survives the attribute strip, so a tall source image
  // would otherwise render at its natural size and own the viewport.
  "[&_img]:my-3 [&_img]:h-auto [&_img]:max-h-96 [&_img]:max-w-full [&_img]:rounded",
  "[&_figure]:my-3",
  "[&_figcaption]:mt-1 [&_figcaption]:text-xs [&_figcaption]:text-muted-foreground",
  // Structure recovered from the host's class names — see
  // `classifyClassName`. These are the shapes itch's own page had; only
  // the palette is ours.
  "[&_[data-align=center]]:text-center [&_[data-align=center]_img]:mx-auto",
  "[&_[data-align=right]]:text-right [&_[data-align=justify]]:text-justify",
  "[&_[data-slot=rich-html-section]]:my-6 [&_[data-slot=rich-html-section]]:rounded-lg [&_[data-slot=rich-html-section]]:border [&_[data-slot=rich-html-section]]:border-border/60 [&_[data-slot=rich-html-section]]:bg-card/20 [&_[data-slot=rich-html-section]]:p-4 sm:[&_[data-slot=rich-html-section]]:p-6",
  "[&_[data-slot=rich-html-card]]:rounded-lg [&_[data-slot=rich-html-card]]:border [&_[data-slot=rich-html-card]]:border-border [&_[data-slot=rich-html-card]]:bg-card/40 [&_[data-slot=rich-html-card]]:p-4",
  "[&_[data-row=split]]:flex [&_[data-row=split]]:items-baseline [&_[data-row=split]]:justify-between [&_[data-row=split]]:gap-4",
  "[&_[data-columns]]:my-3 [&_[data-columns]]:grid [&_[data-columns]]:gap-4 sm:[&_[data-columns]]:grid-cols-2 [&_[data-columns]>*]:min-w-0",
  "[&_[data-slot=rich-html-grid]]:my-3 [&_[data-slot=rich-html-grid]]:grid [&_[data-slot=rich-html-grid]]:grid-cols-2 [&_[data-slot=rich-html-grid]]:gap-3 sm:[&_[data-slot=rich-html-grid]]:grid-cols-3 [&_[data-slot=rich-html-grid]>*]:min-w-0",
  "[&_[data-slot=rich-html-button]]:inline-flex [&_[data-slot=rich-html-button]]:items-center [&_[data-slot=rich-html-button]]:rounded-md [&_[data-slot=rich-html-button]]:border [&_[data-slot=rich-html-button]]:border-border [&_[data-slot=rich-html-button]]:bg-card [&_[data-slot=rich-html-button]]:px-3 [&_[data-slot=rich-html-button]]:py-1.5 [&_[data-slot=rich-html-button]]:font-semibold [&_[data-slot=rich-html-button]]:no-underline",
  "[&_[data-slot=rich-html-table]]:my-3 [&_[data-slot=rich-html-table]]:overflow-x-auto",
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-xs",
  "[&_th]:border [&_th]:border-border [&_th]:bg-card [&_th]:p-2 [&_th]:text-left [&_th]:font-semibold",
  "[&_td]:border [&_td]:border-border [&_td]:p-2 [&_td]:align-top",
  "[&_details]:my-2 [&_details]:rounded-md [&_details]:border [&_details]:border-border [&_details]:bg-card/40 [&_details]:p-3",
  "[&_summary]:cursor-pointer [&_summary]:font-semibold [&_summary]:marker:text-muted-foreground",
  "[&_details[open]>summary]:mb-2",
  // Hosts nest a whole FAQ inside one disclosure. Carding every level
  // turns that into a wall of identical boxes, so only the outermost
  // reads as a card and the ones inside it become indented lines.
  "[&_details_details]:my-1 [&_details_details]:rounded-none [&_details_details]:border-0 [&_details_details]:border-l [&_details_details]:border-border/60 [&_details_details]:bg-transparent [&_details_details]:py-1 [&_details_details]:pr-0 [&_details_details]:pl-3",
  // A list whose every item leads with an image is a card grid on itch —
  // an icon beside its rule. Rendered as a bulleted list it becomes a
  // column of oversized GIFs with orphaned markers, so `normalizeBody`
  // tags those lists and they get the two-up treatment instead.
  "[&_[data-slot=rich-html-media-list]]:my-3 [&_[data-slot=rich-html-media-list]]:grid [&_[data-slot=rich-html-media-list]]:list-none [&_[data-slot=rich-html-media-list]]:gap-2 [&_[data-slot=rich-html-media-list]]:pl-0",
  "sm:[&_[data-slot=rich-html-media-list]]:grid-cols-2",
  "[&_[data-slot=rich-html-media-list]>li]:mb-0 [&_[data-slot=rich-html-media-list]>li]:flex [&_[data-slot=rich-html-media-list]>li]:items-start [&_[data-slot=rich-html-media-list]>li]:gap-3 [&_[data-slot=rich-html-media-list]>li]:rounded-md [&_[data-slot=rich-html-media-list]>li]:border [&_[data-slot=rich-html-media-list]>li]:border-border [&_[data-slot=rich-html-media-list]>li]:bg-card/40 [&_[data-slot=rich-html-media-list]>li]:p-3",
  "[&_[data-slot=rich-html-media-list]_img]:my-0 [&_[data-slot=rich-html-media-list]_img]:w-14 [&_[data-slot=rich-html-media-list]_img]:shrink-0",
  "[&_[data-slot=rich-html-media-list]_h3]:mt-0",
  "[&_[data-slot=rich-html-gallery]]:my-3 [&_[data-slot=rich-html-gallery]]:flex [&_[data-slot=rich-html-gallery]]:flex-wrap [&_[data-slot=rich-html-gallery]]:gap-2",
  "[&_[data-slot=rich-html-gallery]_img]:my-0 [&_[data-slot=rich-html-gallery]_img]:max-h-40 [&_[data-slot=rich-html-gallery]_img]:w-auto",
  // Capped: our content column is wider than itch's, and a 16:9 embed
  // stretched across all of it is 650px of trailer. Widgets keep the box
  // their host sized them for — `normalizeBody` writes that inline.
  "[&_iframe]:my-3 [&_iframe]:max-w-full [&_iframe]:rounded-md [&_iframe]:border [&_iframe]:border-border",
  "[&_iframe[data-embed=video]]:aspect-video [&_iframe[data-embed=video]]:w-full [&_iframe[data-embed=video]]:max-w-3xl",
].join(" ");

/**
 * Presentation the host wrote for *itch's* page, not ours.
 *
 * An `id` scraped off itch can collide with our own elements, and inline
 * `style` plus the legacy presentational attributes carry colors picked
 * against the host's background — which is how you get white text on our
 * card. `class` is deliberately *not* here: `classifyElement` reads it
 * for structure first, and the attribute is dropped on the way out.
 */
const HOST_PRESENTATION_ATTRS = [
  "id",
  "style",
  "align",
  "valign",
  "background",
  "bgcolor",
  "border",
  "color",
  "face",
  "hspace",
  "vspace",
];

/**
 * Hosts whose embeds we re-frame. DOMPurify's html profile drops
 * `<iframe>` outright, which silently gutted the ~2.7k jam bodies that
 * embed a trailer or a Discord widget — the two things a jam page most
 * often *is*. Framing an arbitrary third-party origin inside our page is
 * the thing worth refusing, not framing at all, so the tag comes back
 * with the src held to this list (chosen from what the corpus actually
 * embeds; YouTube and Discord alone are ~90% of it).
 */
const EMBED_HOSTS = new Set([
  "bandcamp.com",
  "clips.twitch.tv",
  "discord.com",
  "discordapp.com",
  "e.widgetbot.io",
  "itch.io",
  "open.spotify.com",
  "player.twitch.tv",
  "player.vimeo.com",
  "w.soundcloud.com",
  "www.itch.io",
  "www.youtube-nocookie.com",
  "www.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "youtube.com",
]);

/** Subdomain embeds worth keeping (`html-classic.itch.zone`-style widget
 * hosts, artist subdomains on Bandcamp). */
const EMBED_HOST_SUFFIXES = [".itch.io", ".itch.zone", ".bandcamp.com"];

/**
 * Whether an `<iframe src>` from a scraped body may be framed.
 *
 * Only absolute (or protocol-relative) http(s) URLs on `EMBED_HOSTS`
 * qualify. A relative src is rejected rather than resolved: resolving it
 * would frame *our* origin, which is the one thing a jam body has no
 * business doing.
 */
export function isAllowedEmbedSrc(src: string | null | undefined): boolean {
  if (!src || !/^(https?:)?\/\//i.test(src.trim())) return false;
  let url: URL;
  try {
    url = new URL(src.trim(), "https://itch.io");
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  return EMBED_HOSTS.has(host) || EMBED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** Embeds that are a player, and so want 16:9 rather than the box the
 * host wrote for itch's narrower column. */
const VIDEO_EMBED_HOSTS = [
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "vimeo.com",
  "twitch.tv",
];

export function isVideoEmbed(src: string | null | undefined): boolean {
  if (!isAllowedEmbedSrc(src)) return false;
  const host = new URL((src as string).trim(), "https://itch.io").hostname.toLowerCase();
  return VIDEO_EMBED_HOSTS.some((base) => host === base || host.endsWith(`.${base}`));
}

export type ClassHint = {
  align?: "center" | "right" | "justify";
  hidden?: boolean;
  kind?: "card" | "grid" | "section" | "column" | "button";
};

/** Word-boundary test against a class list, where hosts use `-` and `_`
 * as freely as spaces. `col` must not match `color`, `box` must not match
 * `boxing`. */
function hasWord(className: string, word: string): boolean {
  return new RegExp(`(^|[\\s\\-_])${word}([\\s\\-_]|$)`, "i").test(className);
}

function hasAnyWord(className: string, words: string[]): boolean {
  return words.some((word) => hasWord(className, word));
}

/**
 * What a host's class name still tells us once its stylesheet is gone.
 *
 * The exact tokens are worthless as a lookup — the corpus has 1,158
 * distinct ones and 641 appear on a single jam, because every host names
 * classes for their own jam (`custom-prize-card`, `custom-sponsor-grid`).
 * The *vocabulary* is not: hosts reach for the same handful of words for
 * the same handful of layouts, so matching on `card`/`column`/`grid`/
 * `section` recovers the intent without importing a line of their CSS.
 *
 * Alignment is the exception and the one true signal: `text-center` and
 * friends come from itch's own editor rather than the host, and a third
 * of all bodies carry them.
 */
export function classifyClassName(className: string, tagName?: string): ClassHint {
  const cls = className.trim().toLowerCase();
  if (!cls) return {};
  const hint: ClassHint = {};

  if (hasAnyWord(cls, ["hidden", "hide"])) return { hidden: true };

  if (hasWord(cls, "text-center") || hasAnyWord(cls, ["center", "centre", "centered"])) {
    hint.align = "center";
  } else if (hasWord(cls, "text-right")) {
    hint.align = "right";
  } else if (hasWord(cls, "text-justify")) {
    hint.align = "justify";
  }

  const isHeading = /^h[1-6]$/i.test(tagName ?? "");
  // A host's section header is centered and oversized on their page far
  // more often than not — `custom-header`, `custom_jam_title`.
  if (isHeading && !hint.align && hasAnyWord(cls, ["header", "title", "heading"])) {
    hint.align = "center";
  }

  if (tagName?.toUpperCase() === "A" && hasAnyWord(cls, ["button", "btn"])) {
    hint.kind = "button";
  } else if (hasAnyWord(cls, ["card", "box", "panel", "tile", "item"])) {
    // Checked before `grid`, so a `sponsor-grid-item` is a cell and not
    // a second grid inside its own parent.
    hint.kind = "card";
  } else if (hasWord(cls, "grid")) {
    hint.kind = "grid";
  } else if (hasAnyWord(cls, ["column", "columns", "col", "cols"])) {
    hint.kind = "column";
  } else if (hasWord(cls, "section")) {
    hint.kind = "section";
  }

  return hint;
}

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    // `iframe` is not in the html profile; `normalizeEmbeds` holds the
    // ones that survive to `EMBED_HOSTS` immediately after.
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allow", "allowfullscreen"],
    FORBID_ATTR: HOST_PRESENTATION_ATTRS,
  });
}

/**
 * Second pass over already-sanitized markup, for the structure a class
 * list can't reach.
 *
 * *Embeds:* every `<iframe>` is checked against `isAllowedEmbedSrc`.
 * One off the list becomes a plain link to its source rather than
 * vanishing — a jam that embedded its rules doc still points at it.
 *
 * *Tables:* wrapped in their own scroll container. A host's 8-column
 * table is sized for itch's wide content column, and without this it
 * pushes the whole page sideways on a phone.
 *
 * *Spacers:* itch's editor litters bodies with `<p><br></p>`, which is a
 * no-op against the host's own margins and a ragged hole against ours.
 *
 * *Media lists:* see the `rich-html-media-list` note above.
 *
 * *Summary headings:* a heading nested in a `<summary>` is a block box,
 * which drops the label onto the line below the disclosure triangle.
 *
 * *Censoring:* the viewer's profanity preference is applied to text nodes
 * here rather than to the string, so nothing in an `href` or a `src` can
 * be rewritten into a broken link.
 *
 * Runs on the sanitized string, so nothing here can reintroduce markup
 * DOMPurify rejected: the parse only sees what already survived, and the
 * one attribute we write (`href`) is re-checked for scheme first.
 */
function normalizeBody(html: string, censor: (text: string) => string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Class names are read for intent, then dropped. They are never left on
  // the element: our own utilities would collide with a host's `grid` or
  // `hidden`, and the attribute means nothing to a reader.
  const columnParents = new Set<Element>();
  for (const el of doc.querySelectorAll<HTMLElement>("[class]")) {
    const hint = classifyClassName(el.getAttribute("class") ?? "", el.tagName);
    el.removeAttribute("class");

    if (hint.hidden) {
      // The host hid it on their page; showing it here would surface a
      // draft prize table or a stale sponsor.
      el.remove();
      continue;
    }
    if (hint.align) el.setAttribute("data-align", hint.align);
    switch (hint.kind) {
      case "column":
        // The marker sits on the columns, but the layout belongs to what
        // holds them — `custom-prize-section` wrapping two
        // `custom-prize-column`s is the shape, on itch and here.
        if (el.parentElement) columnParents.add(el.parentElement);
        break;
      case "card":
        el.dataset.slot = "rich-html-card";
        break;
      case "grid":
        el.dataset.slot = "rich-html-grid";
        break;
      case "section":
        el.dataset.slot = "rich-html-section";
        break;
      case "button":
        el.dataset.slot = "rich-html-button";
        break;
      default:
        break;
    }
  }
  for (const card of doc.querySelectorAll("[data-slot=rich-html-card]")) {
    // "1st Place … $1,000" — a label with its value bolded at the end,
    // and no block content between them. Hosts lay these out as a split
    // row (prize tiers, rating criteria, sponsor tiers), and read as a
    // ragged run-on sentence without it.
    const last = card.lastElementChild;
    const isValue = last && ["STRONG", "B", "EM"].includes(last.tagName);
    const hasBlockContent = card.querySelector(
      "p, div, ul, ol, table, img, h1, h2, h3, h4, h5, h6",
    );
    // Everything that isn't the value, since the label is as often a
    // link as it is a bare text node.
    const label = [...card.childNodes]
      .filter((node) => node !== last)
      .map((node) => node.textContent ?? "")
      .join("")
      .trim();
    if (isValue && !hasBlockContent && label) card.setAttribute("data-row", "split");
  }

  for (const parent of columnParents) {
    // Separate from `data-slot`: a container is often a panel *and* a
    // two-up, and those are different declarations.
    if (parent.children.length > 1) parent.setAttribute("data-columns", "");
  }

  // Outbound links in a scraped body are third-party links we did not
  // author — what `nofollow ugc` is for. Same-origin links stay crawlable;
  // `//host/path` is protocol-relative, not same-origin.
  for (const link of doc.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("#") || (href.startsWith("/") && !href.startsWith("//"))) continue;
    link.setAttribute("rel", "nofollow ugc noopener noreferrer");
    link.setAttribute("target", "_blank");
  }

  // Bodies written years ago still say `http://www.youtube.com/embed/…`,
  // and an http subresource on an https page is blocked outright — the
  // embed or image is simply missing, with only a console warning.
  for (const el of doc.querySelectorAll("img[src], iframe[src], source[src]")) {
    const src = el.getAttribute("src") ?? "";
    if (src.startsWith("http://")) el.setAttribute("src", `https://${src.slice(7)}`);
  }

  // Sizing attributes are a hint on an embed and noise on an image,
  // where our own cap is what should win.
  for (const image of doc.querySelectorAll("img[width], img[height]")) {
    image.removeAttribute("width");
    image.removeAttribute("height");
  }

  for (const frame of doc.querySelectorAll("iframe")) {
    const src = frame.getAttribute("src");
    if (!isAllowedEmbedSrc(src)) {
      frame.replaceWith(...embedFallback(doc, src));
      continue;
    }
    frame.setAttribute("loading", "lazy");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");

    // A trailer wants to be 16:9 and as wide as the column allows. A
    // Discord widget or a track player wants the box its host asked for
    // — stretched to 16:9 it becomes a screen of empty member list.
    const width = Number.parseInt(frame.getAttribute("width") ?? "", 10);
    const height = Number.parseInt(frame.getAttribute("height") ?? "", 10);
    frame.removeAttribute("width");
    frame.removeAttribute("height");
    if (isVideoEmbed(src)) {
      frame.dataset.embed = "video";
      continue;
    }
    frame.dataset.embed = "widget";
    const maxWidth = Number.isFinite(width) && width > 0 ? `${width}px` : "100%";
    const boxHeight = Number.isFinite(height) && height > 0 ? `${height}px` : "480px";
    frame.setAttribute("style", `width:min(100%, ${maxWidth});height:${boxHeight}`);
  }

  // Copy beside a widget. The class names for this one carry no hint
  // (`custom-discord-copy` + `custom-discord-widget`), but the shape is
  // unambiguous: two children, one of them nothing but a narrow embed.
  // Stacked, the prose gets stranded above a 350px panel. Runs after the
  // embed pass, which is what decides `widget` from `video`.
  for (const el of doc.querySelectorAll("div, section")) {
    if (el.hasAttribute("data-columns") || el.children.length !== 2) continue;
    const frames = el.querySelectorAll("iframe");
    if (frames.length !== 1 || frames[0].dataset.embed !== "widget") continue;
    const widgetSide = [...el.children].find((child) => child.contains(frames[0]));
    const copySide = [...el.children].find((child) => child !== widgetSide);
    if (!widgetSide || !copySide?.textContent?.trim()) continue;
    if (widgetSide.textContent?.trim()) continue; // the embed side is prose too
    el.setAttribute("data-columns", "");
  }

  for (const table of doc.querySelectorAll("table")) {
    // A table already inside a wrapper (nested tables, or a second pass
    // over the same body) must not be wrapped again.
    if (table.parentElement?.dataset.slot === "rich-html-table") continue;
    const scroller = doc.createElement("div");
    scroller.dataset.slot = "rich-html-table";
    table.replaceWith(scroller);
    scroller.append(table);
  }

  for (const p of doc.querySelectorAll("p")) {
    if (!p.textContent?.trim() && !p.querySelector("img, iframe, video, audio")) p.remove();
  }

  for (const list of doc.querySelectorAll("ul")) {
    const items = [...list.children].filter((el) => el.tagName === "LI");
    // Every item, not most: a mixed list is prose with an illustration in
    // it, and carding that reads as a formatting bug.
    if (items.length < 2 || !items.every((li) => li.querySelector("img"))) continue;
    list.dataset.slot = "rich-html-media-list";
    // The icon column only lines up if the image is the item's own first
    // child. Hosts nest it inside the text wrapper as often as not, and
    // one card out of six stacking instead is exactly the kind of ragged
    // edge that reads as broken.
    for (const li of items) {
      const icon = li.querySelector("img");
      if (icon && icon.parentElement !== li) li.prepend(icon);
    }
  }

  // A bare run of images is a gallery on itch — asset packs, palette
  // swaps, sponsor logos, laid out inline. Preflight makes `img` a block,
  // so left alone they become a one-per-screen column.
  for (const el of doc.querySelectorAll<HTMLElement>("div, p, span, section")) {
    const children = [...el.children];
    if (children.length < 3 || !children.every((child) => child.tagName === "IMG")) continue;
    el.dataset.slot = "rich-html-gallery";
  }

  // Text nodes only, so a host's URL or class-derived data attribute can't
  // be mangled into a broken link by the censor.
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue;
    if (!text) continue;
    const clean = censor(text);
    if (clean !== text) node.nodeValue = clean;
  }

  for (const summary of doc.querySelectorAll("summary")) {
    for (const heading of summary.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
      const inline = doc.createElement("span");
      inline.append(...heading.childNodes);
      heading.replaceWith(inline);
    }
  }

  return doc.body.innerHTML;
}

/** Stand-in for an embed we won't frame: a link when the src is a usable
 * http(s) URL, nothing at all when it isn't. */
function embedFallback(doc: Document, src: string | null): Node[] {
  if (!src || !/^(https?:)?\/\//i.test(src.trim())) return [];
  let url: URL;
  try {
    url = new URL(src.trim(), "https://itch.io");
  } catch {
    return [];
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return [];

  const p = doc.createElement("p");
  const link = doc.createElement("a");
  link.setAttribute("href", url.href);
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", "nofollow ugc noopener noreferrer");
  link.textContent = `Embedded content on ${url.hostname} ↗`;
  p.append(link);
  return [p];
}

interface RichHtmlProps {
  /** Untrusted HTML — sanitized here, never by the caller. */
  html: string;
  className?: string;
}

/**
 * Renders a sanitized HTML string with the same typographic treatment as
 * `MarkedText`, so provider-supplied bodies (scraped jam descriptions)
 * read consistently with the markdown-driven surfaces elsewhere.
 *
 * Lives beside `MarkedText` rather than in the jams folder because the
 * jam detail modal and the jam detail page render the same `contentHtml`,
 * and a second copy of this class list is how those two would drift.
 * Sanitization is inside the component on purpose: there is no way to
 * pass unsanitized HTML through it.
 *
 * **The body is renormalized, not reproduced.** A scraped jam body is
 * markup written against a stylesheet we don't have, so we strip the
 * host's presentation (see `HOST_PRESENTATION_ATTRS`) and style the
 * remaining semantic elements ourselves. The page then reads as ours
 * deliberately, instead of as a broken copy of theirs.
 *
 * **Server render.** DOMPurify needs a real DOM — in Node the module
 * hands back a bare factory whose `sanitize` doesn't exist at all — so
 * the markup can only be sanitized on the client. The server (and the
 * first client render, which has to match it) gets the plain-text
 * reduction of the body instead, and the rich markup swaps in on mount.
 * That keeps the prose in the SSR payload for crawlers and no-JS readers
 * rather than shipping them an empty section, which is the whole point of
 * these pages being real routes.
 */
export function RichHtml({ html, className }: RichHtmlProps) {
  const canSanitize = useIsHydrated();
  const censor = useCensorFn();

  const safe = useMemo(
    () => (canSanitize ? normalizeBody(sanitize(html), censor) : null),
    [canSanitize, html, censor],
  );
  const paragraphs = useMemo(
    () => (safe == null ? htmlToParagraphs(html).map(censor) : []),
    [safe, html, censor],
  );

  if (safe == null) {
    return (
      <div className={cn(PROSE_CLASSES, className)}>
        {paragraphs.map((p, i) => (
          // Index keys: this list is a one-shot pre-hydration rendering of
          // an immutable string, never reordered.
          // biome-ignore lint/suspicious/noArrayIndexKey: static list
          <p key={i}>{p}</p>
        ))}
      </div>
    );
  }

  return (
    <div className={cn(PROSE_CLASSES, className)} dangerouslySetInnerHTML={{ __html: safe }} />
  );
}

/** Elements whose *contents* are not prose and must not survive the
 * text reduction — a regex tag-strip would otherwise turn a script body
 * into visible copy. */
const NON_PROSE_ELEMENTS = /<(script|style|noscript|template|iframe|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Tags that end a line of prose. Everything else is inline. */
const BLOCK_BOUNDARY = /<\/?(p|div|br|li|ul|ol|tr|h[1-6]|blockquote|pre|section|article)\b[^>]*>/gi;

/** Stands in for a block boundary while the tags are being stripped. A
 * control character can't occur in scraped prose. */
const PARAGRAPH_SENTINEL = "\u0000";

const ENTITIES: [RegExp, string][] = [
  [/&nbsp;/g, " "],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#0?39;|&apos;/g, "'"],
  [/&#x27;/gi, "'"],
  // Ampersand last: decoding it first would let `&amp;lt;` become `<`.
  [/&amp;/g, "&"],
];

/**
 * Paragraph-preserving plain-text reduction of an HTML body.
 *
 * Not a sanitizer — the output is rendered as React text children (or a
 * `<meta>` attribute), both of which escape. It exists because the two
 * places that need the prose without the markup (the server render above
 * and page meta descriptions) both run where DOMPurify can't.
 */
export function htmlToParagraphs(html: string | null | undefined): string[] {
  if (!html) return [];
  return (
    html
      .replace(NON_PROSE_ELEMENTS, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      // A sentinel rather than "\n": raw newlines in the source are just
      // whitespace in HTML (scraped bodies are full of source indentation),
      // so splitting on them would break a paragraph at every source line.
      .replace(BLOCK_BOUNDARY, PARAGRAPH_SENTINEL)
      .replace(/<[^>]*>/g, "")
      .split(PARAGRAPH_SENTINEL)
      .map((line) => {
        let out = line;
        for (const [pattern, replacement] of ENTITIES) out = out.replace(pattern, replacement);
        return out.replace(/\s+/g, " ").trim();
      })
      .filter((line) => line.length > 0)
  );
}

/**
 * One-line plain-text reduction, clipped to `maxLength` on a word
 * boundary. For `<meta name="description">` and OG tags.
 */
export function htmlToPlainText(
  html: string | null | undefined,
  maxLength = 200,
): string | undefined {
  const text = htmlToParagraphs(html).join(" ");
  if (!text) return undefined;
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  // Only break on a space if one falls reasonably close to the limit —
  // otherwise a long unbroken token would gut the description.
  const body = lastSpace > maxLength * 0.6 ? clipped.slice(0, lastSpace) : clipped;
  return `${body.trimEnd()}…`;
}
