import { useSyncExternalStore } from "react";

import type { MediaEmbed } from "@/lib/media-embeds";
import { cn } from "@/lib/utils";

const noSubscribe = () => () => {};

/** The page's hostname once hydrated; null on the server. */
function useHostname(): string | null {
  return useSyncExternalStore(
    noSubscribe,
    () => window.location.hostname,
    () => null,
  );
}

/** A lone link in a markdown body, shown as the player or media it points at. */
export function MediaEmbedView({
  embed,
  href,
  className,
}: {
  embed: MediaEmbed;
  href: string;
  className?: string;
}) {
  const hostname = useHostname();

  if (embed.kind === "image") {
    return (
      <img
        src={embed.src}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn("my-3 h-auto max-h-96 max-w-full rounded", className)}
      />
    );
  }
  if (embed.kind === "video") {
    return (
      <video
        src={embed.src}
        controls
        playsInline
        preload="metadata"
        className={cn("my-3 max-h-[32rem] max-w-full rounded", className)}
      />
    );
  }

  let src = embed.src;
  if (embed.provider === "twitch") {
    if (!hostname) {
      return (
        <p>
          <a href={href} rel="noreferrer noopener" target="_blank">
            {href}
          </a>
        </p>
      );
    }
    src = `${src}&parent=${encodeURIComponent(hostname)}`;
  }
  return (
    <iframe
      src={src}
      title={embed.title}
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
      allow="encrypted-media; fullscreen; picture-in-picture"
      allowFullScreen
      className={cn(
        "my-3 aspect-video w-full max-w-3xl rounded-md border border-border",
        className,
      )}
    />
  );
}
