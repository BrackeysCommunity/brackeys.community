// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { Announcement } from "@/components/announcements/announcements";
import {
  type AnnouncementContext,
  pickAnnouncement,
} from "@/components/announcements/FeatureAnnouncements";
import { FeatureBanner } from "@/components/announcements/FeatureBanner";
import { SPOTLIGHT_TARGETS, spotlightStore } from "@/components/announcements/spotlight";
import { FEATURE_FLAGS } from "@/lib/flags";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, onClick, children, ...props }: { to: string } & React.ComponentProps<"a">) => (
    <a
      href={to}
      onClick={(e) => {
        onClick?.(e);
        e.preventDefault();
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const base: Announcement = {
  id: "thing",
  title: "A thing",
  body: "It does stuff.",
  cta: { label: "Try it", link: { to: "/canvases" }, spotlight: SPOTLIGHT_TARGETS.workspace },
};

const ctx: AnnouncementContext = {
  history: {},
  flags: { ...FEATURE_FLAGS },
  signedIn: true,
  pathname: "/",
  now: Date.parse("2026-10-23"),
};

describe("pickAnnouncement", () => {
  it("takes the first eligible entry", () => {
    const second = { ...base, id: "second" };
    expect(pickAnnouncement([base, second], ctx)?.id).toBe("thing");
    const closed = { thing: { firstSeen: ctx.now, closed: true as const } };
    expect(pickAnnouncement([base, second], { ...ctx, history: closed })?.id).toBe("second");
  });

  it("waits on the flag", () => {
    const flagged = { ...base, flag: "canvases-enabled" as const };
    expect(pickAnnouncement([flagged], ctx)).toBeUndefined();
    expect(
      pickAnnouncement([flagged], { ...ctx, flags: { ...ctx.flags, "canvases-enabled": true } }),
    ).toBe(flagged);
  });

  it("keeps signed-in announcements from visitors", () => {
    const a = { ...base, audience: "signed-in" as const };
    expect(pickAnnouncement([a], { ...ctx, signedIn: false })).toBeUndefined();
  });

  it("retires after `until`", () => {
    expect(pickAnnouncement([{ ...base, until: "2026-10-01" }], ctx)).toBeUndefined();
    expect(pickAnnouncement([{ ...base, until: "2026-11-01" }], ctx)).toBeDefined();
  });

  it("retires for a viewer once its lifetime from first sight runs out", () => {
    const seen = (daysAgo: number) => ({ thing: { firstSeen: ctx.now - daysAgo * 86_400_000 } });
    expect(pickAnnouncement([base], { ...ctx, history: seen(13) })).toBe(base);
    expect(pickAnnouncement([base], { ...ctx, history: seen(15) })).toBeUndefined();
    expect(
      pickAnnouncement([{ ...base, showForDays: 30 }], { ...ctx, history: seen(15) }),
    ).toBeDefined();
  });

  it("stays off the feature's own pages, not lookalike paths", () => {
    const a = { ...base, hiddenOn: ["/canvases"] };
    expect(pickAnnouncement([a], { ...ctx, pathname: "/canvases/abc" })).toBeUndefined();
    expect(pickAnnouncement([a], { ...ctx, pathname: "/canvasesque" })).toBe(a);
  });
});

describe("FeatureBanner", () => {
  it("lights its spotlight while the CTA is hovered", () => {
    render(<FeatureBanner announcement={base} onDismiss={() => {}} onFollow={() => {}} />);
    const cta = screen.getByRole("link", { name: "Try it" });
    fireEvent.pointerEnter(cta);
    expect(spotlightStore.state).toBe(SPOTLIGHT_TARGETS.workspace);
    fireEvent.pointerLeave(cta);
    expect(spotlightStore.state).toBeNull();
  });

  it("clears the spotlight when it unmounts mid-hover", () => {
    const { unmount } = render(
      <FeatureBanner announcement={base} onDismiss={() => {}} onFollow={() => {}} />,
    );
    fireEvent.pointerEnter(screen.getByRole("link", { name: "Try it" }));
    unmount();
    expect(spotlightStore.state).toBeNull();
  });

  it("reports dismissals and follows separately", () => {
    const onDismiss = vi.fn();
    const onFollow = vi.fn();
    render(<FeatureBanner announcement={base} onDismiss={onDismiss} onFollow={onFollow} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    fireEvent.click(screen.getByRole("link", { name: "Try it" }));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onFollow).toHaveBeenCalledOnce();
  });
});
