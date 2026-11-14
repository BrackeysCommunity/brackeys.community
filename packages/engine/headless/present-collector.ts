import type { PresentedRequest, PresentRequest } from "../runtime/present";

export type PresentCollector = {
  /** Every request kept so far, in request order, each with the tick that asked. */
  readonly present: PresentedRequest[];
  /** Keeps one tick's requests; a tick that asked for nothing passes `undefined`. */
  onTick(requests: readonly PresentRequest[] | undefined, tick: number): void;
  /** Sets `report.present` when the collector records. */
  attach(report: { present?: PresentedRequest[] }): void;
};

/**
 * Gathers a run's presentation requests for `PlaytestReport.present`.
 * With `record` false it keeps nothing and `attach` leaves the report alone.
 */
export function presentCollector(record: boolean): PresentCollector {
  const present: PresentedRequest[] = [];
  return {
    present,
    onTick(requests, tick) {
      if (!record || !requests) return;
      for (const req of requests) present.push({ ...req, tick });
    },
    attach(report) {
      if (record) report.present = present;
    },
  };
}
