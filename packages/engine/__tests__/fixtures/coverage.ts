/**
 * Whether v8 coverage instruments this run, from vitest's worker state or
 * `TEST_COVERAGE=1` (which CI's test job also sets). Coverage slows the
 * engine's JavaScript far more than Rapier's WebAssembly, so a timing taken
 * under it is held to a bound measured under it.
 */
export const coverageOn = (): boolean =>
  process.env.TEST_COVERAGE === "1" ||
  (globalThis as { __vitest_worker__?: { config?: { coverage?: { enabled?: boolean } } } })
    .__vitest_worker__?.config?.coverage?.enabled === true;
