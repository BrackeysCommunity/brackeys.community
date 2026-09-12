import { cleanup, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";

import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";

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
