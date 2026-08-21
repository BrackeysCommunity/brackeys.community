import { useEffect, useState } from "react";

/**
 * How far a sticky toolbar's margin box should overhang the bottom of its
 * lane. A sticky box is held by its *margin* box, so the overhang is what
 * lets the bar ride off with the last of the list instead of sitting
 * pinned over the footer.
 *
 * The number is the scrollport less everything trailing the lane, measured
 * rather than written in `dvh` because neither term is a constant. Zero means
 * the lane already ends high enough. The caller hands the same distance back as
 * a negative top margin on the bar's next sibling, so none of it takes up
 * space in flow.
 */
export function useLaneRelease(bar: HTMLElement | null) {
  const [release, setRelease] = useState(0);

  useEffect(() => {
    const scroller = bar?.closest<HTMLElement>("[data-scroll-root]");
    const lane = bar?.parentElement;
    if (!bar || !lane || !scroller) return;

    const measure = () => {
      const laneEnd =
        lane.getBoundingClientRect().bottom -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      const belowLane = scroller.scrollHeight - laneEnd;
      setRelease(Math.max(0, scroller.clientHeight - belowLane));
    };

    measure();
    // Neither term is affected by the margin this feeds, so there's no loop.
    // The window listener braces the observer: a scroller sized by the viewport
    // doesn't always report a resize of its own.
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    if (scroller.lastElementChild) observer.observe(scroller.lastElementChild);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [bar]);

  return release;
}
