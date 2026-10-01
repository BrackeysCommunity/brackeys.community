import { describe, expect, it } from "vite-plus/test";

import { mediaEmbedFor, splitAtFirstMedia } from "@/lib/media-embeds";

const src = (href: string) => {
  const embed = mediaEmbedFor(href);
  return embed ? `${embed.kind} ${embed.src}` : null;
};

describe("mediaEmbedFor", () => {
  it("maps the YouTube link shapes onto the no-cookie player", () => {
    const frame = "frame https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
    expect(src("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(frame);
    expect(src("https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x")).toBe(frame);
    expect(src("https://youtu.be/dQw4w9WgXcQ")).toBe(frame);
    expect(src("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe(frame);
    expect(src("https://youtu.be/dQw4w9WgXcQ?t=1m30s")).toBe(`${frame}?start=90`);
    expect(src("https://www.youtube.com/watch?v=bad")).toBeNull();
    expect(src("https://www.youtube.com/@channel")).toBeNull();
  });

  it("maps Vimeo, Twitch and Streamable", () => {
    expect(src("https://vimeo.com/76979871")).toBe("frame https://player.vimeo.com/video/76979871");
    expect(src("https://vimeo.com/76979871/abc123")).toBe(
      "frame https://player.vimeo.com/video/76979871?h=abc123",
    );
    expect(src("https://clips.twitch.tv/FunnyClip-abc")).toBe(
      "frame https://clips.twitch.tv/embed?clip=FunnyClip-abc&autoplay=false",
    );
    expect(src("https://www.twitch.tv/someone/clip/FunnyClip-abc")).toBe(
      "frame https://clips.twitch.tv/embed?clip=FunnyClip-abc&autoplay=false",
    );
    expect(src("https://www.twitch.tv/videos/123456")).toBe(
      "frame https://player.twitch.tv/?video=123456&autoplay=false",
    );
    expect(src("https://www.twitch.tv/someone")).toBeNull();
    expect(src("https://streamable.com/abc12")).toBe("frame https://streamable.com/e/abc12");
  });

  it("passes media files through over https only", () => {
    expect(src("https://cdn.example.com/a/clip.MP4")).toBe(
      "video https://cdn.example.com/a/clip.MP4",
    );
    expect(src("https://i.imgur.com/abc.gifv")).toBe("video https://i.imgur.com/abc.mp4");
    expect(src("https://i.imgur.com/abc.png")).toBe("image https://i.imgur.com/abc.png");
    expect(src("http://cdn.example.com/clip.mp4")).toBeNull();
  });

  it("never frames anything else", () => {
    expect(src("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(src("javascript:alert(1)")).toBeNull();
    expect(src("not a url")).toBeNull();
  });
});

describe("splitAtFirstMedia", () => {
  it("cuts the body at its first lone media link and counts the rest", () => {
    const body = [
      "Caves, take two:",
      "https://youtu.be/dQw4w9WgXcQ",
      "",
      "Starting partway through:",
      "<https://vimeo.com/1084537>",
      "",
      "more words https://youtu.be/dQw4w9WgXcQ",
    ].join("\n");
    const split = splitAtFirstMedia(body);
    expect(split.before).toBe("Caves, take two:");
    expect(split.first?.href).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(split.mediaCount).toBe(2);
    expect(split.moreText).toBe(true);
  });

  it("keeps a body with no lone media whole", () => {
    const body = "watch https://youtu.be/dQw4w9WgXcQ\n```\nhttps://youtu.be/dQw4w9WgXcQ\n```";
    expect(splitAtFirstMedia(body)).toEqual({
      before: body,
      first: null,
      mediaCount: 0,
      moreText: false,
    });
  });

  it("knows when the media is the last thing in the post", () => {
    const split = splitAtFirstMedia("Look:\nhttps://streamable.com/moo\n");
    expect(split).toMatchObject({ before: "Look:", mediaCount: 1, moreText: false });
  });
});
