import { useSyncExternalStore } from "react";

/** Chromium's `deviceMemory` buckets to 0.25–8 GB. Four and below is the
 * integrated-GPU laptop and the mid-range phone: the machines where the
 * decorative shaders read as fan noise rather than polish. */
const LOW_MEMORY_GB = 4;

/** Nothing about the device changes mid-session, so the store never notifies. */
const subscribe = () => () => {};

const getSnapshot = () => {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof memory === "number" && memory <= LOW_MEMORY_GB;
};

/**
 * Whether to serve the cheap version of a decorative surface.
 *
 * Only Chromium reports `deviceMemory`, so this is a hint that is absent
 * more often than it is false — every surface behind it still has to look
 * finished when it comes back `false`.
 *
 * `false` on the server and on the hydrating render, so the markup matches.
 */
export function useLowEndDevice(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
