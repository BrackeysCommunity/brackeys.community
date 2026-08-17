import { cleanup, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";

import { Button } from "@/components/ui/button";
import { Carousel, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PaginationNext } from "@/components/ui/pagination";

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

  // Same merge problem as the dropdown trigger: both of these are `Button`s
  // underneath, so the step cue only wins if it unseats press/release.
  it("resolves a pagination link to a single page cue", () => {
    render(<PaginationNext href="#" />);

    // An `<a>`, but Base UI's non-native Button stamps `role="button"` on it.
    expect(cues(screen.getByRole("button", { name: "Go to next page" }))).toEqual({
      hover: "tick",
      press: null,
      release: null,
      toggle: "page",
      pullAway: "",
    });
  });

  it("resolves the carousel arrows to a single page cue", () => {
    render(
      <Carousel>
        <CarouselPrevious />
        <CarouselNext />
      </Carousel>,
    );

    for (const name of ["Previous slide", "Next slide"]) {
      expect(cues(screen.getByRole("button", { name }))).toEqual({
        hover: "tick",
        press: null,
        release: null,
        toggle: "page",
        pullAway: "",
      });
    }
  });

  // The dismissal itself sounds from the dialog root, so the X has to stay
  // quiet on click or closing reads as press + release + droplet.
  it("leaves a dialog close button silent on click", () => {
    render(
      <Dialog open>
        <DialogContent>Body</DialogContent>
      </Dialog>,
    );

    expect(cues(screen.getByRole("button", { name: "Close" }))).toEqual({
      hover: "tick",
      press: null,
      release: null,
      toggle: null,
      pullAway: "",
    });
  });
});
