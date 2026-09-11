// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { TagPickerPanel } from "@/components/collab/CollabCreateFlyout/TagPickerPanel";
import { PortalContainerProvider } from "@/components/ui/portal-container";

afterEach(cleanup);

const OPTIONS = [
  { id: 1, name: "Pixel artist", category: "Art" },
  { id: 2, name: "3D artist", category: "Art" },
  { id: 3, name: "Gameplay programmer", category: "Code" },
  { id: 4, name: "Composer", category: "Audio" },
];

function Probe({ max, initial = [] }: { max?: number; initial?: number[] }) {
  const [ids, setIds] = useState<number[]>(initial);
  return (
    <TagPickerPanel
      label="WHO YOU NEED"
      options={OPTIONS}
      selectedIds={ids}
      onChange={setIds}
      searchPlaceholder="Search roles…"
      emptyMessage="No roles available."
      max={max}
      atCapMessage="That's the limit — remove one to add another."
    />
  );
}

function list() {
  return screen.getByRole("listbox", { name: "WHO YOU NEED" });
}

describe("the catalogue a cold start sees", () => {
  // SALTYSWEET: "what if i don't know exactly who/what i am looking for?"
  // The panel used to render nothing at all until a query existed.
  it("shows every category on focus, with the entries behind a disclosure", async () => {
    const user = userEvent.setup();
    render(<Probe />);

    await user.click(screen.getByPlaceholderText("Search roles…"));

    for (const category of ["Art", "Code", "Audio"]) {
      expect(within(list()).getByRole("button", { name: new RegExp(category) })).toBeDefined();
    }
    expect(within(list()).queryByText("Pixel artist")).toBeNull();

    await user.click(within(list()).getByRole("button", { name: /Art/ }));
    expect(within(list()).getByText("Pixel artist")).toBeDefined();
    expect(within(list()).queryByText("Composer")).toBeNull();
  });

  it("opens the groups a search still matches, without a second click", async () => {
    const user = userEvent.setup();
    render(<Probe />);

    await user.click(screen.getByPlaceholderText("Search roles…"));
    await user.type(screen.getByPlaceholderText("Search roles…"), "artist");

    expect(within(list()).getByText("Pixel artist")).toBeDefined();
    expect(within(list()).getByText("3D artist")).toBeDefined();
    expect(within(list()).queryByRole("button", { name: /Code/ })).toBeNull();
  });

  // Without this the Escape reached the dialog and shut the whole wizard.
  it("eats the first Escape itself", async () => {
    const user = userEvent.setup();
    const outer: string[] = [];
    render(
      <div role="presentation" onKeyDown={(e) => outer.push(e.key)}>
        <Probe />
      </div>,
    );

    await user.click(screen.getByPlaceholderText("Search roles…"));
    await user.type(screen.getByPlaceholderText("Search roles…"), "art");
    outer.length = 0;

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(outer).toEqual([]);

    await user.keyboard("{Escape}");
    expect(outer).toEqual(["Escape"]);
  });

  it("closes when the field loses focus", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Probe />
        <button type="button">elsewhere</button>
      </>,
    );

    await user.click(screen.getByPlaceholderText("Search roles…"));
    expect(screen.queryByRole("listbox")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("where the list is rendered", () => {
  // Cookie: "i have to scroll down the whole page here to see the dropdown
  // even though there's so much empty space below it." In flow, the modal
  // body's own `overflow-y-auto` clipped it.
  it("portals out of the field when nothing traps focus", async () => {
    const user = userEvent.setup();
    const { container } = render(<Probe />);

    await user.click(screen.getByPlaceholderText("Search roles…"));
    expect(container.contains(list())).toBe(false);
    expect(document.body.contains(list())).toBe(true);
  });

  // vaul's `transform` makes `position: fixed` resolve against the drawer
  // instead of the viewport, so the drawer keeps the in-flow variant.
  it("stays in flow inside a focus-trapping drawer", async () => {
    const user = userEvent.setup();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { container } = render(
      <PortalContainerProvider value={host}>
        <Probe />
      </PortalContainerProvider>,
    );

    await user.click(screen.getByPlaceholderText("Search roles…"));
    expect(container.contains(list())).toBe(true);
  });
});

describe("the selection cap", () => {
  // `roleIds` has always been `.max(20)` on the server while the roles
  // picker passed no cap at all, so the 21st pick published as
  // "Input validation failed".
  it("refuses a pick past the cap and says so", async () => {
    const user = userEvent.setup();
    render(<Probe max={1} initial={[1]} />);

    expect(screen.getByText("That's the limit — remove one to add another.")).toBeDefined();

    await user.click(screen.getByPlaceholderText("Search roles…"));
    await user.click(within(list()).getByRole("button", { name: /Code/ }));
    expect(within(list()).getByRole("option", { name: /Gameplay programmer/ })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("still lets an already-picked entry come back off", async () => {
    const user = userEvent.setup();
    render(<Probe max={1} initial={[1]} />);

    await user.click(screen.getByRole("button", { name: "Remove Pixel artist" }));
    expect(screen.queryByText("That's the limit — remove one to add another.")).toBeNull();
  });
});
