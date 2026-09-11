import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vite-plus/test";

import { errorMessage, validationIssues } from "@/lib/error-message";

/** What oRPC throws when zod refuses a procedure's input. */
function rejectedInput(issues: { message: string; path?: unknown[] }[]) {
  return new ORPCError("BAD_REQUEST", {
    message: "Input validation failed",
    data: { issues },
  });
}

describe("errorMessage", () => {
  it("surfaces a real message and falls back on an empty one", () => {
    expect(errorMessage(new Error("Team name is taken."))).toBe("Team name is taken.");
    expect(errorMessage(new Error(""), "Could not save.")).toBe("Could not save.");
    expect(errorMessage("not an error", "Could not save.")).toBe("Could not save.");
  });

  // Cookie's screenshot: a red "Input validation failed" above PUBLISH and
  // nothing else. That string is the framework talking to itself.
  it("never renders oRPC's own phrasing for a rejected input", () => {
    const err = rejectedInput([{ message: "Too small", path: ["title"] }]);
    expect(errorMessage(err, "Could not publish the post.")).toBe("Could not publish the post.");
  });
});

describe("validationIssues", () => {
  it("reads the field and message off each issue", () => {
    const err = rejectedInput([
      { message: "Maximum must be at least the minimum.", path: ["compensationMax"] },
      { message: "Must be an http(s) link.", path: ["portfolioUrl"] },
    ]);
    expect(validationIssues(err)).toEqual([
      { field: "compensationMax", message: "Maximum must be at least the minimum." },
      { field: "portfolioUrl", message: "Must be an http(s) link." },
    ]);
  });

  it("accepts the object form of a path segment and a missing path", () => {
    expect(
      validationIssues(rejectedInput([{ message: "Bad", path: [{ key: "roleIds" }] }])),
    ).toEqual([{ field: "roleIds", message: "Bad" }]);
    expect(validationIssues(rejectedInput([{ message: "Bad" }]))).toEqual([
      { field: "", message: "Bad" },
    ]);
  });

  it("is empty for anything that isn't an input rejection", () => {
    expect(validationIssues(new Error("boom"))).toEqual([]);
    expect(validationIssues(new ORPCError("NOT_FOUND", { message: "Gone." }))).toEqual([]);
    expect(validationIssues(undefined)).toEqual([]);
  });
});
