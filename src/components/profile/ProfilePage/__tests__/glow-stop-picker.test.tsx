// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { GlowStopPicker } from "@/components/profile/ProfilePage/GlowStopPicker";

afterEach(cleanup);

/** Mirrors the flyout: the picker is controlled, and the hex is the store. */
function Probe({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <GlowStopPicker
        index={0}
        value={value}
        onChange={setValue}
        onCommit={() => {}}
        onRemove={() => {}}
      />
      <output data-testid="hex">{value}</output>
    </>
  );
}

/** The label sits on the group wrapper; the range input inside it is the
 *  thing that actually carries the value. */
function knob(label: string) {
  return within(screen.getByRole("group", { name: label })).getByRole("slider");
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Colour 1" }));
}

describe("editing one gradient stop", () => {
  it("opens on the stop's own colour", async () => {
    const user = userEvent.setup();
    // #4f9dd9 is a mid blue: hue ~205, saturation ~64%, lightness ~64%.
    render(<Probe initial="#4f9dd9" />);
    await open(user);

    expect(Number(knob("HUE").getAttribute("aria-valuenow"))).toBeCloseTo(205, -1);
  });

  // The regression this guards: HSL was re-derived from the hex on every
  // render, and hue is unrecoverable from a grey — so taking saturation to
  // zero snapped the hue knob back to red and changed the colour on the way
  // back up.
  it("keeps hue while saturation goes to zero and back", async () => {
    const user = userEvent.setup();
    render(<Probe initial="#4f9dd9" />);
    await open(user);

    const hueBefore = knob("HUE").getAttribute("aria-valuenow");

    const saturation = knob("SATURATION");
    saturation.focus();
    await user.keyboard("{Home}");
    expect(saturation.getAttribute("aria-valuenow")).toBe("0");
    expect(knob("HUE").getAttribute("aria-valuenow")).toBe(hueBefore);

    await user.keyboard("{End}");
    expect(knob("HUE").getAttribute("aria-valuenow")).toBe(hueBefore);
  });

  it("does not drift the other knobs when one moves", async () => {
    const user = userEvent.setup();
    render(<Probe initial="#4f9dd9" />);
    await open(user);

    const hue = knob("HUE").getAttribute("aria-valuenow");
    const lightness = knob("LIGHTNESS").getAttribute("aria-valuenow");

    const saturation = knob("SATURATION");
    saturation.focus();
    for (let i = 0; i < 5; i++) await user.keyboard("{ArrowLeft}");

    expect(knob("HUE").getAttribute("aria-valuenow")).toBe(hue);
    expect(knob("LIGHTNESS").getAttribute("aria-valuenow")).toBe(lightness);
  });

  // The band is the whole reason this picker exists instead of the native
  // control: it can only express colours the site will actually paint.
  it("won't let lightness leave the legible band", async () => {
    const user = userEvent.setup();
    render(<Probe initial="#4f9dd9" />);
    await open(user);

    const lightness = knob("LIGHTNESS");
    lightness.focus();
    await user.keyboard("{Home}");
    expect(Number(lightness.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(45);

    await user.keyboard("{End}");
    expect(Number(lightness.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(72);
  });
});
