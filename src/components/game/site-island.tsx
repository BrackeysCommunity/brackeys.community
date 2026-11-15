import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ShellTitle, SiteIsland } from "@/components/canvas/shell/SiteIsland";

import { DisplayMenu, type DisplaySetting } from "./display-menu";

/**
 * The site menu, the lobby link and the room's title, top left in play; with
 * `display`, the room's display menu after the title. `compact` draws it
 * without a frame, for the editor's top bar, where the scene picker names
 * what is open and the island has no title.
 */
export function GameSiteIsland({
  title,
  display,
  onProjectSettings,
  compact = false,
}: {
  title?: ReactNode;
  compact?: boolean;
  display?: { value: DisplaySetting; onChange: (next: DisplaySetting) => void };
  /** In the editor: the site menu's "Project settings" entry. */
  onProjectSettings?: () => void;
}) {
  return (
    <SiteIsland
      label="Game"
      compact={compact}
      site={{
        back: { label: "lobby", link: <Link to="/game" /> },
        signinSource: "game",
        ...(onProjectSettings ? { onProjectSettings } : {}),
      }}
    >
      {title ? <ShellTitle>{title}</ShellTitle> : null}
      {display ? (
        <>
          <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
          <DisplayMenu value={display.value} onChange={display.onChange} />
        </>
      ) : null}
    </SiteIsland>
  );
}
