import type { EditorNotify } from "../../host";

/** Where the tree's failures go when its host passes no `notify`. */
export const consoleErrors: Pick<EditorNotify, "error"> = {
  error: (message) => console.error(`[editor] ${message}`),
};
