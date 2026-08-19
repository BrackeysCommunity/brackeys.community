import { useEffect } from "react";

/**
 * Publishes `--app-header-shift` for whichever app bar is mounted — the
 * distance sticky page surfaces should travel to reclaim the band a hidden
 * header left behind, or `0px` while the bar is out. See the property's
 * definition in `styles.css` for the full contract, and
 * {@link useHideOnScrollDown} for what flips `hidden`.
 *
 * It lands on the document element so every rider inherits it, and so the two
 * shells (desktop `AppHeader`, mobile `MobileShell`) can't both claim it. The
 * value cuts straight to its new number; the travel is `.header-follow`.
 *
 * @param shift a negative length — how far up sticky surfaces move once the
 * bar is gone. Differs per shell: the mobile bar also eats the status-bar inset.
 */
export function useHeaderShift(hidden: boolean, shift: string) {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--app-header-shift", hidden ? shift : "0px");
    return () => {
      root.style.removeProperty("--app-header-shift");
    };
  }, [hidden, shift]);
}
