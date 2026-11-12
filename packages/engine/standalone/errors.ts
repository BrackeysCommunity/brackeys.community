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
  panel.style.cssText =
    "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;text-align:center;font:16px/1.4 system-ui,sans-serif;color:#eee;background:#111";

  const heading = doc.createElement("p");
  heading.style.cssText = "margin:0;font-size:20px;font-weight:600";
  heading.textContent = "The game couldn't start";
  const message = doc.createElement("p");
  message.style.cssText = "margin:0;max-width:40em;overflow-wrap:anywhere";
  message.textContent = error.message;
  panel.append(heading, message);
  if (error.code !== null) {
    const code = doc.createElement("code");
    code.textContent = error.code;
    panel.append(code);
  }
  const reload = doc.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  reload.style.cssText = "font:inherit;padding:6px 16px;cursor:pointer";
  reload.addEventListener("click", () => doc.defaultView?.location.reload());
  panel.append(reload);

  if (doc.defaultView?.getComputedStyle(root).position === "static")
    root.style.position = "relative";
  root.append(panel);
  return { destroy: () => panel.remove() };
}

/** The on-page error: the issue's code and message and a Reload button, as plain DOM. */
export function showBootError(root: HTMLElement, issue: SceneIssue): { destroy(): void } {
  return renderBootError(root, { message: issue.message, code: issue.code });
}
