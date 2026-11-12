// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vite-plus/test";

import type { ProjectId, Sha256 } from "../../project/index";
import type {
  EditorNotify,
  EditorPublishHost,
  GameSettingsView,
  ReleaseView,
  UsageView,
} from "../host";
import { KitProvider } from "../kit/index";
import { PublishPanel } from "../panels/publish/PublishPanel";
import { editorPanels } from "../panels/registry";

afterEach(cleanup);

const DAY = 86_400_000;

function release(version: number, over: Partial<ReleaseView> = {}): ReleaseView {
  return {
    version,
    id: `${String(version).padStart(2, "0")}${"ab".repeat(31)}` as Sha256,
    createdAt: new Date(Date.now() - version * DAY).toISOString(),
    bytes: 3 * 1024 * 1024,
    engine: "0.14.1",
    channels: [],
    jams: [],
    firstPromotedAt: null,
    removal: null,
    hidden: null,
    collected: false,
    playUrl: `https://play.test/games/p/play/${version}`,
    ...over,
  };
}

const usage: UsageView = {
  lines: [
    {
      quota: "release-bytes",
      text: "Release storage: 120 MB of 512 MB",
      used: 120,
      max: 512,
      ratio: 120 / 512,
      level: "ok",
    },
    {
      quota: "releases-kept",
      text: "Releases kept: 9 of 10 (plus pinned)",
      used: 9,
      max: 10,
      ratio: 0.9,
      level: "warn",
    },
  ],
  notice: {
    level: "warn",
    text: "Nearly full. Old releases are removed 14 days after they leave your 10 newest.",
  },
  trash: null,
  footer: "These limits are per project.",
};

const settings: GameSettingsView = {
  visibility: "unlisted",
  reviewPending: false,
  saveMode: "site",
  connectOrigins: [],
  online: false,
  team: "Bees",
};

function notifier() {
  return Object.assign(vi.fn(), {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }) satisfies EditorNotify;
}

/** The host with every call a spy, so tests read them as properties. */
type FakePublish = {
  [K in keyof EditorPublishHost]: EditorPublishHost[K] extends (...args: infer A) => infer R
    ? Mock<(...args: A) => R>
    : EditorPublishHost[K];
};

function host(over: Partial<FakePublish> = {}): FakePublish {
  return {
    project: "p-1" as ProjectId,
    usage: vi.fn<EditorPublishHost["usage"]>(async () => usage),
    releases: vi.fn<EditorPublishHost["releases"]>(async () => []),
    promote: vi.fn<EditorPublishHost["promote"]>(async (version) => ({ from: 6, to: version })),
    rollback: vi.fn<EditorPublishHost["rollback"]>(async (_channel, to) => ({
      from: 6,
      to: to ?? 5,
    })),
    settings: vi.fn<EditorPublishHost["settings"]>(async () => settings),
    setSettings: vi.fn<EditorPublishHost["setSettings"]>(async () => {
      throw new Error("not implemented");
    }),
    openTokenDialog: vi.fn<EditorPublishHost["openTokenDialog"]>(),
    wording: {
      command: "vp run scene game release create p-1",
      noRelease:
        "Releases are built on your machine and uploaded. Run this in the project's repository:",
      token: "It needs an agent token with write access:",
      visibility: {
        private: "Private: only publishers and staff can play.",
        team: "Team: everyone on Bees can play.",
        unlisted: "Unlisted: anyone with the link can play; it isn't listed anywhere.",
        public: "Public: listed on the project, team and jam pages.",
      },
      saveModes: {
        site: "On jams.team (players who sign in get 4 saves of 32 KB)",
        own: "On its own servers (list them under Connects to)",
        none: "Nowhere",
      },
      connectsTo: "Origins this game may contact, up to 4. They are shown on the game page.",
      privateLinks: "A private or team release opens through a link that works for 12 hours.",
    },
    ...over,
  };
}

function mount(publish: EditorPublishHost | undefined, notify = notifier()) {
  const view = render(
    <KitProvider host={{}}>
      <PublishPanel publish={publish} notify={notify} />
    </KitProvider>,
  );
  return { ...view, notify };
}

const channels = (): ReleaseView[] => [
  release(7, { channels: ["preview"] }),
  release(6, { channels: ["production"], firstPromotedAt: "2026-11-02T10:00:00.000Z" }),
  release(5, { firstPromotedAt: "2026-10-20T10:00:00.000Z" }),
  release(2, {
    removal: {
      at: "2026-11-20T00:00:00.000Z",
      text: "v2 will be removed on 20 Nov 2026. Pin it to a jam or move a channel to it to keep it.",
    },
  }),
];

describe("PublishPanel", () => {
  it("is hidden without a publishing host, and only then among the editor's panels", () => {
    const { container } = mount(undefined);
    expect(container.querySelector("[aria-label='Publish']")).toBeNull();
    expect(editorPanels({}).some((p) => p.id === "publish")).toBe(false);
    expect(editorPanels({ publish: host() }).some((p) => p.id === "publish")).toBe(true);
  });

  it("offers the command for the open project when it has no release", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const publish = host();
    const { notify } = mount(publish);

    const command = await screen.findByText("vp run scene game release create p-1");
    expect(command.tagName).toBe("CODE");
    expect(screen.getByText(/built on your machine and uploaded/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy the command" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("vp run scene game release create p-1"),
    );
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith("Copied the command."));

    fireEvent.click(screen.getByRole("button", { name: "Create one" }));
    expect(publish.openTokenDialog).toHaveBeenCalledTimes(1);
  });

  it("shows the usage lines and the nearly-full notice above the channels", async () => {
    mount(host({ releases: vi.fn(async () => channels()) }));
    const lines = await screen.findByLabelText("Usage before publishing");
    expect(within(lines).getByText("Release storage: 120 MB of 512 MB")).toBeTruthy();
    expect(within(lines).getByRole("status").textContent).toMatch(/^Nearly full/);
    const channelBlock = await screen.findByLabelText("Channels");
    expect(
      lines.compareDocumentPosition(channelBlock) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("names each channel's release and hides the command once one exists", async () => {
    mount(host({ releases: vi.fn(async () => channels()) }));
    const block = await screen.findByLabelText("Channels");
    expect(within(block).getByText("Production: v6 (live since 2 Nov 2026)")).toBeTruthy();
    expect(within(block).getByText("Preview: v7")).toBeTruthy();
    expect(within(block).getByRole("button", { name: "Roll back production to v5" })).toBeTruthy();
    expect(screen.queryByText("vp run scene game release create p-1")).toBeNull();
  });

  it("asks before promoting, then moves production and says so", async () => {
    const publish = host({ releases: vi.fn(async () => channels()) });
    const { notify } = mount(publish);
    fireEvent.click(await screen.findByRole("button", { name: "Promote v7 to production" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        "Players will get v7 the next time they open the game. You can roll back at any time.",
      ),
    ).toBeTruthy();
    expect(publish.promote).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Promote" }));
    await waitFor(() => expect(publish.promote).toHaveBeenCalledWith(7, "production"));
    await waitFor(() => expect(notify.success.mock.calls[0]?.[0]).toBe("v7 is on production."));
    await waitFor(() => expect(publish.releases).toHaveBeenCalledTimes(2));
  });

  it("rolls production back to the release it was on before", async () => {
    const publish = host({ releases: vi.fn(async () => channels()) });
    mount(publish);
    fireEvent.click(await screen.findByRole("button", { name: "Roll back production to v5" }));
    await waitFor(() => expect(publish.rollback).toHaveBeenCalledWith("production", 5));
  });

  it("reports a refused promote through the host's toasts", async () => {
    const publish = host({
      releases: vi.fn(async () => channels()),
      promote: vi.fn(async () => {
        throw new Error("Only staff can publish.");
      }),
    });
    const { notify } = mount(publish);
    fireEvent.click(await screen.findByRole("button", { name: "Promote v7 to production" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Promote" }),
    );
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith("Couldn't promote v7", {
        description: "Only staff can publish.",
      }),
    );
  });

  it("lists the removal forecast", async () => {
    mount(host({ releases: vi.fn(async () => channels()) }));
    const soon = await screen.findByLabelText("Removed soon");
    expect(
      within(soon).getByText(
        "v2 will be removed on 20 Nov 2026. Pin it to a jam or move a channel to it to keep it.",
      ),
    ).toBeTruthy();
    const list = screen.getByRole("list", { name: "Releases" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(within(list).getByText("removed soon")).toBeTruthy();
  });

  it("leaves no forecast when nothing is due", async () => {
    mount(host({ releases: vi.fn(async () => channels().slice(0, 3)) }));
    await screen.findByLabelText("Channels");
    expect(screen.queryByLabelText("Removed soon")).toBeNull();
  });

  it("survives a failed releases() with an error state and a retry", async () => {
    const releases = vi
      .fn<EditorPublishHost["releases"]>()
      .mockRejectedValueOnce(new Error("The server is down."))
      .mockResolvedValue(channels());
    mount(host({ releases }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load the releases. The server is down.");
    expect(await screen.findByText("Release storage: 120 MB of 512 MB")).toBeTruthy();
    expect(await screen.findByLabelText("Visibility")).toBeTruthy();

    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Channels")).toBeTruthy();
  });

  it("shows the game's settings with the host's wording", async () => {
    mount(host({ settings: vi.fn(async () => ({ ...settings, team: null })) }));
    const visibility = await screen.findByRole("radiogroup", { name: "Visibility" });
    const radios = within(visibility).getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(
      within(visibility).getByLabelText(
        "Unlisted: anyone with the link can play; it isn't listed anywhere.",
      ),
    ).toHaveProperty("checked", true);
    expect(within(visibility).getByLabelText("Team: everyone on Bees can play.")).toHaveProperty(
      "disabled",
      true,
    );
    const saves = screen.getByRole("radiogroup", { name: "Where this game saves" });
    expect(within(saves).getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByText(/works for 12 hours/)).toBeTruthy();
    expect(screen.getByText(/up to 4\. They are shown/)).toBeTruthy();
  });

  it("shows its error state while the host refuses settings changes", async () => {
    const publish = host();
    const { notify } = mount(publish);
    const visibility = await screen.findByRole("radiogroup", { name: "Visibility" });
    fireEvent.click(
      within(visibility).getByLabelText("Private: only publishers and staff can play."),
    );
    await waitFor(() =>
      expect(publish.setSettings).toHaveBeenCalledWith({ visibility: "private" }),
    );
    expect((await screen.findByText(/^Not saved:/)).textContent).toBe("Not saved: not implemented");
    expect(notify.error).toHaveBeenCalledWith("Couldn't save the game's settings", {
      description: "not implemented",
    });
    expect(
      within(visibility).getByLabelText(
        "Unlisted: anyone with the link can play; it isn't listed anywhere.",
      ),
    ).toHaveProperty("checked", true);
  });

  it("adds a connect origin as its origin and refuses anything else", async () => {
    const setSettings = vi.fn(async (patch) => ({
      ...settings,
      connectOrigins: patch.connectOrigins ?? [],
    })) satisfies EditorPublishHost["setSettings"];
    mount(host({ setSettings }));
    const field = await screen.findByLabelText("Origin to add");
    fireEvent.change(field, { target: { value: "ftp://nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText(/An origin is an http or https address/)).toBeTruthy();
    expect(setSettings).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "https://api.example.com/v1/scores" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(setSettings).toHaveBeenCalledWith({ connectOrigins: ["https://api.example.com"] }),
    );
    expect(
      await screen.findByRole("button", { name: "Remove https://api.example.com" }),
    ).toBeTruthy();
  });

  it("fails the usage on its own without hiding the channels", async () => {
    mount(
      host({
        usage: vi.fn(async () => {
          throw new Error("Usage is unavailable.");
        }),
        releases: vi.fn(async () => channels()),
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't load the usage.");
    expect(await screen.findByLabelText("Channels")).toBeTruthy();
  });
});
