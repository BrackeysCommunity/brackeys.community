import { describe, expect, it } from "vite-plus/test";

import {
  applyChannel,
  documentName,
  parseApplyMessage,
  parseDocumentName,
  parseRevokeMessage,
  revokeChannel,
  SYNC_CLOSE,
  syncClose,
  syncCloseCode,
  syncEnvPrefix,
} from "../sync-channels";

describe("sync channels", () => {
  it("prefixes by environment, defaulting to development", () => {
    expect(syncEnvPrefix("staging")).toBe("staging:canvas-sync");
    expect(syncEnvPrefix(undefined)).toBe("development:canvas-sync");
    expect(syncEnvPrefix("")).toBe("development:canvas-sync");
    expect(revokeChannel(syncEnvPrefix("prod"))).toBe("prod:canvas-sync:revoke");
    expect(applyChannel(syncEnvPrefix("prod"))).toBe("prod:canvas-sync:apply");
  });

  it("names and parses documents", () => {
    expect(documentName("canvas", "abc")).toBe("canvas:abc");
    expect(parseDocumentName("canvas:abc")).toEqual({ kind: "canvas", id: "abc" });
    expect(parseDocumentName("note:n1")).toEqual({ kind: "note", id: "n1" });
  });

  it.each([
    "abc",
    "board:abc",
    "canvas:",
    ":abc",
    "canvas:a:b",
    "canvas: abc",
    "",
    `canvas:${"x".repeat(101)}`,
  ])("refuses %j", (name) => {
    expect(parseDocumentName(name)).toBeNull();
  });

  it("parses revoke messages", () => {
    expect(parseRevokeMessage('{"canvasId":"c"}')).toEqual({ canvasId: "c" });
    expect(parseRevokeMessage('{"canvasId":"c","userId":"u"}')).toEqual({
      canvasId: "c",
      userId: "u",
    });
    expect(parseRevokeMessage('{"userId":"u"}')).toEqual({ userId: "u" });
    for (const bad of [
      "{}",
      "null",
      "nope",
      '{"canvasId":5}',
      '{"canvasId":""}',
      '{"userId":"u","canvasId":1}',
    ]) {
      expect(parseRevokeMessage(bad)).toBeNull();
    }
  });

  it("parses apply messages", () => {
    expect(parseApplyMessage('{"canvasId":"c"}')).toEqual({ canvasId: "c" });
    expect(parseApplyMessage("{}")).toBeNull();
    expect(parseApplyMessage("[")).toBeNull();
  });

  it("reads the close code from a code or a reason", () => {
    expect(syncCloseCode(syncClose(SYNC_CLOSE.revoked))).toBe(4403);
    expect(
      syncCloseCode({ code: 1000, reason: syncClose(SYNC_CLOSE.tooLarge, "canvas").reason }),
    ).toBe(4413);
    expect(syncCloseCode({ code: 1000, reason: "4429 rate-limited" })).toBe(4429);
    expect(syncCloseCode({ code: 1009, reason: "" })).toBe(4413);
    expect(syncCloseCode({ code: 1000, reason: "Server closed the connection" })).toBeNull();
    expect(syncCloseCode({ code: 1006 })).toBeNull();
    expect(syncCloseCode({ code: 1000, reason: "4205 Reset Connection" })).toBeNull();
    expect(syncCloseCode(undefined)).toBeNull();
  });
});
