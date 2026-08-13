import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn<() => Promise<unknown>>(),
  resolveUserRoles: vi.fn<() => Promise<string[] | null>>(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));

vi.mock("@/lib/staff-roles", () => ({
  resolveUserRoles: mocks.resolveUserRoles,
}));

import { canViewReferenceDocs, isReferenceDocsPath } from "@/lib/api-reference-gate";

function docsRequest() {
  return new Request("http://localhost/api");
}

function session(overrides: Record<string, unknown> = {}) {
  return { user: { id: "u1", bannedAt: null, ...overrides } };
}

describe("isReferenceDocsPath", () => {
  it("matches the reference UI and generated spec", () => {
    expect(isReferenceDocsPath("/api")).toBe(true);
    expect(isReferenceDocsPath("/api/")).toBe(true);
    expect(isReferenceDocsPath("/api/spec.json")).toBe(true);
  });

  it("leaves procedure calls and upload handlers alone", () => {
    expect(isReferenceDocsPath("/api/listJams")).toBe(false);
    expect(isReferenceDocsPath("/api/rpc/listJams")).toBe(false);
    expect(isReferenceDocsPath("/api/profile/project-image")).toBe(false);
  });
});

describe("canViewReferenceDocs", () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.resolveUserRoles.mockReset();
  });

  it("denies anonymous requests", async () => {
    mocks.getSession.mockResolvedValue(null);

    expect(await canViewReferenceDocs(docsRequest())).toBe(false);
    expect(mocks.resolveUserRoles).not.toHaveBeenCalled();
  });

  it("denies a signed-in non-staff user", async () => {
    mocks.getSession.mockResolvedValue(session());
    mocks.resolveUserRoles.mockResolvedValue(["Member"]);

    expect(await canViewReferenceDocs(docsRequest())).toBe(false);
  });

  it("denies a banned user regardless of roles", async () => {
    mocks.getSession.mockResolvedValue(session({ bannedAt: new Date() }));

    expect(await canViewReferenceDocs(docsRequest())).toBe(false);
    expect(mocks.resolveUserRoles).not.toHaveBeenCalled();
  });

  it("allows staff and admins", async () => {
    mocks.getSession.mockResolvedValue(session());
    mocks.resolveUserRoles.mockResolvedValue(["Moderator"]);
    expect(await canViewReferenceDocs(docsRequest())).toBe(true);

    mocks.resolveUserRoles.mockResolvedValue(["Admin"]);
    expect(await canViewReferenceDocs(docsRequest())).toBe(true);
  });

  it("treats a session-read failure as anonymous", async () => {
    mocks.getSession.mockRejectedValue(new Error("boom"));

    expect(await canViewReferenceDocs(docsRequest())).toBe(false);
  });
});
