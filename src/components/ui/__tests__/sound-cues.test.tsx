import { cleanup, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

afterEach(cleanup);

/** The cue attributes, as the DOM ends up carrying them. */
function cues(el: Element) {
  return {
    hover: el.getAttribute("data-cuelume-hover"),
    press: el.getAttribute("data-cuelume-press"),
    release: el.getAttribute("data-cuelume-release"),
    toggle: el.getAttribute("data-cuelume-toggle"),
    pullAway: el.getAttribute("data-sound-pull-away"),
  };
}

describe("interaction cue attributes", () => {
  it("gives an ordinary button the press/release pair", () => {
    render(<Button>Save</Button>);

    expect(cues(screen.getByRole("button", { name: "Save" }))).toEqual({
      hover: "tick",
      press: "",
      release: "",
      toggle: null,
      pullAway: "",
    });
  });

  it("swaps a destructive button onto the error tone and a heavier pull-away", () => {
    render(<Button variant="destructive">Delete</Button>);

    expect(cues(screen.getByRole("button", { name: "Delete" }))).toEqual({
      hover: "tick",
      press: null,
      release: null,
      toggle: "error",
      pullAway: "droplet",
    });
  });

  // The load-bearing case: the trigger's cues have to survive Base UI's
  // `render` merge and beat the cues the Button spreads on itself, or the
  // click would sound press + release + page all at once.
  it("resolves a dropdown trigger rendered as a Button to a single page cue", () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" />}>Open</DropdownMenuTrigger>
      </DropdownMenu>,
    );

    expect(cues(screen.getByRole("button", { name: "Open" }))).toEqual({
      hover: "tick",
      press: null,
      release: null,
      toggle: "page",
      pullAway: "",
    });
  });

  it("gives menu items the toggle cue, and destructive ones the error tone", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(screen.getByText("Rename").getAttribute("data-cuelume-toggle")).toBe("");
    expect(screen.getByText("Delete").getAttribute("data-cuelume-toggle")).toBe("error");
  });
});
