// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import {
  createProjectSession,
  layoutToDoc,
  memoryDocHost,
  readProjectLog,
  seedProjectDoc,
  type ProjectSession,
  type SceneOrigin,
} from "../../collab/index";
import { createRegistry } from "../../game/index";
import {
  createKindRegistry,
  defineAssetKind,
  type AssetEntry,
  type DocLayout,
} from "../../project/index";
import type { EditorNotify, EditorPublishHost, UsageLineView, UsageView } from "../host";
import { KitProvider } from "../kit/index";
import { UsagePanel } from "../panels/settings/UsagePanel";

const layout: DocLayout = { as: "map", rest: { as: "atomic" } };
const card = defineAssetKind({
  storage: "doc",
  kind: "card",
  title: "Card",
  description: "A card.",
  match: { suffixes: [".card.json"] },
  version: 1,
  schemaId: "urn:jams-engine:card:v1",
  schema: () => z.looseObject({ v: z.literal(1) }),
  layout,
  empty: () => ({ v: 1 }),
});
const kinds = createKindRegistry(null, [card]);
const registry = createRegistry();
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

const entry = (id: string, extra: Partial<AssetEntry> = {}): AssetEntry => ({
  key: `k${id}`,
  id,
  kind: "card",
  path: `${id}.card.json`,
  created: { at: 0, by: "seed" },
  ...extra,
});

const sessions: ProjectSession[] = [];

/** A project with `kept` live and `trashed` in the trash. */
async function project(trashed: string[], kept = ["gate"]) {
  const host = memoryDocHost();
  const entries = [
    ...kept.map((id) => entry(id)),
    ...trashed.map((id) => entry(id, { deleted: { at: 1, by: "ada" } })),
  ];
  seedProjectDoc(
    host.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: Object.fromEntries(entries.map((e) => [e.key, e])),
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  for (const e of entries) layoutToDoc(host.doc(`asset:p.${e.key}`), layout, { v: 1 });
  const session = await createProjectSession({
    project: "p",
    openDoc: host.client().openDoc,
    origin: ada,
    registry,
    kinds,
  });
  sessions.push(session);
  return session;
}

afterEach(() => {
  cleanup();
  for (const s of sessions.splice(0)) s.destroy();
});

function makeNotify() {
  const success = vi.fn();
  const error = vi.fn();
  const notify: EditorNotify = Object.assign(vi.fn(), { success, warning: vi.fn(), error });
  return { notify, success, error };
}

const line = (quota: string, used: number, max: number, extra: Partial<UsageLineView> = {}) => {
  const ratio = used / max;
  return {
    quota,
    text: `${quota}: ${used} of ${max}`,
    used,
    max,
    ratio,
    level: ratio >= 1 ? "full" : ratio >= 0.8 ? "warn" : "ok",
    ...extra,
  } satisfies UsageLineView;
};

const usageOf = (over: Partial<UsageView> = {}): UsageView => ({
  lines: [
    line("assetBytes", 41, 256, {
      detail: "30 MB in use · 6 MB in the trash · 5 MB replaced versions",
    }),
    line("releaseStorageBytes", 120, 512),
  ],
  notice: null,
  trash: {
    assets: 2,
    bytes: 6 * 1024 * 1024,
    confirm: "Permanently delete 2 assets in the trash (6 MB)? This can't be undone.",
  },
  footer: "These limits are per project. Cleanup runs every day.",
  ...over,
});

function publishWith(usage: () => UsageView): EditorPublishHost {
  return {
    project: "p",
    usage: vi.fn(async () => usage()),
    releases: vi.fn(async () => []),
    promote: vi.fn(),
    rollback: vi.fn(),
    settings: vi.fn(),
    setSettings: vi.fn(),
    openTokenDialog: vi.fn(),
    wording: {
      command: "",
      noRelease: "",
      token: "",
      visibility: { private: "", team: "", unlisted: "", public: "" },
      saveModes: { site: "", own: "", none: "" },
      connectsTo: "",
      privateLinks: "",
    },
  };
}

function mount(
  session: ProjectSession,
  publish: EditorPublishHost | undefined,
  said = makeNotify(),
) {
  const view = render(
    <KitProvider host={{ storage: null }}>
      <UsagePanel publish={publish} session={session} notify={said.notify} />
    </KitProvider>,
  );
  return { panel: within(view.container), container: view.container, said };
}

const portal = () => within(document.body);

describe("UsagePanel", () => {
  it("renders nothing without host.publish", async () => {
    const session = await project([]);
    const { container } = mount(session, undefined);
    expect(container.querySelector("[aria-label='Usage']")).toBeNull();
  });

  it("shows one bar per line with its caption, the breakdown and the footer", async () => {
    const session = await project(["crate", "barrel"]);
    const { panel } = mount(
      session,
      publishWith(() => usageOf()),
    );
    await waitFor(() => panel.getByText("assetBytes: 41 of 256"));
    expect(panel.getAllByRole("progressbar")).toHaveLength(2);
    expect(panel.getByText("releaseStorageBytes: 120 of 512")).toBeTruthy();
    expect(
      panel.getByText("30 MB in use · 6 MB in the trash · 5 MB replaced versions"),
    ).toBeTruthy();
    expect(panel.getByText("These limits are per project. Cleanup runs every day.")).toBeTruthy();
    const row = panel.getByText("assetBytes: 41 of 256").closest("[data-quota]")!;
    expect(within(row as HTMLElement).getByRole("button", { name: "Empty trash" })).toBeTruthy();
    expect(panel.queryByRole("status")).toBeNull();
  });

  it("marks a quota at 80% amber with the host's nearly-full notice", async () => {
    const session = await project([]);
    const { panel } = mount(
      session,
      publishWith(() =>
        usageOf({
          lines: [line("assetBytes", 205, 256), line("releaseStorageBytes", 10, 512)],
          notice: { level: "warn", text: "Asset storage is nearly full." },
        }),
      ),
    );
    const notice = await waitFor(() => panel.getByRole("status"));
    expect(notice.textContent).toBe("Asset storage is nearly full.");
    expect(notice.dataset.tone).toBe("warning");
    const row = panel.getByText("assetBytes: 205 of 256").closest("[data-quota]") as HTMLElement;
    expect(row.dataset.level).toBe("warn");
    expect((row.firstElementChild as HTMLElement).style.getPropertyValue("--je-primary")).toBe(
      "var(--je-warning)",
    );
    const other = panel.getByText("releaseStorageBytes: 10 of 512").closest("[data-quota]");
    expect((other as HTMLElement).dataset.level).toBe("ok");
  });

  it("marks a full quota red with the host's full notice", async () => {
    const session = await project([]);
    const { panel } = mount(
      session,
      publishWith(() =>
        usageOf({
          lines: [line("assetBytes", 256, 256)],
          notice: { level: "full", text: "Asset storage is full." },
        }),
      ),
    );
    const notice = await waitFor(() => panel.getByRole("alert"));
    expect(notice.textContent).toBe("Asset storage is full.");
    expect(notice.dataset.tone).toBe("danger");
    const row = panel.getByText("assetBytes: 256 of 256").closest("[data-quota]") as HTMLElement;
    expect(row.dataset.level).toBe("full");
    expect((row.firstElementChild as HTMLElement).style.getPropertyValue("--je-primary")).toBe(
      "var(--je-danger)",
    );
  });

  it("has no Empty trash while the host's trash is empty", async () => {
    const session = await project([]);
    const { panel } = mount(
      session,
      publishWith(() => usageOf({ trash: null })),
    );
    await waitFor(() => panel.getByText("assetBytes: 41 of 256"));
    expect(panel.queryByRole("button", { name: "Empty trash" })).toBeNull();
  });

  it("Empty trash asks first; cancelling deletes nothing", async () => {
    const session = await project(["crate", "barrel"]);
    const { panel } = mount(
      session,
      publishWith(() => usageOf()),
    );
    const button = await waitFor(() => panel.getByRole("button", { name: "Empty trash" }));
    await act(async () => {
      fireEvent.click(button);
    });
    const dialog = await waitFor(() => portal().getByRole("alertdialog"));
    expect(
      within(dialog).getByText(
        "Permanently delete 2 assets in the trash (6 MB)? This can't be undone.",
      ),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    });
    expect(
      session
        .view()
        .deleted.map((e) => e.id)
        .sort(),
    ).toEqual(["barrel", "crate"]);
    expect(readProjectLog(session.projectDoc)).toHaveLength(0);
  });

  it("Empty trash confirms, then purges every trashed entry in one batch", async () => {
    const session = await project(["crate", "barrel"]);
    let usage = usageOf();
    let usageCalls = 0;
    const publish = publishWith(() => {
      usageCalls += 1;
      return usage;
    });
    const { panel, said } = mount(session, publish);
    const button = await waitFor(() => panel.getByRole("button", { name: "Empty trash" }));
    await act(async () => {
      fireEvent.click(button);
    });
    usage = usageOf({ trash: null });
    const dialog = await waitFor(() => portal().getByRole("alertdialog"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete for good" }));
    });
    await waitFor(() =>
      expect(said.success.mock.calls.map((c) => c[0])).toEqual(["Deleted 2 assets for good"]),
    );
    expect(session.view().deleted).toEqual([]);
    expect(Object.keys(session.state().assets)).toEqual(["kgate"]);
    const log = readProjectLog(session.projectDoc);
    expect(log).toHaveLength(1);
    expect(log[0]?.label).toBe("Empty the trash");
    expect(session.canUndo()).toBe(false);
    await waitFor(() => expect(panel.queryByRole("button", { name: "Empty trash" })).toBeNull());
    expect(usageCalls).toBe(2);
    expect(said.error).not.toHaveBeenCalled();
  });

  it("disables Empty trash while this project's trash is empty here", async () => {
    const session = await project([]);
    const { panel } = mount(
      session,
      publishWith(() => usageOf()),
    );
    const button = await waitFor(() => panel.getByRole("button", { name: "Empty trash" }));
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("says why when the host can't report usage", async () => {
    const session = await project([]);
    const publish = publishWith(() => {
      throw new Error("offline");
    });
    const { panel } = mount(session, publish);
    const alert = await waitFor(() => panel.getByRole("alert"));
    expect(alert.textContent).toMatch(/offline/);
    expect(panel.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
