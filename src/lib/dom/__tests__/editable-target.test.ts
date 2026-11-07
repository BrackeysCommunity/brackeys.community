// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";

import { inOverlay, isEditableTarget } from "../editable-target";

afterEach(() => document.body.replaceChildren());

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.querySelector("[data-at]")!;
}

describe("isEditableTarget", () => {
  it("is true in fields, contenteditable and CodeMirror, and false elsewhere", () => {
    expect(isEditableTarget(mount(`<input data-at>`))).toBe(true);
    expect(isEditableTarget(mount(`<textarea data-at></textarea>`))).toBe(true);
    expect(isEditableTarget(mount(`<select data-at></select>`))).toBe(true);
    expect(isEditableTarget(mount(`<div contenteditable="true"><b data-at>x</b></div>`))).toBe(
      true,
    );
    expect(isEditableTarget(mount(`<div class="cm-editor"><span data-at></span></div>`))).toBe(
      true,
    );
    expect(isEditableTarget(mount(`<div contenteditable="false"><b data-at>x</b></div>`))).toBe(
      false,
    );
    expect(isEditableTarget(mount(`<button data-at></button>`))).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("inOverlay", () => {
  it("finds a menu, dialog or popover around the target, or around focus by default", () => {
    expect(inOverlay(mount(`<div role="dialog"><button data-at></button></div>`))).toBe(true);
    expect(inOverlay(mount(`<div role="alertdialog"><button data-at></button></div>`))).toBe(true);
    expect(inOverlay(mount(`<div data-slot="popover-content"><i data-at></i></div>`))).toBe(true);
    const plain = mount(`<button data-at></button>`);
    expect(inOverlay(plain)).toBe(false);

    const item = mount(`<div role="menu"><button data-at></button></div>`);
    item.focus();
    expect(inOverlay()).toBe(true);
    plain.remove();
  });
});
