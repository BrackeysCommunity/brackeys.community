// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vite-plus/test";

import { arrivalWords } from "../../game/live";
import type { AssetId, ProjectId, Sha256 } from "../../project/index";
import type {
  EditorLiveHost,
  EditorNotify,
  EditorPublishHost,
  GameSettingsView,
  LiveBaseView,
  LivePublished,
  LiveVersionView,
  ReleaseView,
  UsageView,
} from "../host";
import { KitProvider } from "../kit/index";
import { PublishPanel } from "../panels/publish/PublishPanel";
import { REPLACES_UNREAD } from "../panels/publish/ReleaseList";
import { editorPanels } from "../panels/registry";

// The Keep list asks the version check whether a live scene fits the new
// release; these descriptor texts stand for a version that fits and one that doesn't.
const FITS = "fits-v7";
const STALE = "stale-for-v7";
vi.mock("../../project/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../project/index")>();
  return {
    ...real,
    parseReleaseManifest: (text: string) =>
      text === "manifest-v7"
        ? { ok: true, manifest: { stand: text } }
        : real.parseReleaseManifest(text),
    parseSceneVersion: (text: string) =>
      text === FITS || text === STALE
        ? { ok: true, version: { stand: text } }
        : real.parseSceneVersion(text),
    checkSceneVersion: (...args: Parameters<typeof real.checkSceneVersion>) => {
      const stand = (args[1] as unknown as { stand?: string }).stand;
      if (stand === FITS) return [];
      if (stand === STALE)
        return [
          { severity: "error", code: "live-incompatible", message: "Other build.", path: "" },
        ];
      return real.checkSceneVersion(...args);
    },
  };
});

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
    text: "Nearly full. Releases outside your 10 newest are removed 14 days after publishing unless pinned.",
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
      connectOriginsMax: 4,
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
    expect(within(block).getByText("Production: v6 (first live 2 Nov 2026)")).toBeTruthy();
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

  it("asks before rolling production back to the release it was on before", async () => {
    const publish = host({ releases: vi.fn(async () => channels()) });
    mount(publish);
    fireEvent.click(await screen.findByRole("button", { name: "Roll back production to v5" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        "Players get v5 again the next time they open the game. v6 stays in the list.",
      ),
    ).toBeTruthy();
    expect(publish.rollback).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Roll back" }));
    await waitFor(() => expect(publish.rollback).toHaveBeenCalledWith("production", 5));
  });

  it("offers Play only for a release that can be played", async () => {
    mount(
      host({
        releases: vi.fn(async () => [
          release(3, { hidden: "Reported art." }),
          release(2, { collected: true }),
          release(1),
        ]),
      }),
    );
    const list = await screen.findByRole("list", { name: "Releases" });
    expect(within(list).queryByLabelText("Play v3")).toBeNull();
    expect(within(list).queryByLabelText("Play v2")).toBeNull();
    expect(within(list).getByLabelText("Play v1")).toBeTruthy();
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
    expect(await screen.findByText(/An origin is an https:\/\/ or wss:\/\/ address/)).toBeTruthy();
    fireEvent.change(field, { target: { value: "http://api.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText(/An origin is an https:\/\/ or wss:\/\/ address/)).toBeTruthy();
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

  it("takes a wss origin and stops adding at the host's maximum", async () => {
    const setSettings = vi.fn(async (patch) => ({
      ...settings,
      connectOrigins: patch.connectOrigins ?? [],
    })) satisfies EditorPublishHost["setSettings"];
    const three = ["https://a.example.com", "https://b.example.com", "https://c.example.com"];
    mount(
      host({ settings: vi.fn(async () => ({ ...settings, connectOrigins: three })), setSettings }),
    );
    const field = await screen.findByLabelText("Origin to add");
    fireEvent.change(field, { target: { value: "wss://Sync.Example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(setSettings).toHaveBeenCalledWith({
        connectOrigins: [...three, "wss://sync.example.com"],
      }),
    );
    await screen.findByRole("button", { name: "Remove wss://sync.example.com" });
    fireEvent.change(field, { target: { value: "https://d.example.com" } });
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty("disabled", true);
  });

  it("keeps saving on the game's own servers unavailable until an origin is listed", async () => {
    mount(host());
    const saves = await screen.findByRole("radiogroup", { name: "Where this game saves" });
    expect(
      within(saves).getByLabelText("On its own servers (list them under Connects to)"),
    ).toHaveProperty("disabled", true);
    expect(screen.getByText(/add the save server under Connects to first/)).toBeTruthy();
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

const MINUTE = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const BLOCKED = "5 of 12 players' games failed after this update.";
const FORECAST = "level-1@1 will be removed on 20 Nov 2026. Point a channel at it to keep it.";

function liveVersion(scene: string, number: number, over: Partial<LiveVersionView> = {}) {
  return {
    scene: scene as AssetId,
    number,
    id: `${String(number).padStart(2, "0")}${"cd".repeat(31)}` as Sha256,
    createdAt: ago(DAY),
    createdBy: "Jo",
    note: null,
    dataBytes: 14_000,
    pointers: [],
    blocked: null,
    hidden: null,
    collected: false,
    removal: null,
    ...over,
  } satisfies LiveVersionView;
}

const liveVersions = (): LiveVersionView[] => [
  liveVersion("level-1", 4, {
    pointers: [{ channel: "preview", timing: "next-load", since: ago(12 * MINUTE), by: "Jo" }],
  }),
  liveVersion("level-1", 3, {
    pointers: [
      { channel: "production", timing: "next-load", since: ago(3 * 60 * MINUTE), by: "Sam" },
    ],
    blocked: { by: "system", text: BLOCKED },
  }),
  liveVersion("cave", 2, {
    pointers: [{ channel: "production", timing: "boundary", since: ago(2 * MINUTE), by: null }],
  }),
  liveVersion("level-1", 1, {
    removal: { at: "2026-11-20T00:00:00.000Z", text: FORECAST },
  }),
];

type FakeLive = {
  [K in keyof EditorLiveHost]: EditorLiveHost[K] extends (...args: infer A) => infer R
    ? Mock<(...args: A) => R>
    : EditorLiveHost[K];
};

function liveHost(over: Partial<FakeLive> = {}, publisher = true): FakeLive {
  return {
    base: vi.fn<EditorLiveHost["base"]>(async (scene, channel) => {
      throw new Error(`no base for ${scene} on ${channel}`);
    }),
    publish: vi.fn<EditorLiveHost["publish"]>(async () => {
      throw new Error("not here");
    }),
    list: vi.fn<EditorLiveHost["list"]>(async () => liveVersions()),
    promote: vi.fn<EditorLiveHost["promote"]>(async (_scene, version) => ({
      from: 3,
      to: version,
    })),
    rollback: vi.fn<EditorLiveHost["rollback"]>(async () => ({ from: 4, to: null })),
    clear: vi.fn<EditorLiveHost["clear"]>(async () => ({ from: 4, to: null })),
    unblock: vi.fn<EditorLiveHost["unblock"]>(async () => undefined),
    usage: vi.fn<EditorLiveHost["usage"]>(async () => ({ today: 6, versions: 12, bytes: 400_000 })),
    role: vi.fn<EditorLiveHost["role"]>(() => ({ publisher })),
    wording: {
      noteMaxChars: 200,
      notePlaceholder: "What changed, for your team (up to 200 characters)",
      dataMaxBytes: 2 * 1024 * 1024,
      versionsPerDay: 100,
      data: (bytes) => `Data: ${bytes} of 2 MB`,
      today: (count) => `Today: ${count} of 100 versions`,
      stopConfirm: ({ release, scene, timing }) =>
        `Players go back to v${release}'s version of ${scene} ${arrivalWords(timing)}.`,
    },
    ...over,
  };
}

const titles = (scene: AssetId) => (scene === "level-1" ? "The ford" : undefined);

function mountLive(live: FakeLive | undefined, over: Partial<FakePublish> = {}) {
  const notify = notifier();
  const publish = host({
    releases: vi.fn(async () => channels()),
    ...(live ? { live } : {}),
    ...over,
  });
  render(
    <KitProvider host={{}}>
      <PublishPanel publish={publish} notify={notify} sceneTitle={titles} />
    </KitProvider>,
  );
  return { publish, notify };
}

const rowOf = async (channel: "preview" | "production", text: string) => {
  const list = await screen.findByRole("list", { name: `Live on ${channel}` });
  const row = within(list)
    .getAllByRole("listitem")
    .find((item) => item.textContent?.includes(text));
  return row ?? expect.fail(`no ${channel} row with ${text}`);
};

describe("PublishPanel's live scenes", () => {
  it("has no Live scenes section without the host's live member", async () => {
    mountLive(undefined);
    await screen.findByLabelText("Channels");
    expect(screen.queryByLabelText("Live scenes")).toBeNull();
    expect(screen.queryByText("Live scenes")).toBeNull();
  });

  it("lists one row per pointer under the channels, per channel", async () => {
    mountLive(liveHost());
    const section = await screen.findByLabelText("Live scenes");
    const channelBlock = screen.getByLabelText("Channels");
    expect(
      channelBlock.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const preview = await rowOf("preview", "level-1@4");
    expect(within(preview).getByText("The ford")).toBeTruthy();
    expect(preview.querySelector("p")?.textContent).toBe("level-1@4 · next load · 12m ago · Jo");
    const cave = await rowOf("production", "cave@2");
    expect(within(cave).getByText("cave")).toBeTruthy();
    expect(cave.querySelector("p")?.textContent).toBe("cave@2 · boundary · 2m ago");
    expect(
      within(screen.getByRole("list", { name: "Live on production" })).getAllByRole("listitem"),
    ).toHaveLength(2);
    expect(within(preview).getByRole("button", { name: "Promote to production" })).toBeTruthy();
    expect(within(preview).getByRole("button", { name: "Roll back" })).toBeTruthy();
    expect(within(preview).getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(within(cave).queryByRole("button", { name: "Promote to production" })).toBeNull();
  });

  it("says plainly when nothing is live", async () => {
    mountLive(liveHost({ list: vi.fn(async () => []) }));
    const section = await screen.findByLabelText("Live scenes");
    await waitFor(() =>
      expect(
        within(section).getByText(
          "No live scenes. Publish a scene from the editor to update one level without a release.",
        ),
      ).toBeTruthy(),
    );
  });

  it("asks before Stop with the host's sentence, then clears the pointer", async () => {
    const live = liveHost();
    const { notify } = mountLive(live);
    const row = await rowOf("preview", "level-1@4");
    fireEvent.click(within(row).getByRole("button", { name: "Stop" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        "Players go back to v7's version of The ford the next time the level loads.",
      ),
    ).toBeTruthy();
    expect(live.clear).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(live.clear).toHaveBeenCalledWith("level-1", "preview", "next-load"));
    await waitFor(() =>
      expect(notify.success.mock.calls[0]?.[0]).toBe(
        "The ford plays the release's version on preview again.",
      ),
    );
    await waitFor(() => expect(live.list).toHaveBeenCalledTimes(2));
  });

  it("names production's release in the Stop question there", async () => {
    mountLive(liveHost());
    const row = await rowOf("production", "cave@2");
    fireEvent.click(within(row).getByRole("button", { name: "Stop" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText("Players go back to v6's version of cave at the next safe moment."),
    ).toBeTruthy();
  });

  it("shows a blocked version's badge and reason, and Unblock asks first", async () => {
    const live = liveHost();
    mountLive(live);
    const row = await rowOf("production", "level-1@3");
    expect(within(row).getByText("blocked")).toBeTruthy();
    expect(within(row).getByText(BLOCKED)).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Unblock" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Players will get level-1@3 again.")).toBeTruthy();
    expect(live.unblock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Unblock" }));
    await waitFor(() => expect(live.unblock).toHaveBeenCalledWith("level-1", 3));
    await waitFor(() => expect(live.list).toHaveBeenCalledTimes(2));
  });

  it("keeps production's moves for publishers", async () => {
    mountLive(liveHost({}, false));
    const blocked = await rowOf("production", "level-1@3");
    expect(within(blocked).getByRole("button", { name: "Unblock" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(within(blocked).getByRole("button", { name: "Stop" })).toHaveProperty("disabled", true);
    expect(within(blocked).getByRole("button", { name: "Roll back" })).toHaveProperty(
      "disabled",
      true,
    );
    const preview = await rowOf("preview", "level-1@4");
    expect(within(preview).getByRole("button", { name: "Promote to production" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(within(preview).getByRole("button", { name: "Stop" })).toHaveProperty("disabled", false);
  });

  it("promotes a preview version to production with its timing, after asking", async () => {
    const live = liveHost();
    const { notify } = mountLive(live);
    const row = await rowOf("preview", "level-1@4");
    fireEvent.click(within(row).getByRole("button", { name: "Promote to production" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        "Players will get level-1@4 the next time the level loads. You can roll back or stop it at any time.",
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Promote" }));
    await waitFor(() =>
      expect(live.promote).toHaveBeenCalledWith("level-1", 4, "production", "next-load"),
    );
    await waitFor(() =>
      expect(notify.success.mock.calls[0]?.[0]).toBe("level-1@4 is live on production."),
    );
  });

  it("rolls a pointer back with its timing and reports a refusal", async () => {
    const live = liveHost({
      rollback: vi.fn(async () => {
        throw new Error("level-1@2 is blocked.");
      }),
    });
    const { notify } = mountLive(live);
    const row = await rowOf("preview", "level-1@4");
    fireEvent.click(within(row).getByRole("button", { name: "Roll back" }));
    await waitFor(() =>
      expect(live.rollback).toHaveBeenCalledWith("level-1", "preview", { timing: "next-load" }),
    );
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith("Couldn't roll back The ford on preview", {
        description: "level-1@2 is blocked.",
      }),
    );
  });

  it("lists the forecast with its UTC date", async () => {
    mountLive(liveHost());
    const section = await screen.findByLabelText("Live scenes");
    await waitFor(() => expect(within(section).getByText(FORECAST)).toBeTruthy());
  });

  it("shows a hidden version's badge and staff's reason, and offers no Promote for it", async () => {
    const hidden = liveVersion("level-1", 4, {
      pointers: [{ channel: "preview", timing: "next-load", since: ago(MINUTE), by: "Jo" }],
      hidden: "Spoils the ending.",
    });
    mountLive(liveHost({ list: vi.fn(async () => [hidden]) }));
    const row = await rowOf("preview", "level-1@4");
    expect(within(row).getByText("hidden")).toBeTruthy();
    expect(within(row).getByText("Spoils the ending.")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Promote to production" })).toBeNull();
  });

  it("marks a version due for cleanup, and a removed one, as the release rows do", async () => {
    mountLive(
      liveHost({
        list: vi.fn(async () => [
          liveVersion("level-1", 4, {
            pointers: [{ channel: "preview", timing: "next-load", since: ago(MINUTE), by: null }],
            removal: { at: "2026-11-20T00:00:00.000Z", text: FORECAST },
          }),
          liveVersion("cave", 2, {
            pointers: [{ channel: "preview", timing: "next-load", since: ago(MINUTE), by: null }],
            collected: true,
          }),
        ]),
      }),
    );
    expect(within(await rowOf("preview", "level-1@4")).getByText("removed soon")).toBeTruthy();
    const removed = await rowOf("preview", "cave@2");
    expect(within(removed).getByText("removed")).toBeTruthy();
    expect(within(removed).queryByRole("button", { name: "Promote to production" })).toBeNull();
  });

  it("asks before rolling production back, and moves it only on yes", async () => {
    const live = liveHost();
    mountLive(live);
    const row = await rowOf("production", "cave@2");
    fireEvent.click(within(row).getByRole("button", { name: "Roll back" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        "Players go back to what production played before cave@2 at the next safe moment: an earlier version of cave, or the release's own.",
      ),
    ).toBeTruthy();
    expect(live.rollback).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Roll back" }));
    await waitFor(() =>
      expect(live.rollback).toHaveBeenCalledWith("cave", "production", { timing: "boundary" }),
    );
  });

  it("lists a version published elsewhere in the editor when the host says so", async () => {
    const heard = new Set<(published: LivePublished) => void>();
    const live = liveHost({
      onPublished: vi.fn((listener: (published: LivePublished) => void) => {
        heard.add(listener);
        return () => heard.delete(listener);
      }),
    });
    mountLive(live);
    await rowOf("preview", "level-1@4");
    expect(live.list).toHaveBeenCalledTimes(1);
    for (const listener of heard)
      listener({
        versionId: "05".padEnd(64, "c") as Sha256,
        scene: "level-1",
        number: 5,
        created: true,
        channel: "preview",
      });
    await waitFor(() => expect(live.list).toHaveBeenCalledTimes(2));
  });
});

describe("the release promote's live scenes", () => {
  const onProduction = (): LiveVersionView[] => [
    liveVersion("level-1", 3, {
      pointers: [{ channel: "production", timing: "next-load", since: ago(MINUTE), by: "Jo" }],
    }),
    liveVersion("cave", 2, {
      pointers: [{ channel: "production", timing: "next-load", since: ago(MINUTE), by: "Jo" }],
    }),
  ];
  const base = vi.fn<EditorLiveHost["base"]>(async (scene, channel): Promise<LiveBaseView> => {
    const release = { id: "07".padEnd(64, "a") as Sha256, version: 7, manifest: "manifest-v7" };
    const live =
      channel === "production"
        ? {
            number: scene === "level-1" ? 3 : 2,
            versionId: "03".padEnd(64, "c") as Sha256,
            timing: "next-load" as const,
            since: ago(MINUTE),
            descriptor: scene === "level-1" ? FITS : STALE,
          }
        : null;
    return { channel, release, live, texts: {}, latest: 3 };
  });

  const openPromote = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Promote v7 to production" }));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() =>
      expect(dialog.textContent).toContain(
        "Promoting v7 replaces these live scenes: The ford (level-1@3), cave (cave@2).",
      ),
    );
    return dialog;
  };

  it("offers Keep, off, for each live scene that still fits, and passes the kept ones", async () => {
    const live = liveHost({ list: vi.fn(async () => onProduction()), base });
    const { publish } = mountLive(live);
    const dialog = await openPromote();
    const keep = within(dialog).getByRole("switch", { name: "Keep The ford" });
    expect(keep.getAttribute("aria-checked")).toBe("false");
    expect(within(dialog).getByText("The ford (still fits v7)")).toBeTruthy();
    expect(within(dialog).queryByRole("switch", { name: "Keep cave" })).toBeNull();
    expect(within(dialog).getAllByRole("switch")).toHaveLength(1);

    fireEvent.click(keep);
    await waitFor(() => expect(keep.getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Promote" }));
    await waitFor(() =>
      expect(publish.promote).toHaveBeenCalledWith(7, "production", { keepScenes: ["level-1"] }),
    );
  });

  it("replaces every live scene when nothing is kept", async () => {
    const live = liveHost({ list: vi.fn(async () => onProduction()), base });
    const { publish } = mountLive(live);
    const dialog = await openPromote();
    await within(dialog).findByRole("switch", { name: "Keep The ford" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Promote" }));
    await waitFor(() => expect(publish.promote).toHaveBeenCalledWith(7, "production"));
  });

  it("lists the live scenes without Keep for someone who isn't a publisher", async () => {
    const live = liveHost({ list: vi.fn(async () => onProduction()), base }, false);
    mountLive(live);
    const dialog = await openPromote();
    expect(within(dialog).queryByRole("switch")).toBeNull();
    expect(within(dialog).queryByText(/still fits/)).toBeNull();
  });

  it("holds Promote while the live scenes load, and says when they couldn't be read", async () => {
    let fail: (error: Error) => void = () => {};
    const list = vi
      .fn<EditorLiveHost["list"]>(async () => onProduction())
      .mockImplementationOnce(async () => onProduction())
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = reject;
          }),
      );
    mountLive(liveHost({ list, base }));
    fireEvent.click(await screen.findByRole("button", { name: "Promote v7 to production" }));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Promote" })).toHaveProperty(
        "disabled",
        true,
      ),
    );
    fail(new Error("offline"));
    await waitFor(() => expect(within(dialog).getByText(REPLACES_UNREAD)).toBeTruthy());
    expect(within(dialog).getByRole("button", { name: "Promote" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("asks as before when nothing is live on production", async () => {
    mountLive(liveHost({ list: vi.fn(async () => []) }));
    fireEvent.click(await screen.findByRole("button", { name: "Promote v7 to production" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        "Players will get v7 the next time they open the game. You can roll back at any time.",
      ),
    ).toBeTruthy();
    expect(dialog.textContent).not.toContain("replaces these live scenes");
  });
});
