import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { FeaturedJamPanel } from "@/components/home/FeaturedJamPanel";
import type { HeroJam } from "@/components/home/hero-jam";
import { useHeroJamEntries } from "@/components/home/use-hero-jam-entries";
import type { RecentEntry } from "@/components/home/use-recent-entries";

// ── Mocks ──────────────────────────────────────────────────────────────────
// Presentation the panel delegates is stubbed; what runs is the panel's own
// decision about which half of the card is on screen.

vi.mock("framer-motion", async () => {
  const { useEffect } = await import("react");
  // One component per tag, not one per property access: a fresh component
  // type each render would remount the subtree every render, re-firing
  // callback refs forever.
  const cache = new Map<string, unknown>();
  const build =
    (tag: string) =>
    ({
      children,
      initial: _initial,
      animate,
      exit: _exit,
      transition: _transition,
      layout: _layout,
      variants: _variants,
      onAnimationComplete,
      ...rest
    }: Record<string, unknown> & { children?: React.ReactNode }) => {
      // Animations complete instantly, so animation-end state releases.
      useEffect(() => {
        (onAnimationComplete as ((d: unknown) => void) | undefined)?.(animate);
      });
      const Tag = tag as "div";
      return <Tag {...rest}>{children}</Tag>;
    };
  return {
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => {
          if (!cache.has(tag)) cache.set(tag, build(tag));
          return cache.get(tag);
        },
      },
    ),
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
  };
});

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children?: React.ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: ({ icon }: { icon: string }) => <span data-testid={`icon-${icon}`} />,
}));

// Mirrors the component's icon imports; keep in sync when icons change.
vi.mock("@hugeicons/core-free-icons", () => ({
  ArrowLeft02Icon: "arrow-left",
  FlashIcon: "flash",
  GridViewIcon: "grid",
}));

vi.mock("@/components/home/jam-banner", () => ({
  JamBannerArt: () => <div data-testid="banner-art" />,
  JamBannerBackdrop: () => <div data-testid="banner-backdrop" />,
  JamStateBadge: ({ state }: { state: string }) => <span data-testid={`state-${state}`} />,
}));

vi.mock("@/components/ui/count-up", () => ({
  CountUp: ({ to }: { to: number }) => <span>{to}</span>,
}));

vi.mock("@/components/jams/JamCalendarPage/board/use-jam-color", () => ({
  useJamGradient: () => ["#111111", "#222222"],
}));

vi.mock("@/lib/hooks/use-cursor", () => ({
  HEADER_MAGNET_STRENGTH: 0,
  useMagnetic: () => ({}),
}));

vi.mock("@/lib/sound", () => ({
  BUTTON_CUES: {},
  DESTRUCTIVE_BUTTON_CUES: {},
  PAGE_CUES: {},
}));

vi.mock("@/lib/hooks/use-app-settings", () => ({
  useReducedMotion: () => false,
}));

// The full-feed query stays empty here, so the grid renders the sample
// `entries` prop — the network path is the hook's own concern.
vi.mock("@/components/home/use-hero-jam-entries", () => ({
  useHeroJamEntries: vi.fn(() => ({ entries: [], fetchMore: () => {} })),
}));

// The real plugin measures layout jsdom doesn't have; a plain div keeps
// the entries subtree rendering, with no viewport so the grid stays in
// its unvirtualized fallback.
vi.mock("overlayscrollbars-react", () => ({
  OverlayScrollbarsComponent: ({
    children,
    element: _element,
    options: _options,
    events: _events,
    ...rest
  }: Record<string, unknown> & { children?: React.ReactNode }) => <div {...rest}>{children}</div>,
}));

// jsdom has no ResizeObserver; the entries grid's column probe needs one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

// ── Fixtures ───────────────────────────────────────────────────────────────

const NOW = new Date("2026-08-20T00:00:00Z");

const hero: HeroJam = {
  source: "ranked",
  jam: {
    jamId: 1,
    slug: "brackeys-jam",
    title: "Brackeys Game Jam 2026.2",
    bannerUrl: null,
    startsAt: new Date("2026-08-18T00:00:00Z"),
    endsAt: new Date("2026-08-25T00:00:00Z"),
    votingEndsAt: null,
    joinedCount: 14909,
    entriesCount: 0,
    hosts: [],
  },
} as unknown as HeroJam;

function entry(entryId: number): RecentEntry {
  return {
    entryId,
    jamId: 1,
    gameTitle: `Game ${entryId}`,
    gameUrl: `https://itch.io/g/${entryId}`,
    gameCoverUrl: null,
    gameCoverColor: null,
    authorName: `Author ${entryId}`,
    ratingCount: 0,
    rank: null,
  } as unknown as RecentEntry;
}

const entries = [entry(1), entry(2), entry(3)];

afterEach(cleanup);

describe("FeaturedJamPanel", () => {
  it("leads with the jam's countdown, not its submissions", () => {
    render(<FeaturedJamPanel hero={hero} entries={entries} now={NOW} />);

    expect(screen.getByText("14909")).toBeTruthy();
    expect(screen.queryByText("Game 1")).toBeNull();
  });

  it("offers the entries view with a count once a jam has submissions", () => {
    render(<FeaturedJamPanel hero={hero} entries={entries} now={NOW} />);

    expect(screen.getByRole("button", { name: /ENTRIES 3/ })).toBeTruthy();
  });

  it("hides the control entirely when nothing has been submitted", () => {
    render(<FeaturedJamPanel hero={hero} entries={[]} now={NOW} />);

    expect(screen.queryByRole("button", { name: /ENTRIES/ })).toBeNull();
    expect(screen.getByText("14909")).toBeTruthy();
  });

  it("turns the card over to the covers, and back", () => {
    render(<FeaturedJamPanel hero={hero} entries={entries} now={NOW} />);
    const toggle = () => screen.getByRole("button", { name: /ENTRIES 3|BACK/ });

    fireEvent.click(toggle());
    expect(screen.getByText("Game 1")).toBeTruthy();
    expect(screen.getByText("Game 3")).toBeTruthy();
    expect(screen.queryByText("14909")).toBeNull();

    fireEvent.click(toggle());
    expect(screen.queryByText("Game 1")).toBeNull();
    expect(screen.getByText("14909")).toBeTruthy();
  });

  it("keeps the jam's title and its way out across the flip", () => {
    render(<FeaturedJamPanel hero={hero} entries={entries} now={NOW} />);

    fireEvent.click(screen.getByRole("button", { name: /ENTRIES 3/ }));

    expect(screen.getByRole("heading", { name: "Brackeys Game Jam 2026.2" })).toBeTruthy();
    expect(screen.getByLabelText("Open jam")).toBeTruthy();
  });

  it("freezes its footprint and floats, instead of reflowing the page", () => {
    // jsdom has no layout; stand in for the measured height.
    const measured = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(420);
    const { container } = render(<FeaturedJamPanel hero={hero} entries={entries} now={NOW} />);
    const wrapper = container.firstElementChild as HTMLElement;

    fireEvent.click(screen.getByRole("button", { name: /ENTRIES 3/ }));
    expect(wrapper.style.height).toBe("420px");
    expect(wrapper.firstElementChild?.className).toContain("absolute");

    fireEvent.click(screen.getByRole("button", { name: /BACK/ }));
    expect(wrapper.style.height).toBe("");
    expect(wrapper.firstElementChild?.className).not.toContain("absolute");

    measured.mockRestore();
  });

  it("advertises the jam's full entry count, not the sample's length", () => {
    const bigHero = { ...hero, jam: { ...hero.jam, entriesCount: 2120 } } as HeroJam;
    render(<FeaturedJamPanel hero={bigHero} entries={entries} now={NOW} />);

    expect(
      screen.getByRole("button", { name: new RegExp(`ENTRIES ${(2120).toLocaleString()}`) }),
    ).toBeTruthy();
  });

  it("asks for the rated feed while a jam is voting, newest otherwise", () => {
    const votingHero = {
      ...hero,
      jam: {
        ...hero.jam,
        endsAt: new Date("2026-08-19T00:00:00Z"),
        votingEndsAt: new Date("2026-08-27T00:00:00Z"),
        ratingsCount: 5,
      },
    } as HeroJam;
    render(<FeaturedJamPanel hero={votingHero} entries={entries} now={NOW} />);
    expect(vi.mocked(useHeroJamEntries)).toHaveBeenLastCalledWith(1, false, "ratings");

    render(<FeaturedJamPanel hero={hero} entries={entries} now={NOW} />);
    expect(vi.mocked(useHeroJamEntries)).toHaveBeenLastCalledWith(1, false, "recent");
  });

  it("closes the covers on Escape", () => {
    render(<FeaturedJamPanel hero={hero} entries={entries} now={NOW} />);

    fireEvent.click(screen.getByRole("button", { name: /ENTRIES 3/ }));
    expect(screen.getByText("Game 1")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Game 1")).toBeNull();
    expect(screen.getByText("14909")).toBeTruthy();
  });

  it("ignores Escape while the covers are closed", () => {
    render(<FeaturedJamPanel hero={hero} entries={entries} now={NOW} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByText("14909")).toBeTruthy();
  });

  it("never mounts a big jam's whole list before the grid is measured", () => {
    // jsdom lays nothing out, so the grid stays in its unmeasured
    // fallback — which is exactly the state this pins: a screenful, not
    // every cover a thousand-entry jam has.
    const many = Array.from({ length: 40 }, (_, i) => entry(i + 1));
    render(<FeaturedJamPanel hero={hero} entries={many} now={NOW} />);

    fireEvent.click(screen.getByRole("button", { name: /ENTRIES 40/ }));
    expect(screen.getByText("Game 1")).toBeTruthy();
    expect(screen.queryByText("Game 40")).toBeNull();
  });

  it("marks the control as expanded so it reads as a disclosure", () => {
    render(<FeaturedJamPanel hero={hero} entries={entries} now={NOW} />);
    const toggle = () => screen.getByRole("button", { name: /ENTRIES 3|BACK/ });

    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });
});
