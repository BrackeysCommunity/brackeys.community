import { useEffect, useState } from "react";

/** Wall-clock minute in ms. */
const MINUTE = 60_000;

/**
 * The current time, re-read once a minute.
 *
 * A minute is the resolution every consumer actually renders at:
 * `formatRelativeMs` stops at `03h 04m`, `timeAgo` at `12m ago`, and the
 * jam progress strips span days. This used to tick every second, which
 * bought nothing visible and cost a re-render of whatever sat under it —
 * on the jam board that is the provider, the board build, and every
 * mounted card, once a second, forever.
 *
 * The first tick is aligned to the wall-clock minute so everything on
 * screen rolls over together rather than each mount drifting on its own
 * schedule.
 */
function useDateNow(): number {
  const [time, setTime] = useState(() => Date.now());

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const align = setTimeout(
      () => {
        setTime(Date.now());
        interval = setInterval(() => setTime(Date.now()), MINUTE);
      },
      MINUTE - (Date.now() % MINUTE),
    );

    return () => {
      clearTimeout(align);
      if (interval) clearInterval(interval);
    };
  }, []);

  return time;
}

export default useDateNow;
