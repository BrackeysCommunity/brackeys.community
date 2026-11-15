import { textFontOf } from "../game/behaviors/text";
import { localeFont, localeSettingsOf } from "../project/kinds/strings";
import type { GameStoreState, Vec2 } from "../types";
import { UI_LAYER_RESIZE } from "./layer";
import type { UiContext } from "./types";

const toText = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v as string | number | boolean | bigint | symbol);
};

/** Keeps `el.textContent` equal to `format(select(state))`. */
export function bindText<T>(
  el: HTMLElement,
  ctx: UiContext,
  select: (s: GameStoreState) => T,
  format: (v: T) => string = toText,
): () => void {
  return ctx.watch(select, (value) => {
    const text = format(value);
    if (el.textContent !== text) el.textContent = text;
  });
}

/**
 * Keeps `el` at a world point (through worldToClient and the camera), e.g. a
 * label over an entity. `el` is placed at the layer's top-left corner and
 * moved with a transform whenever `watchView` calls, and whenever a store
 * change moves the point `at()` returns; it is hidden while `at()` is null.
 */
export function bindToWorld(el: HTMLElement, ctx: UiContext, at: () => Vec2 | null): () => void {
  const shownVisibility = el.style.visibility;
  Object.assign(el.style, { position: "absolute", left: "0px", top: "0px" });

  let placed: Vec2 | null = null;
  const place = (viewMoved: boolean) => {
    const p = at();
    if (!p) {
      placed = null;
      el.style.visibility = "hidden";
      return;
    }
    // A store change that left both the view and the point alone has nothing to move.
    if (!viewMoved && placed && placed.x === p.x && placed.y === p.y) return;
    placed = { x: p.x, y: p.y };
    const client = ctx.game.worldToClient(p);
    const origin = ctx.root.getBoundingClientRect();
    const transform = `translate(${client.x - origin.left}px, ${client.y - origin.top}px)`;
    if (el.style.transform !== transform) el.style.transform = transform;
    el.style.visibility = shownVisibility;
  };

  const unwatchView = watchView(ctx, () => place(true));
  const unwatchPoint = ctx.watch(
    (s) => s,
    () => place(false),
  );
  return () => {
    unwatchView();
    unwatchPoint();
  };
}

/**
 * Calls `fn` now and whenever where the world shows on screen may have
 * moved: when the camera changes and when the layer follows a canvas resize.
 * For DOM sized or placed by `worldToClient`. Returns the unsubscribe.
 */
export function watchView(ctx: UiContext, fn: () => void): () => void {
  const onView = () => fn();
  const unwatch = ctx.watch((s) => s.camera, onView);
  ctx.root.addEventListener(UI_LAYER_RESIZE, onView);
  return () => {
    unwatch();
    ctx.root.removeEventListener(UI_LAYER_RESIZE, onView);
  };
}

/** A side of the UI layer a host's chrome may cover (`--jams-ui-safe-<side>`). */
export type UiSide = "top" | "right" | "bottom" | "left";

/** An offset from a layer edge clear of the host's chrome: 16px past its safe inset, plus `extra` (a CSS length). */
export const uiInset = (side: UiSide, extra?: string): string =>
  `calc(var(--jams-ui-safe-${side}, 0px) + 16px${extra ? ` + ${extra}` : ""})`;

/** The custom property the DOM helpers' text draws in: the locale's web font, set by `followLocale`. */
export const UI_FONT = "--jams-ui-font";

/** The helpers' `font-family`: the locale's font where it is a web font, else the system face. */
export const UI_FONT_FAMILY = `var(${UI_FONT}, system-ui, sans-serif)`;

/**
 * The CSS family the locale's font (`engine.locales.fonts`) draws in, added
 * to the document once per content hash; null for no font, a BMFont (the
 * DOM can't draw one), or one the host can't serve.
 */
function localeFontFamily(el: HTMLElement, ctx: UiContext): string | null {
  const project = ctx.game.project();
  if (!project) return null;
  const id = localeFont(localeSettingsOf(project.engine.locales), ctx.strings().locale);
  const font = textFontOf((asset) => project.asset(asset), id);
  if (font?.kind !== "web" || id === undefined) return null;
  const fonts = el.ownerDocument.fonts as FontFaceSet | undefined;
  const Face = el.ownerDocument.defaultView?.FontFace;
  if (!fonts || !Face) return null;
  const family = `jams-ui-font-${font.family}`;
  if (![...fonts].some((face) => face.family.replace(/"/g, "") === family)) {
    const url = ctx.assetUrl(id)?.url;
    if (!url) return null;
    const face = new Face(family, `url(${JSON.stringify(url)})`);
    fonts.add(face);
    face.load().catch(() => {});
  }
  return family;
}

/** Sets `el`'s `dir`, `lang` and `--jams-ui-font` from the locale now; call again on `onLocale`. */
export function followLocale(el: HTMLElement, ctx: UiContext): void {
  const strings = ctx.strings();
  el.dir = strings.direction;
  el.lang = strings.locale;
  const family = localeFontFamily(el, ctx);
  if (family) el.style.setProperty(UI_FONT, `${JSON.stringify(family)}, system-ui, sans-serif`);
  else el.style.removeProperty(UI_FONT);
}

/** Calls `fn` on a locale change; returns the unsubscribe. Read the table through `ctx.strings()` in it. */
export function onLocale(ctx: UiContext, fn: () => void): () => void {
  const handler = () => fn();
  ctx.game.on("locale:change", handler);
  return () => ctx.game.off("locale:change", handler);
}
