import { useId } from "react";

/**
 * Sticker illustrations that hang off a banner's top edge. Fixed ink and
 * paper colours, so they read the same on either theme; the accent follows
 * `--primary`.
 */
const INK = "#16130f";

function CookieArt() {
  const id = useId();
  const bite = `${id}-bite`;
  const body = `${id}-body`;
  return (
    <svg viewBox="0 0 120 120" aria-hidden className="size-full overflow-visible">
      <defs>
        <mask id={bite}>
          <rect width="120" height="120" fill="white" />
          <circle cx="104" cy="22" r="20" fill="black" />
        </mask>
        <clipPath id={body}>
          <circle cx="60" cy="62" r="50" />
        </clipPath>
      </defs>
      <g mask={`url(#${bite})`}>
        <circle cx="60" cy="65" r="47" fill={INK} />
        <circle cx="60" cy="60" r="47" fill="#d9944a" stroke={INK} strokeWidth="4" />
        <path
          d="M24 52a38 38 0 0 1 44-30"
          fill="none"
          stroke="#efbd7d"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <g fill="#4a2814" stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
          <path d="M38 44l9-3 3 8-8 4z" />
          <path d="M66 50l10 1-1 9-9-2z" />
          <path d="M34 72l8 1 1 8-9 0z" />
          <path d="M56 80l9-4 4 8-8 4z" />
          <path d="M80 72l7 3-2 8-8-3z" />
          <path d="M54 30l7 1v7l-7-1z" />
        </g>
      </g>
      <circle
        cx="104"
        cy="22"
        r="20"
        fill="none"
        stroke={INK}
        strokeWidth="4"
        clipPath={`url(#${body})`}
      />
      <g fill="#d9944a" stroke={INK} strokeWidth="2.5">
        <circle cx="112" cy="18" r="3.5" />
        <circle cx="104" cy="6" r="2.5" />
      </g>
      <path
        d="M14 16l3 8 8 3-8 3-3 8-3-8-8-3 8-3z"
        fill="var(--primary)"
        stroke={INK}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CanvasArt() {
  return (
    <svg viewBox="0 0 120 120" aria-hidden className="size-full overflow-visible">
      <rect x="10" y="18" width="100" height="84" rx="8" fill={INK} transform="translate(0 5)" />
      <rect
        x="10"
        y="18"
        width="100"
        height="84"
        rx="8"
        fill="#f4efe4"
        stroke={INK}
        strokeWidth="4"
      />
      <g fill="#d8d0c0">
        {[30, 50, 70, 90].flatMap((x) =>
          [36, 54, 72, 90].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />),
        )}
      </g>
      <path
        d="M40 46C58 46 52 74 72 74"
        fill="none"
        stroke={INK}
        strokeWidth="3"
        strokeDasharray="5 5"
        strokeLinecap="round"
      />
      <rect
        x="20"
        y="30"
        width="30"
        height="26"
        rx="3"
        fill="#f6c945"
        stroke={INK}
        strokeWidth="3"
        transform="rotate(-6 35 43)"
      />
      <rect
        x="66"
        y="62"
        width="32"
        height="26"
        rx="3"
        fill="var(--primary)"
        stroke={INK}
        strokeWidth="3"
        transform="rotate(5 82 75)"
      />
      <rect
        x="70"
        y="26"
        width="24"
        height="20"
        rx="3"
        fill="#f28bb0"
        stroke={INK}
        strokeWidth="3"
        transform="rotate(8 82 36)"
      />
      <path
        d="M52 84l0 24 6-6 5 10 5-2-5-10 9-1z"
        fill="white"
        stroke={INK}
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const BANNER_ART = {
  cookie: CookieArt,
  canvas: CanvasArt,
} as const;

export type BannerArtKey = keyof typeof BANNER_ART;
