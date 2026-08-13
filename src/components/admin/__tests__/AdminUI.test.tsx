import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { AdminPager, CategoryCombobox } from "@/components/admin/AdminUI";

afterEach(cleanup);

function CategoryHarness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <CategoryCombobox
        id="cat"
        value={value}
        onChange={setValue}
        categories={["Art", "Programming", "Production"]}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe("CategoryCombobox", () => {
  it("accepts a category that isn't in the list yet", async () => {
    const user = userEvent.setup();
    render(<CategoryHarness />);
    await user.type(screen.getByRole("combobox"), "Narrative");
    expect(screen.getByTestId("value").textContent).toBe("Narrative");
  });

  it("picks an existing category from the suggestions", async () => {
    const user = userEvent.setup();
    render(<CategoryHarness />);
    await user.type(screen.getByRole("combobox"), "Prog");

    await user.click(await screen.findByRole("option", { name: "Programming" }));

    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("Programming"));
  });
});

describe("AdminPager", () => {
  it("reports the visible slice and clamps at both ends", () => {
    const onPage = vi.fn();
    const { rerender } = render(
      <AdminPager
        page={1}
        pageCount={3}
        total={25}
        pageSize={10}
        unit="requests"
        onPage={onPage}
      />,
    );

    expect(screen.getByText(/1–10 OF 25 REQUESTS/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Previous page" }).getAttribute("disabled")).not.toBe(
      null,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPage).toHaveBeenCalledWith(2);

    rerender(
      <AdminPager
        page={3}
        pageCount={3}
        total={25}
        pageSize={10}
        unit="requests"
        onPage={onPage}
      />,
    );
    expect(screen.getByText(/21–25 OF 25 REQUESTS/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Next page" }).getAttribute("disabled")).not.toBe(
      null,
    );
  });

  it("renders nothing for an empty queue", () => {
    const { container } = render(
      <AdminPager
        page={1}
        pageCount={1}
        total={0}
        pageSize={10}
        unit="requests"
        onPage={vi.fn()}
      />,
    );
    expect(container.firstChild).toBe(null);
  });
});
