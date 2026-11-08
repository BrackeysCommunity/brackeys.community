import { parseDocName } from "@jams/engine/project";
import { describe, expect, it } from "vite-plus/test";

import {
  applyChannel,
  documentName,
  documentProject,
  isSyncKind,
  MAX_ID_LENGTH,
  parseApplyMessage,
  parseDocumentName,
  parseRevokeMessage,
  revokeChannel,
  type RevokeMessage,
  revokeReaches,
  revokeSubject,
  revokeSubjectsCovering,
  SYNC_CLOSE,
  SYNC_KINDS,
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

describe("project documents", () => {
  const id48 = "p".repeat(48);
  const key48 = "k".repeat(48);

  it("has one list of hosted kinds, project and asset among them", () => {
    expect(SYNC_KINDS).toEqual(["canvas", "scene", "project", "asset"]);
    expect(isSyncKind("asset")).toBe(true);
    expect(isSyncKind("note")).toBe(false);
  });

  it("names and parses projects, scenes and assets by <project>.<key>", () => {
    expect(documentName("project", "jam")).toBe("project:jam");
    expect(parseDocumentName("project:jam")).toEqual({ kind: "project", id: "jam" });
    expect(parseDocumentName("asset:jam.k1")).toEqual({ kind: "asset", id: "jam.k1" });
    expect(parseDocumentName("scene:jam.level-1")).toEqual({ kind: "scene", id: "jam.level-1" });
    expect(parseDocumentName(`project:${id48}`)?.id).toBe(id48);
    expect(`project:${id48}`).toHaveLength(56);
    expect(parseDocumentName(`asset:${id48}.${key48}`)?.id).toHaveLength(97);
  });

  it.each([
    `project:${"p".repeat(49)}`,
    "project:Jam",
    "project:jam.k1",
    "project:-jam",
    "asset:jam",
    "asset:jam.",
    "asset:.k1",
    "asset:jam.k1.x",
    "asset:jam.K1",
    `asset:${"p".repeat(49)}.k`,
    "scene:level-1",
    "scene:a.b.c",
  ])("refuses %j", (name) => {
    expect(parseDocumentName(name)).toBeNull();
  });

  it("agrees with the engine's doc names on project, scene and asset names", () => {
    const names = [
      "project:jam",
      `project:${id48}`,
      `project:${"p".repeat(49)}`,
      "project:Jam",
      "project:jam.k1",
      "scene:jam.level-1",
      `scene:${id48}.${key48}`,
      `scene:${id48}.${key48}x`,
      "scene:jam",
      "scene:a.b.c",
      "asset:jam.k1",
      "asset:jam.-k1",
      "asset:jam.k1 ",
      "asset:jam:k1",
    ];
    for (const name of names) {
      const engine = parseDocName(name);
      const site = parseDocumentName(name);
      expect({ name, ok: site !== null }).toEqual({ name, ok: engine !== null });
      expect(documentProject(name)).toBe(engine?.project ?? null);
    }
  });

  it("knows each project document's project, and that canvases and notes have none", () => {
    expect(documentProject("project:jam")).toBe("jam");
    expect(documentProject("scene:jam.level-1")).toBe("jam");
    expect(documentProject("asset:jam.k1")).toBe("jam");
    expect(documentProject("canvas:jam")).toBeNull();
    expect(documentProject("note:jam.k1")).toBeNull();
    expect(documentProject("jam")).toBeNull();
  });

  it("shares the id limit", () => {
    expect(MAX_ID_LENGTH).toBe(100);
    expect(parseDocumentName(`canvas:${"x".repeat(MAX_ID_LENGTH)}`)).not.toBeNull();
  });
});

describe("project revokes", () => {
  it("parse, alone or for one user, and never beside another document", () => {
    expect(parseRevokeMessage('{"projectId":"jam"}')).toEqual({ projectId: "jam" });
    expect(parseRevokeMessage('{"projectId":"jam","userId":"u"}')).toEqual({
      projectId: "jam",
      userId: "u",
    });
    expect(parseRevokeMessage('{"sceneId":"jam.l","userId":"u"}')).toEqual({
      sceneId: "jam.l",
      userId: "u",
    });
    for (const bad of [
      '{"projectId":"jam","sceneId":"jam.l"}',
      '{"projectId":"jam","canvasId":"c"}',
      '{"projectId":""}',
      '{"projectId":7}',
    ]) {
      expect(parseRevokeMessage(bad)).toBeNull();
    }
  });

  it("are remembered under project:<id>, which covers each of its documents' subjects", () => {
    expect(revokeSubject({ projectId: "jam" })).toBe("project:jam");
    expect(revokeSubjectsCovering("scene:jam.l")).toEqual(["scene:jam.l", "project:jam"]);
    expect(revokeSubjectsCovering("asset:jam.k1")).toEqual(["asset:jam.k1", "project:jam"]);
    expect(revokeSubjectsCovering("project:jam")).toEqual(["project:jam"]);
    expect(revokeSubjectsCovering("c1")).toEqual(["c1"]);
  });

  it("reach every document of the project and nothing else", () => {
    const names = ["project:jam", "scene:jam.l", "asset:jam.k1", "scene:other.l", "canvas:jam"];
    const reached = (message: RevokeMessage) => names.filter((n) => revokeReaches(message, n));
    expect(reached({ projectId: "jam" })).toEqual(["project:jam", "scene:jam.l", "asset:jam.k1"]);
    expect(reached({ sceneId: "jam.l" })).toEqual(["scene:jam.l"]);
    expect(reached({ canvasId: "jam" })).toEqual(["canvas:jam"]);
    expect(reached({ userId: "u" })).toEqual(names);
  });
});
