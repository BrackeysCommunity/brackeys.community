import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// ── Mocks ──────────────────────────────────────────────────────────────────

// Strip framer-motion's animation timing — we only care about which slide is
// rendered, not the in-flight transitions.
vi.mock("framer-motion", () => {
  const Pass = ({ children, ...rest }: { children?: React.ReactNode; [key: string]: unknown }) => {
    // Strip motion-only props before forwarding to a div.
    const {
      initial: _i,
      animate: _a,
      exit: _e,
      transition: _t,
      custom: _c,
      ...domProps
    } = rest as Record<string, unknown>;
    return <div {...(domProps as Record<string, unknown>)}>{children}</div>;
  };
  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: () => Pass,
      },
    ),
  };
});

// CountUp drives a spring animation off intersection observer state, neither
// of which is meaningful in jsdom; render the final value statically so the
// carousel tests can assert on joined/entries counts.
vi.mock("@/components/ui/count-up", () => ({
  CountUp: ({ to, separator = "" }: { to: number; separator?: string }) => {
    const formatted = new Intl.NumberFormat("en-US", { useGrouping: !!separator }).format(to);
    return <span>{separator ? formatted.replace(/,/g, separator) : formatted}</span>;
  },
}));

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: ({ icon }: { icon: string }) => <span data-testid={`icon-${icon}`} />,
}));

vi.mock("@hugeicons/core-free-icons", () => ({
  ArrowLeft01Icon: "arrow-left",
  ArrowRight01Icon: "arrow-right",
  Calendar03Icon: "calendar",
  FlashIcon: "flash",
  PauseIcon: "pause",
  PlayIcon: "play",
}));

vi.mock("@/lib/hooks/use-date-now", () => ({
  default: () => new Date("2026-04-30T12:00:00Z").getTime(),
}));

// ── Import after mocks ─────────────────────────────────────────────────────

const { FeaturedJamCarousel } = await import("../FeaturedJamCarousel");

// ── Fixtures ───────────────────────────────────────────────────────────────

type Jam = Parameters<typeof FeaturedJamCarousel>[0]["jams"][number];

function makeJam(overrides: Partial<Jam> = {}): Jam {
  return {
    jamId: 1,
    slug: "ludum-dare-56",
    title: "Ludum Dare 56",
    bannerUrl: null,
    hosts: [{ name: "Ludum Dare", url: "https://ldjam.com" }],
    startsAt: new Date("2026-04-24T00:00:00Z"),
    endsAt: new Date("2026-05-02T00:00:00Z"),
    joinedCount: 13,
    entriesCount: 4,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("FeaturedJamCarousel", () => {
  it("renders a loading skeleton when isLoading", () => {
    const { container } = render(<FeaturedJamCarousel jams={[]} isLoading />);
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("renders the empty state when there are no jams", () => {
    render(<FeaturedJamCarousel jams={[]} />);
    expect(screen.getByText(/no active jams/i)).toBeTruthy();
  });

  it("shows jam title, joined and entries counts", () => {
    render(<FeaturedJamCarousel jams={[makeJam()]} />);
    expect(screen.getByText("Ludum Dare 56")).toBeTruthy();
    expect(screen.getByText("13")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
  });

  it("derives running state from dates (LIVE pill) regardless of any DB status", () => {
    render(<FeaturedJamCarousel jams={[makeJam()]} />);
    // The LIVE pill is rendered as text content "// LIVE"
    expect(screen.getByText(/\/\/ LIVE/i)).toBeTruthy();
  });

  it("shows OPENS IN label and start countdown for upcoming jams", () => {
    const upcoming = makeJam({
      startsAt: new Date("2026-05-15T00:00:00Z"),
      endsAt: new Date("2026-05-20T00:00:00Z"),
    });
    render(<FeaturedJamCarousel jams={[upcoming]} />);
    expect(screen.getByText(/OPENS IN/)).toBeTruthy();
  });

  it("shows ENDED label and dash for jams whose endsAt is in the past", () => {
    const ended = makeJam({
      startsAt: new Date("2026-01-01T00:00:00Z"),
      endsAt: new Date("2026-02-01T00:00:00Z"),
    });
    render(<FeaturedJamCarousel jams={[ended]} />);
    expect(screen.getAllByText(/ENDED/i).length).toBeGreaterThan(0);
  });

  it("renders pagination nubs (one per jam) when there are multiple jams", () => {
    const jams = [
      makeJam(),
      makeJam({ jamId: 2, slug: "j2", title: "Jam Two" }),
      makeJam({ jamId: 3, slug: "j3", title: "Jam Three" }),
    ];
    render(<FeaturedJamCarousel jams={jams} />);
    expect(screen.getByLabelText("Show Ludum Dare 56")).toBeTruthy();
    expect(screen.getByLabelText("Show Jam Two")).toBeTruthy();
    expect(screen.getByLabelText("Show Jam Three")).toBeTruthy();
  });

  it("does not render controls or nubs for a single jam", () => {
    render(<FeaturedJamCarousel jams={[makeJam()]} />);
    expect(screen.queryByLabelText("Carousel controls")).toBeNull();
    expect(screen.queryByLabelText(/^Show /)).toBeNull();
  });

  it("auto-advances to the next jam after ROTATE_MS", () => {
    const jams = [makeJam(), makeJam({ jamId: 2, slug: "second", title: "Second Jam" })];
    render(<FeaturedJamCarousel jams={jams} />);
    expect(screen.getByText("Ludum Dare 56")).toBeTruthy();
    expect(screen.queryByText("Second Jam")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.getByText("Second Jam")).toBeTruthy();
  });

  it("pause toggles autoplay (pressed state reflects paused)", () => {
    const jams = [makeJam(), makeJam({ jamId: 2, slug: "second", title: "Second Jam" })];
    render(<FeaturedJamCarousel jams={jams} />);

    const pauseBtn = screen.getByLabelText(/Pause autoplay/i);
    expect(pauseBtn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pauseBtn);

    const resumeBtn = screen.getByLabelText(/Resume autoplay/i);
    expect(resumeBtn.getAttribute("aria-pressed")).toBe("true");

    // Verify auto-advance is suspended while paused.
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.getByText("Ludum Dare 56")).toBeTruthy();
    expect(screen.queryByText("Second Jam")).toBeNull();
  });

  it("next button advances; prev wraps backwards", () => {
    const jams = [
      makeJam(),
      makeJam({ jamId: 2, slug: "second", title: "Second Jam" }),
      makeJam({ jamId: 3, slug: "third", title: "Third Jam" }),
    ];
    render(<FeaturedJamCarousel jams={jams} />);
    fireEvent.click(screen.getByLabelText("Next jam"));
    expect(screen.getByText("Second Jam")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Previous jam"));
    expect(screen.getByText("Ludum Dare 56")).toBeTruthy();

    // Wrap-around backwards from index 0.
    fireEvent.click(screen.getByLabelText("Previous jam"));
    expect(screen.getByText("Third Jam")).toBeTruthy();
  });

  it("clicking a nub jumps to that jam", () => {
    const jams = [
      makeJam(),
      makeJam({ jamId: 2, slug: "second", title: "Second Jam" }),
      makeJam({ jamId: 3, slug: "third", title: "Third Jam" }),
    ];
    render(<FeaturedJamCarousel jams={jams} />);
    fireEvent.click(screen.getByLabelText("Show Third Jam"));
    expect(screen.getByText("Third Jam")).toBeTruthy();
  });

  it("OPEN JAM link points at the itch.io jam URL", () => {
    render(<FeaturedJamCarousel jams={[makeJam()]} />);
    const link = screen.getByLabelText("Open jam") as HTMLAnchorElement;
    expect(link.href).toBe("https://itch.io/jam/ludum-dare-56");
  });
});
