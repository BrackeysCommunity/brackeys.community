import type { IconSvgElement } from "@hugeicons/react";
import type { ReactNode } from "react";

import type { PanelId } from "../layout/model";

/** What a panel's tab and body are drawn with. */
export type PanelContext = {
  /** Reveals a panel wherever the viewer moved it, and selects its tab. */
  openPanel(id: PanelId): void;
};

/** One panel of the frame's tab groups. */
export type PanelDef = {
  id: PanelId;
  title: string;
  icon: IconSvgElement;
  /** A count on the tab (Problems' errors and warnings); hidden at zero. */
  badge?: (ctx: PanelContext) => { count: number; tone: "danger" | "warning" | "muted" } | null;
  /** Shown on the tab while a task in this scope runs: Problems while checks rerun. */
  busyScope?: string;
  render: (ctx: PanelContext) => ReactNode;
  /** Shown instead while the editor boots. */
  skeleton?: () => ReactNode;
};
