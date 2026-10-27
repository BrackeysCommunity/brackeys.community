// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  Announcement,
  Banner,
  BannerCollection,
} from "@/components/announcements/announcements";
import { type BannerContext, pickBanner } from "@/components/announcements/BannerSlot";
import { CookieBanner } from "@/components/announcements/CookieBanner";
import { FeatureBanner } from "@/components/announcements/FeatureBanner";
import { SPOTLIGHT_TARGETS, spotlightStore } from "@/components/announcements/spotlight";
import { FEATURE_FLAGS } from "@/lib/flags";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    hash,
    onClick,
    children,
    ...props
  }: { to: string; hash?: string } & React.ComponentProps<"a">) => (
    <a
      href={hash ? `${to}#${hash}` : to}
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
  kind: "feature",
  id: "thing",
  title: "A thing",
  body: "It does stuff.",
  cta: { label: "Try it", link: { to: "/canvases" }, spotlight: SPOTLIGHT_TARGETS.workspace },
};

const ctx: BannerContext = {
  history: {},
  flags: { ...FEATURE_FLAGS },
  signedIn: true,
  pathname: "/",
  now: Date.parse("2026-10-23"),
};

/** A single collection, for the rules that don't care about ranking. */
const pickAnnouncement = (banners: Banner[], c: BannerContext) =>
  pickBanner([{ id: "only", priority: 0, banners }], c);

describe("pickBanner", () => {
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

  it("ranks collections, then banners within one, ahead of registry order", () => {
    const notice: Banner = { kind: "cookie-notice", id: "notice", showForDays: Infinity };
    const urgent = { ...base, id: "urgent", priority: 5 };
    const collections: BannerCollection[] = [
      { id: "low", priority: 0, banners: [base, urgent] },
      { id: "high", priority: 10, banners: [notice] },
    ];
    expect(pickBanner(collections, ctx)?.id).toBe("notice");
    const closed = { notice: { firstSeen: ctx.now, closed: true as const } };
    expect(pickBanner(collections, { ...ctx, history: closed })?.id).toBe("urgent");
  });

  it("keeps an `Infinity` banner up until it's closed", () => {
    const notice: Banner = { kind: "cookie-notice", id: "notice", showForDays: Infinity };
    const history = { notice: { firstSeen: ctx.now - 400 * 86_400_000 } };
    expect(pickAnnouncement([notice], { ...ctx, history })).toBe(notice);
  });
});

describe("CookieBanner", () => {
  it("flips the analytics preference from the banner", () => {
    localStorage.clear();
    render(<CookieBanner onDismiss={() => {}} onFollow={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(localStorage.getItem("jt:analytics")).toBe("off");
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(localStorage.getItem("jt:analytics")).toBe("on");
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
