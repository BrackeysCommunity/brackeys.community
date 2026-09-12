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

describe("Confirm (body)", () => {
  it("keeps a block message out of the description paragraph and dims even when nested", () => {
    render(
      <Confirm
        open
        title="Remove @ada?"
        message={
          <label>
            Reason <input />
          </label>
        }
        onConfirm={() => {}}
      />,
    );
    // A `<div>` inside the description's `<p>` is invalid markup, so block
    // content renders beside the header rather than inside it.
    expect(document.querySelector('[data-slot="alert-dialog-description"]')).toBeNull();
    expect(screen.getByLabelText("Reason")).toBeDefined();
    // The backdrop is forced: Base UI would otherwise drop it for a dialog
    // opened over another dialog, which is where most confirms live.
    expect(document.querySelector('[data-slot="alert-dialog-overlay"]')).not.toBeNull();
  });
});

describe("Confirm (controlled)", () => {
  it("opens without a trigger, holds the action until the caller enables it, and reports close", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Confirm
        open
        onOpenChange={onOpenChange}
        title="Remove @ada?"
        confirmText="REMOVE"
        confirmDisabled
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText("Remove @ada?")).toBeDefined();
    const action = screen.getByRole("button", { name: "REMOVE" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);

    rerender(
      <Confirm
        open
        onOpenChange={onOpenChange}
        title="Remove @ada?"
        confirmText="REMOVE"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "REMOVE" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    // A confirmed dialog asks its owner to close it; it never closes itself.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("openConfirmModal", () => {
  it("resolves true on confirm and false on cancel", async () => {
    render(<ConfirmPortal />);

    const first = openConfirmModal({ title: "Save changes?", confirmText: "SAVE" });
    fireEvent.click(await screen.findByRole("button", { name: "SAVE" }));
    await expect(first).resolves.toBe(true);

    const second = openConfirmModal({ title: "Save changes?" });
    fireEvent.click(await screen.findByRole("button", { name: "CANCEL" }));
    await expect(second).resolves.toBe(false);

    await waitFor(() => expect(screen.queryByText("Save changes?")).toBeNull());
  });
});
