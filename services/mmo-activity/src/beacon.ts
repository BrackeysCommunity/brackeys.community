/**
 * The telemetry beacon: what a real phone session is measured by (launch
 * times, the socket, how far drops miss, the viewport and pointer). One
 * named event with plain values; it changes nothing, and a beacon that
 * cannot be sent is dropped.
 */
export interface Beacon {
  (event: string, data?: Record<string, string | number | boolean>): void;
}

let sink: Beacon = () => {};
let session = "";

/** Points the beacon at the listener's log route. */
export function startBeacon(url: string): void {
  const t0 = performance.now();
  sink = (event, data = {}) => {
    const body = JSON.stringify({
      event,
      // Only says whose event it is; the listener neither logs nor forwards it.
      ...(session ? { session } : {}),
      at: Date.now(),
      msSinceLoad: Math.round(performance.now() - t0),
      w: innerWidth,
      h: innerHeight,
      dpr: devicePixelRatio,
      coarse: matchMedia("(pointer: coarse)").matches,
      ...data,
    });
    try {
      if (!navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" })))
        void fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => undefined);
    } catch {
      // Telemetry never gets in the way.
    }
  };
}

/** Lets later beacons be counted against the signed-in player. */
export function beaconAs(token: string): void {
  session = token;
}

export const beacon: Beacon = (event, data) => sink(event, data);
