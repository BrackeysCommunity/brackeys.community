import { describe, expect, it } from "vite-plus/test";

import {
  buildProfileProjectImageObjectKey,
  buildProjectImageObjectKey,
  buildTeamAvatarObjectKey,
  isServableImageKey,
} from "@/lib/profile-project-images";

describe("isServableImageKey", () => {
  it("accepts keys minted by every upload builder", () => {
    const keys = [
      buildProfileProjectImageObjectKey("user1", "Cover Art.PNG"),
      buildTeamAvatarObjectKey("team1", "avatar.webp"),
      buildProjectImageObjectKey("proj1", "screenshot.jpg"),
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
