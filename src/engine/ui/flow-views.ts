import type { LoadProgress } from "../render/asset-loader";
import type { LoadingView, LoadingViewFactory, TransitionRunner } from "../types";

/** A whole fade, both halves, when the request names no `ms`. */
export const DEFAULT_FADE_MS = 400;

const VEIL_ATTR = "data-jams-fade";

const cssColor = (rgb: number) => `#${(rgb & 0xffffff).toString(16).padStart(6, "0")}`;

/** Whether the layer's window asks for reduced motion. */
function prefersReducedMotion(el: HTMLElement): boolean {
  const view = el.ownerDocument.defaultView;
  try {
    return (
      typeof view?.matchMedia === "function" &&
      view.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Fades the transition layer to a colour (`spec.color`, else `opts.color`,
 * else black) and back: `out` over the first half of `spec.ms`, `in` over
 * the second. Under reduced motion each half is a cut.
 */
export function fadeTransition(opts: { color?: number } = {}): TransitionRunner {
  return async (phase, spec, layer) => {
    const doc = layer.ownerDocument;
    let veil = layer.querySelector<HTMLElement>(`[${VEIL_ATTR}]`);
    if (!veil) {
      veil = doc.createElement("div");
      veil.setAttribute(VEIL_ATTR, "");
      Object.assign(veil.style, { position: "absolute", inset: "0", opacity: "0" });
      layer.prepend(veil);
    }
    veil.style.background = cssColor(spec.color ?? opts.color ?? 0x000000);
    const half = Math.max(0, Math.round((spec.ms ?? DEFAULT_FADE_MS) / 2));
    const cut = half === 0 || prefersReducedMotion(layer);
    const target = phase === "out" ? "1" : "0";

    if (cut) {
      veil.style.transition = "";
      veil.style.opacity = target;
    } else {
      // Read the box so the browser commits the start opacity before the transition.
      void veil.offsetWidth;
      veil.style.transition = `opacity ${half}ms linear`;
      veil.style.opacity = target;
      await wait(half);
    }
    if (phase === "in") veil.remove();
  };
}

/**
 * A centred label and progress bar over the transition layer, shown while
 * a slow scene load runs.
 */
export function createLoadingOverlay(opts: { label?: string } = {}): LoadingViewFactory {
  return (layer): LoadingView => {
    const doc = layer.ownerDocument;
    let root: HTMLElement | null = null;
    let bar: HTMLElement | null = null;
    let fill: HTMLElement | null = null;

    function build(): void {
      root = doc.createElement("div");
      root.setAttribute("data-jams-loading", "");
      root.setAttribute("role", "status");
      Object.assign(root.style, {
        position: "absolute",
        inset: "0",
        zIndex: "1",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        color: "#ffffff",
        font: "500 14px/1.4 system-ui, sans-serif",
        textShadow: "0 1px 2px rgb(0 0 0 / 0.6)",
      });
      const label = doc.createElement("span");
      label.textContent = opts.label ?? "Loading…";
      bar = doc.createElement("div");
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      Object.assign(bar.style, {
        width: "min(240px, 60%)",
        height: "4px",
        borderRadius: "2px",
        background: "rgb(255 255 255 / 0.25)",
        overflow: "hidden",
      });
      fill = doc.createElement("div");
      Object.assign(fill.style, { height: "100%", width: "0%", background: "#ffffff" });
      bar.append(fill);
      root.append(label, bar);
      layer.append(root);
    }

    function progress(p: LoadProgress): void {
      const done = p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0;
      bar?.setAttribute("aria-valuenow", String(done));
      if (fill) fill.style.width = `${done}%`;
    }

    return {
      show(p) {
        if (!root) build();
        progress(p);
      },
      hide() {
        root?.remove();
        root = bar = fill = null;
      },
    };
  };
}
