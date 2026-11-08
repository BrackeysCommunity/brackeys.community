import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ShellTitle, SiteIsland } from "@/components/canvas/shell/SiteIsland";

/** The site menu, the lobby link and the room's title, top left in play and in the editor. */
export function GameSiteIsland({ title }: { title: ReactNode }) {
  return (
    <SiteIsland
      label="Game"
      site={{ back: { label: "lobby", link: <Link to="/game" /> }, signinSource: "game" }}
    >
      <ShellTitle>{title}</ShellTitle>
    </SiteIsland>
  );
}
