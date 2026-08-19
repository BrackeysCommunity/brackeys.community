// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vite-plus/test";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const onChange = vi.fn();

afterEach(() => {
  cleanup();
  onChange.mockClear();
});

/**
 * An optional field renders an item whose value is `null` as its way back to
 * unset; the profile's commitment and rate selects are built on it.
 */
function Probe() {
  const [value, setValue] = useState<string | null>("limited");
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        const next = typeof v === "string" ? v : null;
        setValue(next);
        onChange(next);
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="— select —">{value ? "Limited" : null}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={null}>Not set</SelectItem>
        <SelectItem value="limited">Limited</SelectItem>
        <SelectItem value="other">Other</SelectItem>
      </SelectContent>
    </Select>
  );
}

async function pick(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name }));
}

it("picking an item reports its value", async () => {
  render(<Probe />);

  await pick("Other");

  await waitFor(() => expect(onChange).toHaveBeenCalledWith("other"));
});

it("a null item clears the selection back to the placeholder", async () => {
  render(<Probe />);
  expect(screen.getByText("Limited")).toBeTruthy();

  await pick("Not set");

  await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
  await waitFor(() => expect(screen.getByText("— select —")).toBeTruthy());
});
