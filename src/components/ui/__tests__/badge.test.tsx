// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { Badge } from "@/components/ui/badge";

afterEach(cleanup);

function badge() {
  return screen.getByText("RANK");
}

describe("Badge", () => {
  it("keeps the raised pad by default", () => {
    render(<Badge>RANK</Badge>);
    expect(badge().className).toContain("chonk-emboss");
  });

  it("drops the pad but keeps the fill when flat", () => {
    render(<Badge flat>RANK</Badge>);
    expect(badge().className).not.toContain("chonk-emboss");
    expect(badge().className).toContain("bg-primary");
  });

  it("still suppresses the hover lift on a flat badge", () => {
    render(<Badge flat>RANK</Badge>);
    expect(badge().className).toContain("pointer-events-none");
  });

  it("leaves the fill-less variants alone", () => {
    render(<Badge variant="ghost">RANK</Badge>);
    expect(badge().className).not.toContain("chonk-emboss");
  });
});
