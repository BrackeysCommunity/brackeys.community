// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { SIGNED_OUT_SAVES_DESCRIBE } from "@/lib/engine/local-saves";
import { SIGNED_IN_SAVES_DESCRIBE } from "@/lib/engine/save-api";
import { SITE } from "@/lib/legal-meta";

import { SaveNotice } from "../SaveNotice";

afterEach(cleanup);

const PREFS =
  "Key bindings, volume, language and caption settings stay in this browser and are never uploaded.";

function text(el: HTMLElement): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("SaveNotice", () => {
  it("site, signed in: the account's sentence alone, then the preferences", () => {
    const { container } = render(<SaveNotice mode="site" connectOrigins={[]} signedIn />);
    const body = text(container);
    expect(body).toBe(`Saves. ${SIGNED_IN_SAVES_DESCRIBE} ${PREFS}`);
    expect(body).toContain("up to 4 saves of 32 KB for this game");
    expect(body).not.toContain(SIGNED_OUT_SAVES_DESCRIBE);
  });

  it("site, signed out: this browser's sentence alone, then the preferences", () => {
    const { container } = render(<SaveNotice mode="site" connectOrigins={[]} signedIn={false} />);
    const body = text(container);
    expect(body).toBe(`Saves. ${SIGNED_OUT_SAVES_DESCRIBE} ${PREFS}`);
    expect(body).not.toContain(SIGNED_IN_SAVES_DESCRIBE);
  });

  it("own: names the game's own servers", () => {
    const origins = ["https://saves.example.test", "https://api.example.test"];
    const { container } = render(
      <SaveNotice mode="own" connectOrigins={origins} signedIn={false} />,
    );
    const body = text(container);
    expect(body).toContain(
      `Saves. This game keeps its saves on its own servers (https://saves.example.test, https://api.example.test). ${SITE.name} doesn't store or control them.`,
    );
    expect(body).toContain(PREFS);
    expect(body).toContain(
      "This game connects to: https://saves.example.test, https://api.example.test. Those sites' own terms apply to what you send them.",
    );
  });

  it("none: says the game doesn't save", () => {
    const { container } = render(<SaveNotice mode="none" connectOrigins={[]} signedIn />);
    const body = text(container);
    expect(body).toContain("Saves. This game doesn't save progress.");
    expect(body).toContain(PREFS);
    expect(body).not.toContain(SITE.name);
  });

  it("lists connect origins for any mode", () => {
    const { container } = render(
      <SaveNotice
        mode="site"
        connectOrigins={["https://leaderboard.example.test"]}
        signedIn={false}
      />,
    );
    expect(text(container)).toContain(
      "This game connects to: https://leaderboard.example.test. Those sites' own terms apply to what you send them.",
    );
  });

  it("is the one paragraph under the play page's Saves menu", () => {
    const { container } = render(<SaveNotice mode="site" connectOrigins={[]} signedIn />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(text(container).match(/Saved to your/g)).toHaveLength(1);
  });
});
