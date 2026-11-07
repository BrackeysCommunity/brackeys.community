import { Island } from "./CanvasShell";
import { SiteMenu, type SiteMenuProps } from "./SiteMenu";

/** A takeover page's read-only title. */
export function ShellTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="min-w-0 truncate px-1 text-sm font-bold text-foreground">{children}</h1>;
}

/**
 * The top-left island of a takeover page: the site menu, then whatever names
 * the page (a crumb, a title, its own menu).
 */
export function SiteIsland({
  label,
  site,
  compact = false,
  children,
}: {
  label: string;
  site: SiteMenuProps;
  /** Phones: no frame or divider, since the island sits inside the top bar. */
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Island
      aria-label={label}
      region={!compact}
      className={compact ? "min-w-0 flex-1 border-0 bg-transparent p-0 shadow-none" : "min-w-0"}
    >
      <SiteMenu {...site} />
      {compact ? null : <span className="h-5 w-px shrink-0 bg-border" aria-hidden />}
      {children}
    </Island>
  );
}
