import { HugeiconsIcon } from "@hugeicons/react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";

import { GraphPaper } from "@/components/ui/graph-paper";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { MOTION_LABEL, useAppSettings, useReducedMotion } from "@/lib/hooks/use-app-settings";
import { useAppTheme } from "@/lib/hooks/use-app-theme";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { SETTINGS_TAB_META, SETTINGS_TABS } from "./settings-tabs";

export function SettingsLayout() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-6">
      <SettingsHero />

      {/* Rail beside the pane from `lg` up, a scrolling tab strip below it.
          One nav either way — the active marker is the same element,
          re-anchored from the bottom edge to the rail's right edge. */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[14rem_1fr] lg:items-start lg:gap-10">
        <SettingsNav />
        <SettingsPane />
      </div>
    </div>
  );
}

function SettingsNav() {
  return (
    <nav
      aria-label="Settings sections"
      className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto border-b border-muted/30 px-1 lg:sticky lg:top-4 lg:mx-0 lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0 lg:px-0 lg:pr-2"
    >
      {SETTINGS_TABS.map((id) => {
        const meta = SETTINGS_TAB_META[id];
        return (
          <Link
            key={id}
            to={meta.to}
            // The shell scroller carries `view-transition-name: page`, so a
            // default-transitioned hop cross-fades the hero and this rail
            // along with the pane. Moving between sections only changes the
            // pane — it animates itself in `SettingsPane`, and everything
            // around it holds still.
            viewTransition={false}
            className={cn(
              "relative flex items-center gap-2.5 rounded-t px-3 py-3 whitespace-nowrap transition-colors lg:rounded lg:rounded-l-none lg:pl-4",
              "text-muted-foreground hover:text-foreground",
              "data-[status=active]:text-foreground lg:data-[status=active]:bg-muted/25",
            )}
          >
            {({ isActive }) => (
              <>
                <HugeiconsIcon icon={meta.icon} size={16} />
                <span className="flex flex-col items-start gap-0.5">
                  <MicroLabel as="span" variant="inherit" className="uppercase">
                    {meta.label}
                  </MicroLabel>
                  <Text as="span" size="xs" variant="muted" className="hidden lg:block">
                    {meta.hint}
                  </Text>
                </span>
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary lg:inset-x-auto lg:inset-y-1 lg:left-0 lg:h-auto lg:w-0.5"
                  />
                ) : null}
              </>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The swapping half. Keyed on the pathname so React tears the old pane
 * down and the new one animates in on its own — deliberately entry-only:
 * an `AnimatePresence` exit would keep the outgoing element mounted while
 * its `<Outlet/>` already resolves to the *incoming* route, so the pane
 * would swap its content and then fade the new content out.
 */
function SettingsPane() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const reduced = useReducedMotion();

  return (
    <motion.div
      key={pathname}
      initial={reduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE_OUT }}
      className="flex min-w-0 flex-col gap-8"
    >
      <Outlet />
    </motion.div>
  );
}

/**
 * Masthead, built like the other page heroes — notched well, gradient
 * wash, graph ruling. The readout carries the three prefs the header cog
 * now only summarises, so the page answers "what am I set to" before any
 * pane is opened.
 */
function SettingsHero() {
  const { theme } = useAppTheme();
  const { motionPref, muted } = useAppSettings();

  const readout = [
    { label: "Theme", value: theme.name },
    { label: "Motion", value: MOTION_LABEL[motionPref] },
    { label: "Sound", value: muted ? "Muted" : "On" },
  ];

  return (
    <Well
      notchOpts
      surfaceClassName="bg-card bg-linear-to-br from-deboss-surface via-deboss-surface to-primary/12 backdrop-blur-none"
    >
      <GraphPaper fade="bottom-left" />
      <div className="relative flex flex-wrap items-end justify-between gap-6 p-6">
        <div className="flex max-w-prose min-w-64 flex-col gap-2">
          <MicroLabel>PREFERENCES</MicroLabel>
          <Heading as="h1" className="text-2xl tracking-widest uppercase">
            Make it yours
          </Heading>
          <Text size="sm" variant="muted">
            Theme, motion, and audio are stored in this browser and apply the moment you pick them.
            Notifications, privacy, and account settings follow you everywhere.
          </Text>
        </div>

        <dl className="flex flex-wrap items-end gap-6">
          {readout.map((item) => (
            // dt before dd in the DOM, reversed for display: the value reads
            // first, the label under it, without lying to a reader.
            <div key={item.label} className="flex flex-col-reverse gap-0.5">
              <dt>
                <MicroLabel as="span">{item.label.toUpperCase()}</MicroLabel>
              </dt>
              <dd className="text-lg leading-none font-bold tracking-tight">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Well>
  );
}
