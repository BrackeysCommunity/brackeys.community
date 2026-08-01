import { Outlet } from "@tanstack/react-router";

import { JamCalendarHero } from "./JamCalendarHero";
import { JamsPageProvider, useJamsPage } from "./jams-context";

/**
 * The `/jams` layout route: shared state, the hero (with its view
 * switcher and stat tiles), then whichever view route is active — the
 * ranked discovery board at `/jams`, the named-span calendar at
 * `/jams/calendar`, or the archive table at `/jams/archive`.
 */
export function JamsPageLayout() {
  return (
    <JamsPageProvider>
      <JamsPageShell />
    </JamsPageProvider>
  );
}

function JamsPageShell() {
  const { compact, totalTracked, stats, view, setView, onStatClick } = useJamsPage();

  return (
    <div className={compact ? "flex flex-col gap-6" : "flex flex-col gap-8"}>
      <JamCalendarHero
        totalJams={totalTracked}
        stats={stats}
        statsLayout={compact ? "stacked" : "inline"}
        view={view}
        onViewChange={setView}
        onStatClick={onStatClick}
      />
      <Outlet />
    </div>
  );
}
