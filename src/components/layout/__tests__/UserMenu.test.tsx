import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { activeUserStore } from "@/lib/active-user-store";
import type { ActiveUserProfile } from "@/lib/active-user-store";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-router", () => ({
  Link: (props: Record<string, unknown>) => {
    const {
      to,
      params,
      search: _search,
      children,
      ...rest
    } = props as {
      to: string;
      params?: { userId?: string };
      search?: unknown;
      children?: React.ReactNode;
      [key: string]: unknown;
    };
    const href = params?.userId ? to.replace("$userId", params.userId) : to;
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
  useNavigate: () => vi.fn(),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      animate: _a,
      transition: _t,
      ...rest
    }: {
      children?: React.ReactNode;
      animate?: unknown;
      transition?: unknown;
      [key: string]: unknown;
    }) => <div {...rest}>{children}</div>,
  },
}));

vi.mock("@hugeicons/core-free-icons", () => ({
  BriefcaseDollarIcon: "briefcase-icon",
  Logout03Icon: "logout-icon",
  Settings02Icon: "settings-icon",
  Share01Icon: "share-icon",
  Shield02Icon: "shield-icon",
  UserIcon: "user-icon",
}));

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => <span data-testid="icon" />,
}));

vi.mock("@/components/ui/dropdown-menu", async () => {
  const { cloneElement } = await import("react");
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuItem: ({
      children,
      render,
      className: _c,
    }: {
      children: React.ReactNode;
      render?: React.ReactElement;
      className?: string;
    }) => {
      if (render) {
        return cloneElement(render, {}, children);
      }
      return <div>{children}</div>;
    },
    // Rendered as a real checkbox so `checked`/`disabled` stay assertable —
    // base-ui's own item is a `menuitemcheckbox`, which the jsdom stub can't
    // reproduce without the menu around it.
    DropdownMenuCheckboxItem: ({
      children,
      checked,
      disabled,
      onCheckedChange,
      ...rest
    }: {
      children: React.ReactNode;
      checked?: boolean;
      disabled?: boolean;
      onCheckedChange?: (next: boolean) => void;
      [key: string]: unknown;
    }) => (
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange?.(!checked)}
        {...(rest as Record<string, unknown>)}
      >
        {children}
      </button>
    ),
    DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
      <button type="button">{children}</button>
    ),
  };
});

vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: vi.fn() },
}));

const updateProfile = vi.fn((_input: { availableForWork?: boolean }) => Promise.resolve({}));

vi.mock("@/orpc/client", () => ({
  client: {
    updateProfile: (input: { availableForWork?: boolean }) => updateProfile(input),
  },
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/hooks/use-cursor", () => ({
  HEADER_MAGNET_STRENGTH: 0.05,
  useMagnetic: () => ({
    ref: { current: null },
    position: { x: 0, y: 0 },
  }),
}));

// ── Import after mocks ─────────────────────────────────────────────────────

const { UserMenu } = await import("../UserMenu");

// ── Helpers ─────────────────────────────────────────────────────────────────

const defaultUser = { id: "user-123", name: "TestUser", image: null };

function setActiveProfile(profile: ActiveUserProfile | null) {
  activeUserStore.setState(() => ({ profile, isPending: false }));
}

function resetStore() {
  activeUserStore.setState(() => ({ profile: null, isPending: false }));
}

function renderMenu(props?: { compact?: boolean }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UserMenu user={defaultUser} {...props} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  resetStore();
  vi.clearAllMocks();
  cleanup();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("UserMenu profile links", () => {
  it("uses custom url stub in VIEW PUBLIC link when set", () => {
    setActiveProfile({
      discordUsername: "testuser",
      discordId: "123",
      avatarUrl: null,
      guildNickname: null,
      guildAvatarUrl: null,
      inGuild: true,
      urlStub: "my-custom-slug",
      availableForWork: false,
      isStaff: false,
      isAdmin: false,
    });

    renderMenu();

    const link = screen.getByTestId("view-public-link");
    expect(link.getAttribute("href")).toBe("/profile/my-custom-slug");
  });

  it("falls back to user id in VIEW PUBLIC link when no url stub", () => {
    setActiveProfile({
      discordUsername: "testuser",
      discordId: "123",
      avatarUrl: null,
      guildNickname: null,
      guildAvatarUrl: null,
      inGuild: true,
      urlStub: null,
      availableForWork: false,
      isStaff: false,
      isAdmin: false,
    });

    renderMenu();

    const link = screen.getByTestId("view-public-link");
    expect(link.getAttribute("href")).toBe("/profile/user-123");
  });

  it("falls back to user id when active profile is not loaded", () => {
    renderMenu();

    const link = screen.getByTestId("view-public-link");
    expect(link.getAttribute("href")).toBe("/profile/user-123");
  });
});

describe("UserMenu admin link", () => {
  const base = {
    discordUsername: "testuser",
    discordId: "123",
    avatarUrl: null,
    guildNickname: null,
    guildAvatarUrl: null,
    inGuild: true,
    urlStub: null,
    availableForWork: false,
  };

  it("shows the admin link for staff", () => {
    setActiveProfile({ ...base, isStaff: true, isAdmin: false });

    renderMenu();

    expect(screen.getByTestId("admin-link").getAttribute("href")).toBe("/admin");
  });

  it("hides the admin link for non-staff", () => {
    setActiveProfile({ ...base, isStaff: false, isAdmin: false });

    renderMenu();

    expect(screen.queryByTestId("admin-link")).toBeNull();
  });

  it("hides the admin link when the profile has not loaded", () => {
    renderMenu();

    expect(screen.queryByTestId("admin-link")).toBeNull();
  });
});

describe("UserMenu availability toggle", () => {
  const base = {
    discordUsername: "testuser",
    discordId: "123",
    avatarUrl: null,
    guildNickname: null,
    guildAvatarUrl: null,
    inGuild: true,
    urlStub: null,
    isStaff: false,
    isAdmin: false,
  };

  it("reflects the stored availability", () => {
    setActiveProfile({ ...base, availableForWork: true });

    renderMenu();

    expect(screen.getByTestId("availability-toggle").getAttribute("aria-checked")).toBe("true");
  });

  it("writes the flip through updateProfile", async () => {
    setActiveProfile({ ...base, availableForWork: false });

    renderMenu();
    fireEvent.click(screen.getByTestId("availability-toggle"));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ availableForWork: true }));
  });

  it("moves the switch before the request settles", () => {
    setActiveProfile({ ...base, availableForWork: false });

    renderMenu();
    fireEvent.click(screen.getByTestId("availability-toggle"));

    // The optimistic store write is what the hero card and the edit flyout
    // read back from, so the three surfaces agree from the first frame.
    expect(activeUserStore.state.profile?.availableForWork).toBe(true);
  });

  it("rolls the switch back when the write fails", async () => {
    updateProfile.mockRejectedValueOnce(new Error("nope"));
    setActiveProfile({ ...base, availableForWork: false });

    renderMenu();
    fireEvent.click(screen.getByTestId("availability-toggle"));

    await waitFor(() => expect(activeUserStore.state.profile?.availableForWork).toBe(false));
  });

  it("is disabled until the profile has loaded", () => {
    renderMenu();

    expect(screen.getByTestId("availability-toggle")).toHaveProperty("disabled", true);
  });
});
