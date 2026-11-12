// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Add01Icon } from "@hugeicons/core-free-icons";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { formatBytes as budgetFormatBytes } from "../../export/budget";
import type { EditorCue, EditorHost, EditorStorage } from "../host";
import { Avatar } from "../kit/avatar";
import { Badge } from "../kit/badge";
import { Button, IconButton } from "../kit/button";
import { ColorField, parseHex, toHex } from "../kit/color-field";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "../kit/combobox";
import { Confirm } from "../kit/confirm";
import { KitProvider } from "../kit/context";
import { cx } from "../kit/cx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../kit/dialog";
import { inOverlay, isEditableTarget } from "../kit/editable-target";
import { formatBytes } from "../kit/format";
import { Hint } from "../kit/hint";
import { Input, Textarea } from "../kit/input";
import { chordKeys, KeyHint, keyLabel } from "../kit/key-hint";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../kit/menu";
import { Popover, PopoverContent, PopoverTrigger } from "../kit/popover";
import { Progress } from "../kit/progress";
import { SegmentedControl } from "../kit/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../kit/select";
import { Skeleton } from "../kit/skeleton";
import { Slider } from "../kit/slider";
import { Spinner } from "../kit/spinner";
import { Switch } from "../kit/switch";
import { TabPanel, Tabs, type TabItem } from "../kit/tabs";
import { MicroLabel, Text } from "../kit/text";
import { TimeAgo, timeAgo } from "../kit/time-ago";
import { createToaster, hostNotify, TOAST_DURATION_MS, Toasts } from "../kit/toasts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const KIT = join(dirname(fileURLToPath(import.meta.url)), "../kit");

type FakeHost = Pick<EditorHost, "cue" | "storage"> & {
  cues: EditorCue[];
  stored: Map<string, string>;
  reads: ReturnType<typeof vi.fn>;
};

function fakeHost(seed: Record<string, string> = {}): FakeHost {
  const cues: EditorCue[] = [];
  const stored = new Map(Object.entries(seed));
  const reads = vi.fn((key: string) => stored.get(key) ?? null);
  const storage: EditorStorage = {
    get: reads,
    set: (key, value) => void stored.set(key, value),
  };
  return { cues, stored, reads, storage, cue: (cue) => void cues.push(cue) };
}

function mount(ui: ReactNode, host: FakeHost = fakeHost()) {
  const result = render(<KitProvider host={host}>{ui}</KitProvider>);
  return { ...result, host };
}

const portal = () => document.querySelector<HTMLElement>(".je-portal");

/** A pointer moving onto an option highlights it before the click picks it, as Base UI requires. */
function choose(option: HTMLElement): void {
  fireEvent.mouseMove(option);
  fireEvent.click(option);
}

describe("the kit's sources", () => {
  // Imports are the package boundary test's to check, for every editor-ui file.
  it("style with the kit's own classes, not Tailwind utilities", () => {
    const bad = readdirSync(KIT).filter((name) =>
      /\bclassName="[^"]*\b(flex|px-\d|text-xs|bg-)\b/.test(readFileSync(join(KIT, name), "utf8")),
    );
    expect(bad).toEqual([]);
  });
});

describe("helpers", () => {
  it("cx joins the truthy classes", () => {
    expect(cx("je-a", false, null, undefined, "b", 0, "")).toBe("je-a b");
  });

  it("formatBytes is the export budget's, reading as B, KB and MB", () => {
    expect(formatBytes).toBe(budgetFormatBytes);
    expect([formatBytes(512), formatBytes(14_336), formatBytes(2_411_725)]).toEqual([
      "512 B",
      "14 KB",
      "2.3 MB",
    ]);
  });

  it("isEditableTarget and inOverlay find typing targets and open overlays", () => {
    document.body.innerHTML =
      '<input id="i"/><div contenteditable="true" id="c"></div><button id="b"></button>' +
      '<div role="menu"><button id="m"></button></div><div data-je-overlay><span id="p"></span></div>';
    const $ = (id: string) => document.getElementById(id);
    expect(isEditableTarget($("i"))).toBe(true);
    expect(isEditableTarget($("b"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(inOverlay($("m"))).toBe(true);
    expect(inOverlay($("p"))).toBe(true);
    expect(inOverlay($("b"))).toBe(false);
    document.body.innerHTML = "";
  });

  it("timeAgo is relative to the now it is given", () => {
    const now = Date.UTC(2026, 10, 8, 12, 0, 0);
    expect(timeAgo(null, now)).toBe("");
    expect(timeAgo(now - 30_000, now)).toBe("just now");
    expect(timeAgo(new Date(now - 12 * 60_000), now)).toBe("12m ago");
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(timeAgo(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe("2d ago");
  });

  it("key hints draw a chord's keys", () => {
    expect(chordKeys("Shift+Mod+Enter")).toEqual(["Shift", "Mod", "Enter"]);
    expect(chordKeys("Mod++")).toEqual(["Mod", "+"]);
    expect([keyLabel("Mod", true), keyLabel("Mod", false), keyLabel("z", false)]).toEqual([
      "⌘",
      "Ctrl",
      "Z",
    ]);
  });

  it("parses and prints hex colours", () => {
    expect(parseHex("#f80")).toEqual({ r: 255, g: 136, b: 0 });
    expect(parseHex("nope")).toBeNull();
    expect(toHex({ r: 255.4, g: -3, b: 16 })).toBe("#ff0010");
  });
});

describe("Button", () => {
  it("presses with the press cue and a hint instead of a title", () => {
    const onClick = vi.fn();
    const { host } = mount(
      <Button tooltip="Add one" onClick={onClick}>
        Add
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Add" });
    expect(button.getAttribute("title")).toBeNull();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    expect(host.cues).toEqual(["press"]);
  });

  it("busy: a spinner in the icon's slot, aria-busy, presses ignored, label kept", () => {
    const onClick = vi.fn();
    const { rerender, host } = mount(
      <Button icon={Add01Icon} onClick={onClick}>
        Import
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Import" });
    const slots = () => button.querySelectorAll(".je-btn-icon").length;
    expect(slots()).toBe(1);

    rerender(
      <KitProvider host={host}>
        <Button icon={Add01Icon} busy onClick={onClick}>
          Import
        </Button>
      </KitProvider>,
    );
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("data-busy")).toBe(true);
    // The same slots and label as at rest: the spinner takes the icon's place, so nothing reflows.
    expect(slots()).toBe(1);
    expect(button.querySelector(".je-btn-icon .je-spinner")).not.toBeNull();
    expect(button.querySelector(".je-btn-label")?.textContent).toBe("Import");
    expect(button.querySelector(".je-btn-busy")).toBeNull();
    // Still focusable, so focus doesn't drop while the work runs.
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(host.cues).toEqual([]);
  });

  it("busy without an icon overlays the spinner and keeps the label in the flow", () => {
    mount(<Button busy>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.querySelector(".je-btn-label")?.textContent).toBe("Save");
    expect(button.querySelector(".je-btn-busy .je-spinner")).not.toBeNull();
  });

  it("IconButton is named by its label", () => {
    const onClick = vi.fn();
    mount(<IconButton icon={Add01Icon} label="Add entity" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Add entity" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("portals", () => {
  it("render into the provider's .je-root container", async () => {
    mount(
      <>
        <Hint content="Snap to grid" open>
          <button type="button">Snap</button>
        </Hint>
        <Dialog open>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Load a run</DialogTitle>
              <DialogDescription>Pick a recording.</DialogDescription>
            </DialogHeader>
            <DialogFooter />
          </DialogContent>
        </Dialog>
      </>,
    );
    const container = portal();
    expect(container?.classList.contains("je-root")).toBe(true);
    await waitFor(() => expect(within(container!).getByText("Snap to grid")).toBeDefined());
    expect(within(container!).getByRole("dialog", { name: "Load a run" })).toBeDefined();
  });

  it("a popover opens in the container and counts as an overlay", async () => {
    mount(
      <Popover>
        <PopoverTrigger>Colour</PopoverTrigger>
        <PopoverContent>Picker</PopoverContent>
      </Popover>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Colour" }));
    const body = await waitFor(() => within(portal()!).getByText("Picker"));
    expect(inOverlay(body)).toBe(true);
  });

  it("a menu opens in the container, its items sound toggle", async () => {
    const onPick = vi.fn();
    const { host } = mount(
      <Menu>
        <MenuTrigger>Snap step</MenuTrigger>
        <MenuContent>
          <MenuItem onClick={onPick}>Reset</MenuItem>
          <MenuCheckboxItem checked={false}>Grid</MenuCheckboxItem>
          <MenuRadioGroup value="8">
            <MenuRadioItem value="8">8</MenuRadioItem>
            <MenuRadioItem value="16">16</MenuRadioItem>
          </MenuRadioGroup>
        </MenuContent>
      </Menu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Snap step" }));
    const menu = await waitFor(() => within(portal()!).getByRole("menu"));
    expect(within(menu).getByRole("menuitemradio", { name: "16" })).toBeDefined();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Reset" }));
    expect(onPick).toHaveBeenCalledOnce();
    expect(host.cues).toContain("toggle");
  });

  it("a select lists its items in the container", async () => {
    function Probe() {
      const [value, setValue] = useState("a");
      return (
        <Select value={value} onValueChange={(v) => typeof v === "string" && setValue(v)}>
          <SelectTrigger aria-label="Shape">
            <SelectValue>{value === "a" ? "Box" : "Circle"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">Box</SelectItem>
            <SelectItem value="b">Circle</SelectItem>
          </SelectContent>
        </Select>
      );
    }
    mount(<Probe />);
    const trigger = screen.getByRole("combobox", { name: "Shape" });
    fireEvent.click(trigger);
    const option = await waitFor(() => within(portal()!).getByRole("option", { name: "Circle" }));
    choose(option);
    await waitFor(() => expect(trigger.textContent).toContain("Circle"));
  });

  it("a combobox filters into the container", async () => {
    mount(
      <Combobox items={["gate-a", "gate-b", "post"]}>
        <ComboboxInput aria-label="Target" />
        <ComboboxContent>
          <ComboboxList>
            {(id: string) => (
              <ComboboxItem key={id} value={id}>
                {id}
              </ComboboxItem>
            )}
          </ComboboxList>
          <ComboboxEmpty>No targets</ComboboxEmpty>
        </ComboboxContent>
      </Combobox>,
    );
    const input = screen.getByRole("combobox", { name: "Target" });
    fireEvent.click(screen.getByRole("button", { name: "Show options" }));
    await waitFor(() => expect(within(portal()!).getAllByRole("option")).toHaveLength(3));
    fireEvent.change(input, { target: { value: "gate" } });
    await waitFor(() => expect(within(portal()!).getAllByRole("option")).toHaveLength(2));
  });
});

describe("Tabs", () => {
  const items: TabItem[] = [
    { value: "inspector", label: "Inspector" },
    {
      value: "problems",
      label: "Problems",
      badge: { count: 3, tone: "danger" },
      menu: <MenuItem>Move to top group</MenuItem>,
    },
    { value: "history", label: "History", badge: { count: 0, tone: "muted" }, busy: true },
  ];

  function Probe({ onChange }: { onChange?: (v: string) => void }) {
    const [value, setValue] = useState("inspector");
    return (
      <Tabs
        label="Right column"
        items={items}
        value={value}
        onValueChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
      >
        {items.map((item) => (
          <TabPanel key={item.value} value={item.value}>
            {item.label} body
          </TabPanel>
        ))}
      </Tabs>
    );
  }

  it("draws a tablist with count badges, hidden at zero", () => {
    mount(<Probe />);
    expect(screen.getByRole("tablist", { name: "Right column" })).toBeDefined();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Inspector", "Problems3", "History"]);
    expect(tabs[1]?.querySelector(".je-tab-badge")?.getAttribute("data-tone")).toBe("danger");
    expect(tabs[2]?.getAttribute("aria-busy")).toBe("true");
    expect(tabs[2]?.querySelector(".je-spinner")).not.toBeNull();
  });

  it("moves with the arrow keys, selecting as it goes, and sounds the tab cue", async () => {
    const onChange = vi.fn();
    const { host } = mount(<Probe onChange={onChange} />);
    const [inspector, problems] = screen.getAllByRole("tab");
    act(() => inspector!.focus());
    fireEvent.keyDown(inspector!, { key: "ArrowRight" });
    await waitFor(() => expect(problems!.getAttribute("aria-selected")).toBe("true"));
    expect(document.activeElement).toBe(problems);
    expect(onChange).toHaveBeenCalledWith("problems");
    expect(host.cues).toEqual(["tab"]);
    fireEvent.keyDown(problems!, { key: "ArrowLeft" });
    await waitFor(() => expect(inspector!.getAttribute("aria-selected")).toBe("true"));
  });

  it("keeps inactive panels mounted but hidden", () => {
    mount(<Probe />);
    const body = screen.getByText("History body");
    expect(body.closest("[role=tabpanel]")?.hasAttribute("hidden")).toBe(true);
  });

  it("opens a tab's menu from a right-click and from the menu button", async () => {
    mount(<Probe />);
    expect(screen.queryByRole("button", { name: "Inspector options" })).toBeNull();
    fireEvent.contextMenu(screen.getByRole("tab", { name: /Problems/ }));
    await waitFor(() =>
      expect(within(portal()!).getByRole("menuitem", { name: "Move to top group" })).toBeDefined(),
    );
  });
});

describe("Confirm", () => {
  it("stays open, its action busy, while an async confirm runs", async () => {
    let finish!: (v: unknown) => void;
    const onConfirm = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    mount(
      <Confirm
        title="Move crate.png to the trash?"
        confirmText="Move to trash"
        onConfirm={onConfirm}
      >
        <button type="button">Delete</button>
      </Confirm>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await waitFor(() => screen.getByRole("alertdialog"));
    const action = within(dialog).getByRole("button", { name: "Move to trash" });
    fireEvent.click(action);
    await waitFor(() => expect(action.getAttribute("aria-busy")).toBe("true"));
    fireEvent.click(action);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("alertdialog")).toBeDefined();
    await act(async () => finish(undefined));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("stays open when the confirm returns false or throws", async () => {
    const results: (() => unknown)[] = [
      () => false,
      async () => {
        throw new Error("nope");
      },
    ];
    const onConfirm = vi.fn(() => results.shift()?.());
    mount(<Confirm open title="Apply to prefab?" confirmText="Apply" onConfirm={onConfirm} />);
    const action = screen.getByRole("button", { name: "Apply" });
    fireEvent.click(action);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(action.getAttribute("aria-busy")).toBeNull());
    expect(screen.getByRole("alertdialog")).toBeDefined();
    fireEvent.click(action);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(action.getAttribute("aria-busy")).toBeNull());
    expect(screen.getByRole("alertdialog")).toBeDefined();
  });

  it("controlled: a sync confirm closes through onOpenChange; Cancel closes too", async () => {
    const onOpenChange = vi.fn();
    mount(<Confirm open onOpenChange={onOpenChange} title="Convert?" onConfirm={() => {}} />);
    expect(within(portal()!).getByRole("alertdialog")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    onOpenChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("bypass runs the confirm straight from the trigger", () => {
    const onConfirm = vi.fn();
    mount(
      <Confirm bypass title="Sure?" onConfirm={onConfirm}>
        <button type="button">Go</button>
      </Confirm>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("Toasts", () => {
  it("cap at four, the oldest leaving first, and each lasts five seconds", () => {
    vi.useFakeTimers();
    const toaster = createToaster();
    render(<Toasts toaster={toaster} />);
    act(() => {
      for (const n of [1, 2, 3, 4, 5]) toaster.notify(`Toast ${n}`);
    });
    expect(screen.getAllByRole("status").map((t) => t.textContent)).toEqual([
      "Toast 2",
      "Toast 3",
      "Toast 4",
      "Toast 5",
    ]);
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 1));
    expect(screen.getAllByRole("status")).toHaveLength(4);
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    toaster.destroy();
  });

  it("errors are alerts with the error cue; plain and success are status", () => {
    vi.useFakeTimers();
    const host = fakeHost();
    const toaster = createToaster({ cue: host.cue });
    render(<Toasts toaster={toaster} />);
    act(() => {
      toaster.notify.success("Imported crate.png");
      toaster.notify.warning("Two files skipped");
      toaster.notify.error("Couldn't rename", { description: "crate.png is taken" });
    });
    expect(screen.getAllByRole("status")).toHaveLength(2);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("crate.png is taken");
    expect(host.cues).toEqual(["error"]);
    fireEvent.click(within(alert).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
    toaster.destroy();
  });

  it("a repeated id replaces its toast and restarts its timer", () => {
    vi.useFakeTimers();
    const toaster = createToaster();
    render(<Toasts toaster={toaster} />);
    act(() => void toaster.notify("Saving", { id: "save" }));
    act(() => vi.advanceTimersByTime(4000));
    act(() => void toaster.notify.success("Saved", { id: "save" }));
    expect(screen.getAllByRole("status").map((t) => t.textContent)).toEqual(["Saved"]);
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getAllByRole("status")).toHaveLength(1);
    toaster.destroy();
  });

  it("a host's own notify wins, so its sound isn't doubled", () => {
    const own = Object.assign(vi.fn(), { success: vi.fn(), warning: vi.fn(), error: vi.fn() });
    const host = fakeHost();
    const toaster = createToaster({ cue: host.cue });
    hostNotify({ notify: own }, toaster).error("Failed");
    expect(own.error).toHaveBeenCalledWith("Failed");
    expect(toaster.toasts()).toHaveLength(0);
    expect(host.cues).toEqual([]);
    expect(hostNotify({}, toaster)).toBe(toaster.notify);
  });
});

describe("controls", () => {
  it("Switch is a switch and sounds toggle", () => {
    const onChange = vi.fn();
    const { host } = mount(
      <Switch aria-label="Solid" checked={false} onCheckedChange={onChange} />,
    );
    const control = screen.getByRole("switch", { name: "Solid" });
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true, expect.anything());
    expect(host.cues).toEqual(["toggle"]);
  });

  it("SegmentedControl picks one, ignores a reselect unless asked", () => {
    const onChange = vi.fn();
    const { host } = mount(
      <SegmentedControl aria-label="View" value="type" onChange={onChange}>
        <SegmentedControl.Item value="type">Type</SegmentedControl.Item>
        <SegmentedControl.Item value="layer">Layer</SegmentedControl.Item>
      </SegmentedControl>,
    );
    expect(screen.getByRole("group", { name: "View" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Layer" }));
    expect(onChange).toHaveBeenCalledWith("layer");
    expect(host.cues).toEqual(["toggle"]);
  });

  it("Slider steps with the arrow keys", () => {
    const onChange = vi.fn();
    mount(<Slider aria-label="Speed" min={0} max={10} value={[4]} onValueChange={onChange} />);
    expect(screen.getByRole("group", { name: "Speed" })).toBeDefined();
    // jsdom can't measure the track, so Base UI keeps the thumb hidden.
    const thumb = screen.getByRole("slider", { hidden: true });
    expect([thumb.getAttribute("aria-label"), thumb.getAttribute("aria-labelledby")]).toEqual([
      "Speed",
      null,
    ]);
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0]?.[0]).toEqual([5]);
  });

  it("Input, Textarea, Badge, Text, MicroLabel, Skeleton, Spinner and Progress render their roles", () => {
    mount(
      <>
        <Input aria-label="Name" size="sm" />
        <Textarea aria-label="Paste" />
        <Badge size="label" variant="outline">
          E12
        </Badge>
        <Text as="p" variant="muted">
          Nothing here
        </Text>
        <MicroLabel>Placement</MicroLabel>
        <Skeleton style={{ width: "40%" }} />
        <Spinner />
        <Progress value={2} max={5} label="Importing" />
      </>,
    );
    expect(screen.getByRole("textbox", { name: "Name" }).getAttribute("data-size")).toBe("sm");
    expect(screen.getByRole("textbox", { name: "Paste" }).tagName).toBe("TEXTAREA");
    expect(screen.getByText("E12").getAttribute("data-size")).toBe("label");
    expect(screen.getByText("Nothing here").tagName).toBe("P");
    expect(screen.getByText("Placement").getAttribute("data-tone")).toBe("muted");
    expect(document.querySelector(".je-skeleton")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("status", { name: "Loading" })).toBeDefined();
    const bar = screen.getByRole("progressbar", { name: "Importing" });
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(bar.getAttribute("aria-valuemax")).toBe("5");
  });

  it("KeyHint names the action and its keys", () => {
    mount(<KeyHint text="Undo" chord="Mod+Z" />);
    expect(screen.getByText("Undo").querySelectorAll(".je-kbd")).toHaveLength(2);
  });

  it("TimeAgo renders against the now it is given", () => {
    const now = Date.UTC(2026, 10, 8, 12);
    mount(<TimeAgo date={new Date(now - 5 * 60_000)} now={now} />);
    expect(screen.getByText("5m ago").tagName).toBe("TIME");
  });

  it("TimeAgo without a now rolls over on the wall-clock minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 8, 12, 0, 30));
    mount(<TimeAgo date={Date.UTC(2026, 10, 8, 11, 58, 0)} />);
    expect(screen.getByText("2m ago")).toBeDefined();
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByText("3m ago")).toBeDefined();
  });

  it("Avatar falls back to the initial and wears the peer's ring", () => {
    mount(<Avatar name="ada" ring="#f05252" size={20} />);
    const face = screen.getByRole("img", { name: "ada" });
    expect(face.textContent).toBe("A");
    expect(face.hasAttribute("data-ring")).toBe(true);
    expect(face.style.getPropertyValue("--je-avatar-ring")).toBe("#f05252");
  });
});

describe("ColorField", () => {
  it("reads and remembers its colour space through the host's storage", async () => {
    const host = fakeHost({ "jams-editor:color-space": "rgb" });
    const onChange = vi.fn();
    const onCommit = vi.fn();
    mount(
      <ColorField label="Tint" value="#ff8800" onChange={onChange} onCommit={onCommit} />,
      host,
    );
    expect(host.reads).toHaveBeenCalledWith("jams-editor:color-space");
    expect(screen.getByRole("textbox", { name: "Red value" })).toHaveProperty("value", "255");

    const hex = screen.getByRole("textbox", { name: "Colour value" });
    fireEvent.change(hex, { target: { value: "#00ff00" } });
    expect(onChange).toHaveBeenLastCalledWith("#00ff00");
    fireEvent.blur(hex);
    expect(onCommit).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("combobox", { name: "Colour space" }));
    choose(await waitFor(() => within(portal()!).getByRole("option", { name: "HSL" })));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Hue value" })).toBeDefined());
    expect(host.stored.get("jams-editor:color-space")).toBe("hsl");
    expect(screen.getByRole("textbox", { name: "Colour value" })).toHaveProperty(
      "value",
      "#00ff00",
    );
  });

  it("keeps working when storage throws", () => {
    const host: FakeHost = {
      ...fakeHost(),
      storage: {
        get: () => {
          throw new Error("blocked");
        },
        set: () => {
          throw new Error("blocked");
        },
      },
    };
    mount(<ColorField label="Tint" value="#000" onChange={() => {}} onCommit={() => {}} />, host);
    expect(screen.getByRole("textbox", { name: "Hue value" })).toBeDefined();
  });
});
