import { Link } from "@tanstack/react-router";
import { Component, type ReactNode } from "react";

import { BrackeysMark } from "@/components/ui/brackeys-mark";
import { captureError } from "@/lib/product-insights";
import { cn } from "@/lib/utils";

/**
 * The bar the shell reserves space for, without the chunk that normally
 * fills it.
 *
 * Geometry is copied from `AppHeader` rather than shared: the real bar is
 * a `motion.header` that hides on scroll and carries the session controls,
 * and this has to stay in the eager graph — importing anything from that
 * module would defeat the split it exists to protect. The logo lands in
 * the same place in both, so the real header resolving over this one moves
 * nothing.
 *
 * `withNav` adds the destinations. Off while the chunk is still in flight
 * (it is about to arrive with its own), on once it has failed and this is
 * the only navigation left.
 */
function ShellHeaderBar({ withNav = false }: { withNav?: boolean }) {
  return (
    <header className="fixed top-0 right-0 left-0 z-50 flex h-[var(--app-header-height)] items-center border-b border-b-emboss-shadow bg-background px-4 shadow-sm sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-[84rem] items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <BrackeysMark className="h-7 w-7" />
          <span className="leading-wide hidden font-sans text-xl font-bold text-foreground sm:inline">
            Brackeys
            <span className="bg-linear-to-r from-[var(--color-brackeys-yellow)] via-[var(--color-brackeys-fuscia)] to-[var(--color-brackeys-purple)] bg-clip-text text-transparent">
              Community
            </span>
          </span>
        </Link>
        {withNav && (
          <nav className="hidden items-center gap-6 text-sm font-bold tracking-widest lg:flex">
            {NAV_FALLBACK.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="px-2 py-1 text-foreground transition-colors hover:text-primary"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}

const NAV_FALLBACK = [
  { to: "/collab", label: "COLLAB" },
  { to: "/jams", label: "JAMS" },
  { to: "/teams", label: "TEAMS" },
  { to: "/members", label: "MEMBERS" },
] as const;

/** Shown while the header chunk is in flight — chrome only, so the real bar
 * arriving over it reads as the nav filling in rather than a swap. */
export function AppHeaderPending() {
  return <ShellHeaderBar />;
}

/** Shown when it never arrives. Same bar, plus the destinations, so a
 * failed chunk costs the session controls rather than the whole site. */
export function AppHeaderFallback() {
  return <ShellHeaderBar withNav />;
}

/**
 * The page with none of the shell around it.
 *
 * `MobileShell` owns the scroller its children render into, so when its
 * chunk fails there is nothing to scroll and the page reads as blank. This
 * is the same box with the chrome removed.
 */
export function MobileShellFallback({ children }: { children: ReactNode }) {
  return (
    <main
      id="main-content"
      data-scroll-root
      className={cn(
        "pointer-events-auto fixed inset-0 overflow-x-hidden overflow-y-auto",
        "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
    >
      <div className="content-pane flex w-full flex-col p-4 selection:bg-primary selection:text-white">
        {children}
      </div>
    </main>
  );
}

interface ShellBoundaryProps {
  /** Names the failing surface in the report, e.g. `"app_header"`. */
  scope: string;
  fallback: ReactNode;
  children: ReactNode;
}

/**
 * Keeps one lazily-loaded piece of the shell from taking the app down with
 * it.
 *
 * A `lazy()` whose import rejects throws during render, and with no
 * boundary above it that throw walks out of the React root — which is how
 * BC-209 turned a chunk that failed to load into a page with no header and
 * nothing said about it. The router's own `errorComponent` sits inside the
 * shell, so it never sees these.
 */
export class ShellBoundary extends Component<ShellBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    captureError(error, { scope: `shell.${this.props.scope}` });
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
