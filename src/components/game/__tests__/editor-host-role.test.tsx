// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { FEATURE_FLAGS } from "@/lib/flags";
import { ServerFlagsContext } from "@/lib/hooks/use-flag";

const fakes = vi.hoisted(() => ({
  getGameSettings: vi.fn(),
  getProjectUsage: vi.fn(),
}));

vi.mock("@/orpc/client", () => ({
  client: { getGameSettings: fakes.getGameSettings, getProjectUsage: fakes.getProjectUsage },
}));

const { useHostedGame } = await import("../editor-host");

const gamesOn = ({ children }: { children: React.ReactNode }) => (
  <ServerFlagsContext value={{ ...FEATURE_FLAGS, "engine-games-enabled": true }}>
    {children}
  </ServerFlagsContext>
);

const refused = () => Promise.reject(new Error("Only the game's publishers can do this."));

afterEach(() => {
  fakes.getGameSettings.mockReset();
  fakes.getProjectUsage.mockReset();
});

describe("useHostedGame's role", () => {
  it("makes a publisher of a viewer the settings answer for, with the team", async () => {
    fakes.getGameSettings.mockResolvedValue({ team: "Bit Bakers" });
    const { result } = renderHook(() => useHostedGame("demo"), { wrapper: gamesOn });
    await waitFor(() =>
      expect(result.current).toEqual({ project: "demo", team: "Bit Bakers", publisher: true }),
    );
    expect(fakes.getProjectUsage).not.toHaveBeenCalled();
  });

  it("hosts the game for its editors, who may not move production", async () => {
    fakes.getGameSettings.mockImplementation(refused);
    fakes.getProjectUsage.mockResolvedValue({ usage: {}, lines: [], role: "editor" });
    const { result } = renderHook(() => useHostedGame("demo"), { wrapper: gamesOn });
    await waitFor(() =>
      expect(result.current).toEqual({ project: "demo", team: null, publisher: false }),
    );
    expect(fakes.getProjectUsage).toHaveBeenCalledWith({ projectId: "demo" });
  });

  it("hosts nothing for a player or a project the site refuses", async () => {
    fakes.getGameSettings.mockImplementation(refused);
    fakes.getProjectUsage.mockResolvedValue({ usage: {}, lines: [], role: "player" });
    const player = renderHook(() => useHostedGame("demo"), { wrapper: gamesOn });
    await waitFor(() => expect(fakes.getProjectUsage).toHaveBeenCalled());
    expect(player.result.current).toBeUndefined();

    fakes.getProjectUsage.mockImplementation(refused);
    const missing = renderHook(() => useHostedGame("gone"), { wrapper: gamesOn });
    await waitFor(() => expect(fakes.getProjectUsage).toHaveBeenCalledTimes(2));
    expect(missing.result.current).toBeUndefined();
  });
});
