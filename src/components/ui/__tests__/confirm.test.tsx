import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Confirm, ConfirmPortal, openConfirmModal } from "@/components/ui/confirm";

afterEach(cleanup);

/** Mirrors action buttons like CommentThread's CommentAction: a function
 * component that spreads incoming props onto its DOM button, which is what
 * lets it serve as a Confirm trigger. */
function SpreadButton({ label, ...props }: { label: string } & React.ComponentProps<"button">) {
  return (
    <button type="button" {...props}>
      {label}
    </button>
  );
}

describe("Confirm", () => {
  it("opens the dialog and only fires onConfirm on confirm", async () => {
    const onConfirm = vi.fn();
    render(
      <Confirm title="Remove this comment?" confirmText="REMOVE" onConfirm={onConfirm}>
        <button type="button">DELETE</button>
      </Confirm>,
    );

    fireEvent.click(screen.getByRole("button", { name: "DELETE" }));
    expect(screen.getByText("Remove this comment?")).toBeDefined();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "REMOVE" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("triggers through a props-forwarding component", () => {
    const onConfirm = vi.fn();
    render(
      <Confirm title="Are you sure?" onConfirm={onConfirm}>
        <SpreadButton label="DELETE" />
      </Confirm>,
    );

    fireEvent.click(screen.getByRole("button", { name: "DELETE" }));
    expect(screen.getByText("Are you sure?")).toBeDefined();
  });

  it("bypass skips the dialog and calls onConfirm directly", () => {
    const onConfirm = vi.fn();
    render(
      <Confirm title="Block this member?" bypass onConfirm={onConfirm}>
        <button type="button">UNBLOCK</button>
      </Confirm>,
    );

    fireEvent.click(screen.getByRole("button", { name: "UNBLOCK" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByText("Block this member?")).toBeNull();
  });
});

describe("openConfirmModal", () => {
  it("resolves true on confirm and false on cancel", async () => {
    render(<ConfirmPortal />);

    const first = openConfirmModal({ title: "Save changes?", confirmText: "SAVE" });
    fireEvent.click(await screen.findByRole("button", { name: "SAVE" }));
    await expect(first).resolves.toBe(true);

    const second = openConfirmModal({ title: "Save changes?" });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await expect(second).resolves.toBe(false);

    await waitFor(() => expect(screen.queryByText("Save changes?")).toBeNull());
  });
});
