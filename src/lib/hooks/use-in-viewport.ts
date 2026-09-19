import { type RefObject, useEffect, useState } from "react";

/**
 * Whether the element is near the viewport. Decorative render loops gate on
 * it so a hero that has been scrolled past stops drawing.
 *
 * Starts true so the first frames paint before the observer's initial
 * callback lands, and stays true where `IntersectionObserver` is missing.
 */
export function useInViewport(
  ref: RefObject<Element | null>,
  { rootMargin = "200px" }: { rootMargin?: string } = {},
): boolean {
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? true),
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, rootMargin]);

  return inView;
}
