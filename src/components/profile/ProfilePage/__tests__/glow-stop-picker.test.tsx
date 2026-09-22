// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { GlowStopPicker } from "@/components/profile/ProfilePage/GlowStopPicker";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

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

  it("lets lightness go all the way, with nothing pulled back", async () => {
    const user = userEvent.setup();
    render(<Probe initial="#4f9dd9" />);
    await open(user);

    const lightness = knob("LIGHTNESS");
    lightness.focus();
    await user.keyboard("{Home}");
    expect(lightness.getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByTestId("hex").textContent).toBe("#000000");
  });
});

describe("going past sRGB", () => {
  it("stores an OKLCH pick beyond sRGB as oklch rather than clipping it", async () => {
    localStorage.setItem("brackeys:glow-colour-space", "oklch");
    const user = userEvent.setup();
    render(<Probe initial="#4f9dd9" />);
    await open(user);

    const chroma = screen.getByRole("textbox", { name: "CHROMA value" });
    await user.clear(chroma);
    await user.type(chroma, "0.4");
    expect(screen.getByTestId("hex").textContent).toMatch(/^oklch\([\d.]+% 0\.4 [\d.]+\)$/);
    expect(screen.getByText(/Beyond sRGB/)).toBeTruthy();
  });

  it("reopens on a stored oklch stop without losing it", async () => {
    localStorage.setItem("brackeys:glow-colour-space", "oklch");
    const user = userEvent.setup();
    render(<Probe initial="oklch(70% 0.4 150)" />);
    await open(user);

    expect((screen.getByRole("textbox", { name: "Colour value" }) as HTMLInputElement).value).toBe(
      "oklch(70% 0.4 150)",
    );
  });

  it("moves to OKLCH when a wide-gamut colour is pasted into an sRGB space", async () => {
    const user = userEvent.setup();
    render(<Probe initial="#4f9dd9" />);
    await open(user);

    const field = screen.getByRole("textbox", { name: "Colour value" });
    await user.clear(field);
    await user.type(field, "oklch(70% 0.4 150){Enter}");
    expect(screen.getByTestId("hex").textContent).toBe("oklch(70% 0.4 150)");
    expect(screen.getByRole("group", { name: "CHROMA" })).toBeTruthy();
  });
});

describe("slider value bubbles", () => {
  // Shown only while the thumb carries `data-dragging`; the content is what
  // matters here, the visibility is a CSS state.
  it("names each channel's value in the channel's own notation", async () => {
    localStorage.setItem("brackeys:glow-colour-space", "hex");
    const user = userEvent.setup();
    render(<Probe initial="#4f9dd9" />);
    await open(user);

    const bubble = screen
      .getByRole("group", { name: "RED" })
      .querySelector("[data-slot=slider-value-label]");
    expect(bubble?.textContent).toBe("4F");
  });
});

describe("typing and pasting values", () => {
  it("applies a pasted hex straight away, whatever space is showing", async () => {
    const user = userEvent.setup();
    render(<Probe initial="#4f9dd9" />);
    await open(user);

    const field = screen.getByRole("textbox", { name: "Colour value" });
    expect((field as HTMLInputElement).value).toBe("hsl(206, 64%, 58%)");

    await user.clear(field);
    await user.type(field, "#7f5af0");
    expect(screen.getByTestId("hex").textContent).toBe("#7f5af0");
    expect(Number(knob("HUE").getAttribute("aria-valuenow"))).toBeCloseTo(255, 0);

    await user.tab();
    expect((field as HTMLInputElement).value).toBe("hsl(255, 83%, 65%)");
  });

  it("reads engine notation too", async () => {
    const user = userEvent.setup();
    render(<Probe initial="#4f9dd9" />);
    await open(user);

    const field = screen.getByRole("textbox", { name: "Colour value" });
    fireEvent.change(field, { target: { value: "new Color(1f, 0f, 0f)" } });
    expect(screen.getByTestId("hex").textContent).toBe("#ff0000");
  });

  it("marks a value it can't read once the member leaves the field", async () => {
    const user = userEvent.setup();
    render(<Probe initial="#4f9dd9" />);
    await open(user);

    const field = screen.getByRole("textbox", { name: "Colour value" });
    await user.clear(field);
    await user.type(field, "blurple");
    expect(field.getAttribute("aria-invalid")).toBeNull();
    await user.tab();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByTestId("hex").textContent).toBe("#4f9dd9");
  });

  it("sets a channel from its number box", async () => {
    const user = userEvent.setup();
    render(<Probe initial="#4f9dd9" />);
    await open(user);

    const hue = screen.getByRole("textbox", { name: "HUE value" });
    await user.clear(hue);
    await user.type(hue, "0");
    expect(knob("HUE").getAttribute("aria-valuenow")).toBe("0");

    // Hue comes round rather than stopping at the ends.
    await user.keyboard("{ArrowDown}");
    expect(knob("HUE").getAttribute("aria-valuenow")).toBe("359");
  });

  it("clamps a typed channel to its range", async () => {
    const user = userEvent.setup();
    render(<Probe initial="#4f9dd9" />);
    await open(user);

    const saturation = screen.getByRole("textbox", { name: "SATURATION value" });
    await user.clear(saturation);
    await user.type(saturation, "400");
    expect(knob("SATURATION").getAttribute("aria-valuenow")).toBe("100");
  });
});

describe("switching colour space", () => {
  it("carries the colour across and remembers the choice", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Probe initial="#4f9dd9" />);
    await open(user);

    await user.click(screen.getByRole("combobox", { name: "Colour space" }));
    await user.click(await screen.findByRole("option", { name: /^RGB/ }));

    expect(knob("RED").getAttribute("aria-valuenow")).toBe("79");
    expect(knob("GREEN").getAttribute("aria-valuenow")).toBe("157");
    expect(knob("BLUE").getAttribute("aria-valuenow")).toBe("217");
    expect(screen.getByTestId("hex").textContent).toBe("#4f9dd9");

    unmount();
    render(<Probe initial="#4f9dd9" />);
    await open(user);
    expect(screen.getByRole("group", { name: "RED" })).toBeTruthy();
  });

  it("shows hex channels as hex", async () => {
    localStorage.setItem("brackeys:glow-colour-space", "hex");
    const user = userEvent.setup();
    render(<Probe initial="#4f9dd9" />);
    await open(user);

    expect((screen.getByRole("textbox", { name: "RED value" }) as HTMLInputElement).value).toBe(
      "4F",
    );
  });
});
