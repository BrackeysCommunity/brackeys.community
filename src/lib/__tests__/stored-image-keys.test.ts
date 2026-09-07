import { describe, expect, it } from "vite-plus/test";

import {
  buildCollabPostImageObjectKey,
  buildProfileProjectImageObjectKey,
  buildProjectImageObjectKey,
  buildTeamAvatarObjectKey,
  buildTeamProjectImageObjectKey,
  describeImageKey,
  isCollabPostImageKey,
  isServableImageKey,
  isTeamProjectImageKey,
} from "@/lib/stored-image-keys";
import { uploadedImageUrlSchema } from "@/lib/stored-image-urls";

describe("isServableImageKey", () => {
  it("accepts keys minted by every upload builder", () => {
    const keys = [
      buildProfileProjectImageObjectKey("user1", "Cover Art.PNG"),
      buildTeamAvatarObjectKey("team1", "avatar.webp"),
      buildProjectImageObjectKey("proj1", "screenshot.jpg"),
      buildCollabPostImageObjectKey(42, "gallery.png"),
      buildTeamProjectImageObjectKey("team1", "showcase.jpg"),
    ];
    for (const key of keys) {
      expect(isServableImageKey(key)).toBe(true);
    }
  });

  it("rejects everything outside the upload namespaces", () => {
    const rejected = ["jam-banners/whatever.png", "profile-projects.png", "backups/db.sql", ""];
    for (const key of rejected) {
      expect(isServableImageKey(key)).toBe(false);
    }
  });

  it("rejects traversal and empty segments", () => {
    const rejected = [
      "profile-projects/../secrets.txt",
      "profile-projects/user1/../../backups/db.sql",
      "profile-projects//user1/x.png",
      "profile-projects/./x.png",
      "profile-projects/user1/",
    ];
    for (const key of rejected) {
      expect(isServableImageKey(key)).toBe(false);
    }
  });
});

describe("scoped key checks", () => {
  it("bind collab keys to their post", () => {
    const key = buildCollabPostImageObjectKey(42, "gallery.png");
    expect(isCollabPostImageKey(42, key)).toBe(true);
    expect(isCollabPostImageKey(43, key)).toBe(false);
    expect(isCollabPostImageKey(4, key)).toBe(false);
  });

  it("bind team showcase keys to their team", () => {
    const key = buildTeamProjectImageObjectKey("team1", "showcase.jpg");
    expect(isTeamProjectImageKey("team1", key)).toBe(true);
    expect(isTeamProjectImageKey("team2", key)).toBe(false);
    expect(isTeamProjectImageKey("team", key)).toBe(false);
  });
});

describe("uploadedImageUrlSchema", () => {
  it("accepts the app-relative /images/ URL and absolute URLs", () => {
    expect(uploadedImageUrlSchema.safeParse("/images/profile-projects/u/x.png").success).toBe(true);
    expect(uploadedImageUrlSchema.safeParse("https://img.itch.zone/a.png").success).toBe(true);
  });

  it("rejects other relative paths and empty strings", () => {
    expect(uploadedImageUrlSchema.safeParse("/etc/passwd").success).toBe(false);
    expect(uploadedImageUrlSchema.safeParse("images/x.png").success).toBe(false);
    expect(uploadedImageUrlSchema.safeParse("").success).toBe(false);
  });
});

describe("describeImageKey", () => {
  it("reads the owner type and id off every builder's prefix", () => {
    expect(describeImageKey(buildProfileProjectImageObjectKey("user1", "a.png"))).toEqual({
      ownerType: "profile_project_image",
      ownerId: "user1",
    });
    expect(describeImageKey(buildTeamAvatarObjectKey("team1", "a.png"))).toEqual({
      ownerType: "team_avatar",
      ownerId: "team1",
    });
    expect(describeImageKey("team-banners/team1/x-banner.png")).toEqual({
      ownerType: "team_banner",
      ownerId: "team1",
    });
    expect(describeImageKey(buildProjectImageObjectKey("proj1", "a.png"))).toEqual({
      ownerType: "project_cover",
      ownerId: "proj1",
    });
    expect(describeImageKey(buildCollabPostImageObjectKey(42, "a.png"))).toEqual({
      ownerType: "collab_post_image",
      ownerId: "42",
    });
    expect(describeImageKey(buildTeamProjectImageObjectKey("team1", "a.png"))).toEqual({
      ownerType: "team_project_image",
      ownerId: "team1",
    });
  });

  it("returns null outside the upload namespaces", () => {
    expect(describeImageKey("quarantine/team-avatars/team1/a.png")).toBeNull();
    expect(describeImageKey("backups/db.sql")).toBeNull();
    expect(describeImageKey("team-avatars/../a.png")).toBeNull();
  });
});
