import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ReportDialog } from "@/components/ui/report-dialog";

afterEach(cleanup);

function openWith(onSubmit: (reason: string) => void | Promise<unknown>) {
  render(
    <ReportDialog title="Report this post?" submitText="SEND REPORT" onSubmit={onSubmit}>
      <button type="button">REPORT</button>
    </ReportDialog>,
  );
  fireEvent.click(screen.getByRole("button", { name: "REPORT" }));
  return screen.getByRole("textbox");
}

describe("ReportDialog", () => {
  it("submits the trimmed reason", async () => {
    const onSubmit = vi.fn();
    const reason = openWith(onSubmit);

    fireEvent.change(reason, { target: { value: "  spam  " } });
    fireEvent.click(screen.getByRole("button", { name: "SEND REPORT" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("spam"));
  });

  it("keeps submit disabled until a reason is typed", () => {
    const onSubmit = vi.fn();
    const reason = openWith(onSubmit);

    const submit = screen.getByRole("button", { name: "SEND REPORT" });
    expect(submit.getAttribute("disabled")).not.toBeNull();

    fireEvent.change(reason, { target: { value: "harassment" } });
    expect(submit.getAttribute("disabled")).toBeNull();
  });

  it("stays open with the reason intact when the submit rejects", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("You've already reported this post."));
    const reason = openWith(onSubmit);

    fireEvent.change(reason, { target: { value: "harassment" } });
    fireEvent.click(screen.getByRole("button", { name: "SEND REPORT" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(screen.getByText("Report this post?")).toBeDefined();
    expect(screen.getByRole("textbox")).toHaveProperty("value", "harassment");
  });

  it("clears the reason after a successful submit", async () => {
    const onSubmit = vi.fn();
    const reason = openWith(onSubmit);

    fireEvent.change(reason, { target: { value: "spam" } });
    fireEvent.click(screen.getByRole("button", { name: "SEND REPORT" }));
    await waitFor(() => expect(screen.queryByText("Report this post?")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "REPORT" }));
    expect(screen.getByRole("textbox")).toHaveProperty("value", "");
  });
});
