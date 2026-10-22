import { cleanup, render } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const { TermsDocument } = await import("@/components/legal/TermsDocument");
const { CONTACT, SITE } = await import("@/lib/legal-meta");

afterEach(cleanup);

describe("the terms' canvases clause", () => {
  it("covers ownership, the display licence for open canvases, and copies already exported", () => {
    const { container } = render(<TermsDocument />);
    const clause = container.querySelector("#canvases");
    expect(clause).not.toBeNull();
    const text = clause!.textContent!.replace(/\s+/g, " ");
    expect(text).toMatch(/keep ownership/);
    expect(text).toMatch(/public/);
    expect(text).toMatch(/license/);
    expect(text).toMatch(/has exported is outside our control/);
    expect(text).toMatch(/team's owners decide how widely/);
    expect(text).toMatch(/may narrow that/);
    expect(text).toContain(`report a public or unlisted canvas on ${SITE.name}`);
    expect(text).toMatch(/hide a canvas that breaches these Terms/);
    expect(clause!.querySelector(`a[href="mailto:${CONTACT.abuse}"]`)).not.toBeNull();
    // The anchor doesn't collide with a section id.
    expect(container.querySelectorAll("#canvases")).toHaveLength(1);
  });
});
