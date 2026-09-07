import { describe, expect, it } from "vite-plus/test";

import {
  bannerScanJobId,
  entryScanJobId,
  itchImageId,
  rescanJobId,
  uploadScanJobId,
} from "@/lib/media-scan-queue";

// entries.json and data.json serve the same picture as different
// derivatives; both decode to img/22995723.png.
const ENTRIES_FORM = "https://img.itch.zone/aW1nLzIyOTk1NzIzLnBuZw==/300x240%23c/F8BOL0.png";
const DATA_FORM = "https://img.itch.zone/aW1nLzIyOTk1NzIzLnBuZw==/315x250%23c/OE9oeR.png";
const BANNER = "https://img.itch.zone/aW1nLzEyMzQ1Ni5qcGc=/original/AbCdEf.jpg";

describe("itchImageId", () => {
  it("maps both derivative forms of one image to the same numeric id", () => {
    expect(itchImageId(ENTRIES_FORM)).toBe("22995723");
    expect(itchImageId(DATA_FORM)).toBe("22995723");
    expect(itchImageId(BANNER)).toBe("123456");
  });

  it("survives a URL-encoded base64 segment", () => {
    expect(itchImageId("https://img.itch.zone/aW1nLzIyOTk1NzIzLnBuZw%3D%3D/300x240/x.png")).toBe(
      "22995723",
    );
  });

  it("falls back to a sanitized segment for non-itch URLs and null for none", () => {
    expect(itchImageId("https://example.com/some:path/pic.png")).toBe("some_path");
    expect(itchImageId(null)).toBeNull();
    expect(itchImageId("")).toBeNull();
    expect(itchImageId("not a url")).toBeNull();
  });
});

describe("job ids", () => {
  it("carry the image identity so a re-enqueue of the same cover collapses", () => {
    expect(entryScanJobId(101, ENTRIES_FORM)).toBe(entryScanJobId(101, DATA_FORM));
    expect(entryScanJobId(101, ENTRIES_FORM)).not.toBe(entryScanJobId(101, BANNER));
    expect(entryScanJobId(101, null)).toBe("entry-101-none");
    expect(bannerScanJobId(7, BANNER)).toBe("banner-7-123456");
  });

  it("never contain a colon", () => {
    const ids = [
      entryScanJobId(1, ENTRIES_FORM),
      bannerScanJobId(1, BANNER),
      uploadScanJobId("team-avatars/abc-def/xyz-cover.png"),
      uploadScanJobId("weird:key/with:colons"),
      rescanJobId("upload", "team-avatars/a:b"),
    ];
    for (const id of ids) expect(id).not.toContain(":");
  });
});
