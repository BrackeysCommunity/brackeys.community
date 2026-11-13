// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { ChoiceGroup } from "../panels/publish/ChoiceGroup";

const CHOICES = ["now", "later"] as const;

function renderGroup(props: { disabled?: boolean; unavailable?: (c: string) => boolean } = {}) {
  return render(
    <ChoiceGroup
      legend="When"
      name="when"
      choices={CHOICES}
      value="now"
      label={(c) => c}
      disabled={props.disabled ?? false}
      unavailable={props.unavailable}
      onPick={() => {}}
    />,
  );
}

const toneOf = (text: string) => screen.getByText(text).getAttribute("data-tone");

afterEach(cleanup);

describe("ChoiceGroup", () => {
  it("reads every row at full strength while enabled", () => {
    renderGroup();
    expect(toneOf("now")).toBe("primary");
    expect(toneOf("later")).toBe("primary");
    expect(screen.getByRole("radiogroup").querySelector("label[data-disabled]")).toBeNull();
  });

  it("mutes every row while the whole group is disabled", () => {
    renderGroup({ disabled: true });
    expect(toneOf("now")).toBe("muted");
    expect(toneOf("later")).toBe("muted");
    for (const radio of screen.getAllByRole("radio"))
      expect(radio).toHaveProperty("disabled", true);
    expect(screen.getByRole("radiogroup").querySelectorAll("label[data-disabled]")).toHaveLength(2);
  });

  it("mutes only the unavailable row while enabled", () => {
    renderGroup({ unavailable: (c) => c === "later" });
    expect(toneOf("now")).toBe("primary");
    expect(toneOf("later")).toBe("muted");
  });

  it("scopes its disabled-row style to its own class", () => {
    renderGroup();
    expect(screen.getByRole("radiogroup").classList.contains("je-choice-group")).toBe(true);
    const css = readFileSync(join(import.meta.dirname, "../style.css"), "utf8");
    expect(css).toContain(".je-choice-group label[data-disabled]");
    expect(css).not.toMatch(/^\s*\[role="radiogroup"\]/m);
  });
});
