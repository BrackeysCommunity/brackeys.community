// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  LicenceFields,
  withLicenceField,
} from "@/components/game/editor/project-tree/licence-fields";

import { hero, jump } from "./fixtures";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({ toast: { error: toastError } }));

afterEach(cleanup);

const form = () => within(screen.getByRole("region", { name: "Licence" }));

describe("withLicenceField", () => {
  it("sets a trimmed field, unsets a blank one and is null when nothing is left", () => {
    expect(withLicenceField(undefined, "spdx", " CC-BY-4.0 ")).toEqual({ spdx: "CC-BY-4.0" });
    expect(withLicenceField({ spdx: "MIT", author: "Ana" }, "author", "  ")).toEqual({
      spdx: "MIT",
    });
    expect(withLicenceField({ spdx: "MIT" }, "spdx", "")).toBeNull();
  });
});

describe("LicenceFields", () => {
  it("shows the licence, author, source and credit line", () => {
    render(<LicenceFields entry={jump} />);
    expect(form().getByLabelText<HTMLInputElement>("Licence").value).toBe("CC0-1.0");
    expect(form().getByLabelText<HTMLInputElement>("Author").value).toBe("Ana");
    expect(form().getByLabelText<HTMLInputElement>("Source").value).toBe("");
    expect(form().getByLabelText<HTMLInputElement>("Credit").value).toBe("");
  });

  it("writes the whole licence on Enter or blur, and null once every field is cleared", async () => {
    const onLicence = vi.fn();
    const { rerender } = render(<LicenceFields entry={hero} onLicence={onLicence} />);
    const spdx = form().getByLabelText("Licence");
    expect(spdx.getAttribute("list")).toBeTruthy();
    fireEvent.change(spdx, { target: { value: "CC-BY-4.0" } });
    await act(async () => fireEvent.keyDown(spdx, { key: "Enter" }));
    expect(onLicence).toHaveBeenLastCalledWith(hero, { spdx: "CC-BY-4.0" });

    const licensed = { ...hero, licence: { spdx: "CC-BY-4.0" } };
    rerender(<LicenceFields entry={licensed} onLicence={onLicence} />);
    const credit = form().getByLabelText("Credit");
    fireEvent.change(credit, { target: { value: "Hero by Ana" } });
    await act(async () => fireEvent.blur(credit));
    expect(onLicence).toHaveBeenLastCalledWith(licensed, {
      spdx: "CC-BY-4.0",
      attribution: "Hero by Ana",
    });

    fireEvent.change(form().getByLabelText("Licence"), { target: { value: "" } });
    await act(async () => fireEvent.blur(form().getByLabelText("Licence")));
    expect(onLicence).toHaveBeenLastCalledWith(licensed, null);
    expect(onLicence).toHaveBeenCalledTimes(3);
  });

  it("skips an unchanged value, reverts on Escape and toasts a failed write", async () => {
    const onLicence = vi.fn().mockRejectedValue(new Error("read-only kind"));
    render(<LicenceFields entry={jump} onLicence={onLicence} />);
    const author = form().getByLabelText<HTMLInputElement>("Author");
    fireEvent.change(author, { target: { value: "Ana " } });
    fireEvent.blur(author);
    expect(onLicence).not.toHaveBeenCalled();

    fireEvent.change(author, { target: { value: "Bo" } });
    fireEvent.keyDown(author, { key: "Escape" });
    expect(author.value).toBe("Ana");

    fireEvent.change(author, { target: { value: "Bo" } });
    await act(async () => fireEvent.blur(author));
    expect(toastError).toHaveBeenCalledWith("read-only kind");
  });

  it("is read-only for viewers", () => {
    render(<LicenceFields entry={jump} readOnly onLicence={vi.fn()} />);
    expect(form().getByLabelText<HTMLInputElement>("Licence").readOnly).toBe(true);
    expect(form().getByLabelText("Licence").getAttribute("list")).toBeNull();
  });
});
