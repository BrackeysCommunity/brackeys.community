import { Outlet } from "@tanstack/react-router";

import { JamsPageProvider, useJamsPage } from "./jams-context";
import { JamsHero } from "./JamsHero";

/**
 * The `/jams` layout route: shared state, the hero (with its view
 * switcher), then whichever view route is active — the ranked discovery
 * board at `/jams`, the named-span calendar at `/jams/calendar`, or the
 * archive table at `/jams/archive`.
 */
export function JamsPageLayout() {
  return (
    <JamsPageProvider>
      <JamsPageShell />
    </JamsPageProvider>
  );
}

function JamsPageShell() {
  const { compact, totalTracked, view, setView } = useJamsPage();

  return (
    <div className={compact ? "flex flex-col gap-6" : "flex flex-col gap-8"}>
      <JamsHero totalJams={totalTracked} view={view} onViewChange={setView} />
      <Outlet />
    </div>
  );
}
