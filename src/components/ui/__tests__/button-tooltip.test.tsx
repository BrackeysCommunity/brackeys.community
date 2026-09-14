import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";

import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { SimpleTooltip } from "@/components/ui/tooltip";

afterEach(cleanup);

describe("Button tooltip", () => {
  it("renders a single button with no native title", () => {
    render(
      <Button tooltip="Block member" aria-label="Block member">
        x
      </Button>,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute("title")).toBeNull();
  });

  // The chonk rule that holds a menu trigger down while its menu is open
  // keys off `data-pressed`. Base UI marks an open tooltip's trigger
  // `data-popup-open` as well, so if that rule ever goes back to keying off
  // the broader attribute, a button sinks under its own hint as though it
  // had been clicked.
  it("an open tooltip leaves its trigger unpressed", async () => {
    const user = userEvent.setup();
    render(
      // `delay={0}` only to keep the test quick — the path is the one
      // `Button tooltip=` takes.
      <SimpleTooltip content="Block member" delay={0}>
        <Button aria-label="Block member">x</Button>
      </SimpleTooltip>,
    );
    const button = screen.getByRole("button");

    await user.hover(button);
    await waitFor(() => expect(button.hasAttribute("data-popup-open")).toBe(true));
    expect(button.hasAttribute("data-pressed")).toBe(false);
  });

  it("still works as a render-prop trigger", () => {
    render(
      <Confirm title="Sure?" onConfirm={() => {}}>
        <Button tooltip="Remove" aria-label="Remove">
          x
        </Button>
      </Confirm>,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
