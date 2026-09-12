import { type ComponentProps, useState } from "react";

import { type ItchImageOpts, itchImageUrl } from "@/lib/itch-image";

interface TransformedImageProps extends Omit<ComponentProps<"img">, "src" | "srcSet"> {
  /** Untransformed source; the transform is applied here, not by the caller. */
  src: string;
  transform?: ItchImageOpts;
}

/**
 * An `<img>` through the Cloudflare transform, with the fallback the URL
 * helper cannot give on its own: when the transformed request fails, the
 * untransformed source is tried once. "The CDN leg is misconfigured"
 * degrades to a slower image, not to no image. The caller's `onError`
 * fires only once the plain source has failed too.
 */
export function TransformedImage({ src, transform, onError, ...props }: TransformedImageProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const transformed = itchImageUrl(src, transform);
  const rendered = failed === transformed ? src : transformed;

  return (
    <img
      {...props}
      src={rendered}
      onError={(event) => {
        if (rendered !== src) {
          setFailed(rendered);
          return;
        }
        onError?.(event);
      }}
    />
  );
}
