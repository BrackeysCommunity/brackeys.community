// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { Censored } from "@/components/ui/typography/censored";
import { AppSettingsProvider } from "@/lib/hooks/use-app-settings";

function renderCensored(text: string) {
  return render(
    <AppSettingsProvider>
      <p>
        <Censored>{text}</Censored>
      </p>
    </AppSettingsProvider>,
  );
}

afterEach(cleanup);

describe("Censored", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("marks each censored run so it can carry the explanation", () => {
    const { container } = renderCensored("this shit is broken");
    const marks = container.querySelectorAll("[data-slot=censored]");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe("****");
    expect(container.textContent).toBe("this **** is broken");
  });

  it("adds no marks to clean text", () => {
    const { container } = renderCensored("all good here");
    expect(container.querySelectorAll("[data-slot=censored]")).toHaveLength(0);
    expect(container.textContent).toBe("all good here");
  });

  it("renders as written once the viewer has opted out", () => {
    localStorage.setItem("brackeys-censor-profanity", "0");
    const { container } = renderCensored("this shit is broken");
    expect(container.querySelectorAll("[data-slot=censored]")).toHaveLength(0);
    expect(container.textContent).toBe("this shit is broken");
  });
});
