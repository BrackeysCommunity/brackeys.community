// @vitest-environment jsdom
import { readFileSync } from "node:fs";

import type { EditorHost } from "@jams/engine/editor-ui";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { activeUserStore, type ActiveUserProfile } from "@/lib/active-user-store";
import { presenceColor } from "@/lib/canvas/presence";
import { toast } from "@/lib/toast";

const fakes = vi.hoisted(() => ({ play: vi.fn(), editor: vi.fn() }));

vi.mock("@/lib/sound", async (original) => ({
  ...(await original<typeof import("@/lib/sound")>()),
  play: fakes.play,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/canvas/shell/SiteMenu", () => ({
  SiteMenu: (props: { back?: { label: string }; signinSource?: string }) => (
    <nav aria-label="Site menu">
      back to {props.back?.label} from {props.signinSource}
    </nav>
  ),
}));
vi.mock("@jams/engine/editor-ui", async (original) => ({
  ...(await original<typeof import("@jams/engine/editor-ui")>()),
  SceneEditor: (props: { host: EditorHost; onReady?: () => void }) => {
    fakes.editor(props);
    return <div className="je-root">{props.host.chrome?.topLeft}</div>;
  },
}));

const { SCENE_PROJECT, siteIdentity, SiteSceneEditor, useSiteEditorHost } =
  await import("../editor-host");

const profile = (patch: Partial<ActiveUserProfile> = {}): ActiveUserProfile => ({
  discordUsername: "ada",
  discordId: "1",
  avatarUrl: "https://cdn.example.test/ada.png",
  guildNickname: null,
  guildAvatarUrl: null,
  guildRoles: null,
  urlStub: null,
  inGuild: false,
  availableForWork: false,
  isStaff: false,
  isAdmin: false,
  ...patch,
});

const signIn = (p: ActiveUserProfile | null) =>
  act(() => activeUserStore.setState((s) => ({ ...s, profile: p })));

const noServer: Pick<EditorHost, "connect" | "assetUrl"> = {
  connect: () => {
    throw new Error("no server in this test");
  },
  assetUrl: () => "",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  activeUserStore.setState((s) => ({ ...s, profile: null }));
});

describe("the site's editor host", () => {
  it("notifies with the site's toast", () => {
    const { result } = renderHook(() => useSiteEditorHost({ title: "room", project: noServer }));
    expect(result.current.notify).toBe(toast);
  });

  it("names the editor after the active user: guild nickname, else Discord username", () => {
    const { result } = renderHook(() => useSiteEditorHost({ title: "room", project: noServer }));
    expect(result.current.identity).toBeUndefined();
    signIn(profile());
    expect(result.current.identity).toEqual({
      name: "ada",
      avatarUrl: "https://cdn.example.test/ada.png",
    });
    signIn(
      profile({
        guildNickname: "Ada L.",
        inGuild: true,
        guildAvatarUrl: "https://cdn.example.test/guild.png",
      }),
    );
    expect(result.current.identity).toEqual({
      name: "Ada L.",
      avatarUrl: "https://cdn.example.test/guild.png",
    });
    expect(siteIdentity(profile({ discordUsername: null }))).toBeUndefined();
  });

  it("renders the site menu, the lobby link and the title top left", () => {
    const { result } = renderHook(() =>
      useSiteEditorHost({ title: "test-yard", project: noServer }),
    );
    render(<>{result.current.chrome?.topLeft}</>);
    expect(screen.getByRole("navigation", { name: "Site menu" }).textContent).toBe(
      "back to lobby from game",
    );
    expect(screen.getByRole("heading", { name: "test-yard" })).toBeTruthy();
  });

  it("colours peers as the site's presence does, and sounds cues through the site's palette", () => {
    const { result } = renderHook(() => useSiteEditorHost({ title: "room", project: noServer }));
    expect(result.current.peerColor?.("tab-1")).toBe(presenceColor("tab-1").color);
    result.current.cue?.("press");
    result.current.cue?.("tab");
    result.current.cue?.("error");
    expect(fakes.play.mock.calls.map(([name]) => name)).toEqual(["press", "page", "error"]);
  });

  it("answers flags from the site's flag store, off for names it doesn't know", () => {
    const { result } = renderHook(() => useSiteEditorHost({ title: "room", project: noServer }));
    expect(result.current.flag?.("engine-projects")).toBe(false);
    expect(result.current.flag?.("no-such-flag")).toBe(false);
  });

  it("leaves per-viewer storage to the package's guarded localStorage", () => {
    const { result } = renderHook(() => useSiteEditorHost({ title: "room", project: noServer }));
    expect(result.current.storage).toBeUndefined();
  });

  it("calls the latest onSceneChange through a host that stays the same", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ onSceneChange }) => useSiteEditorHost({ title: "room", project: noServer, onSceneChange }),
      { initialProps: { onSceneChange: first } },
    );
    const host = result.current;
    rerender({ onSceneChange: second });
    expect(result.current).toBe(host);
    host.onSceneChange?.("engine-yard");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("engine-yard");
  });
});

describe("SiteSceneEditor", () => {
  it("edits the project the platformer's jams.project.json names", () => {
    const project = JSON.parse(readFileSync("src/games/platformer/jams.project.json", "utf8")) as {
      id: string;
    };
    expect(SCENE_PROJECT).toBe(project.id);
  });

  it("opens the platformer project on the dev server, titled by the room until the editor is up", () => {
    render(<SiteSceneEditor roomId="lobby-1" />);
    const props = fakes.editor.mock.lastCall![0] as {
      host: EditorHost;
      project: string;
      scene: string;
      onReady(): void;
    };
    expect(props).toMatchObject({ project: SCENE_PROJECT, scene: "test-yard" });
    expect(
      props.host.assetUrl("platformer", {
        id: "a",
        kind: "texture",
        sha256: "ab".repeat(32),
        bytes: 1,
      }),
    ).toBe(`/__project/platformer/blob/${"ab".repeat(32)}`);
    expect(screen.getByRole("heading", { name: "lobby-1" })).toBeTruthy();
    act(() => props.onReady());
    expect(screen.getByRole("heading", { name: "test-yard" })).toBeTruthy();
  });
});
