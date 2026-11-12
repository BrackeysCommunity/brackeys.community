import type { SceneIssue } from "../scene/types";

/** A boot refused: the issues why, the first of which the error page names. */
export class StandaloneBootError extends Error {
  constructor(readonly issues: readonly SceneIssue[]) {
    super(issues[0]?.message ?? "the game couldn't start");
    this.name = "StandaloneBootError";
  }
}

/** The page's error panel: why the game didn't start, the code when there is one, and a Reload button. */
export function renderBootError(
  root: HTMLElement,
  error: { message: string; code: string | null },
): { destroy(): void } {
  const doc = root.ownerDocument;
  const panel = doc.createElement("div");
  panel.setAttribute("role", "alert");
  panel.dataset.jamsError = error.code ?? "";
  // Fixed to the viewport and scrolling, so a long message on a small screen stays readable from its first line;
  // it takes the pointer itself, whatever the page sets around `root`, so Reload stays clickable.
  panel.style.cssText =
    "position:fixed;inset:0;z-index:1;pointer-events:auto;display:flex;overflow:auto;padding:16px;box-sizing:border-box;text-align:center;font:16px/1.4 system-ui,sans-serif;color:#eee;background:#111";
  const body = doc.createElement("div");
  body.style.cssText =
    "margin:auto;display:flex;flex-direction:column;align-items:center;gap:12px;max-width:40em";

  const heading = doc.createElement("p");
  heading.style.cssText = "margin:0;font-size:20px;font-weight:600";
  heading.textContent = "The game couldn't start";
  const message = doc.createElement("p");
  message.style.cssText = "margin:0;max-width:100%;overflow-wrap:anywhere";
  message.textContent = error.message;
  body.append(heading, message);
  if (error.code !== null) {
    const code = doc.createElement("code");
    code.textContent = error.code;
    body.append(code);
  }
  const reload = doc.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  reload.style.cssText = "font:inherit;padding:6px 16px;cursor:pointer";
  reload.addEventListener("click", () => doc.defaultView?.location.reload());
  body.append(reload);
  panel.append(body);
  root.append(panel);
  return { destroy: () => panel.remove() };
}

/** The on-page error: the issue's code and message and a Reload button, as plain DOM. */
export function showBootError(root: HTMLElement, issue: SceneIssue): { destroy(): void } {
  return renderBootError(root, { message: issue.message, code: issue.code });
}
