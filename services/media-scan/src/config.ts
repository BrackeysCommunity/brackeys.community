import { z } from "zod";

import { parseServiceConfig } from "../../../src/lib/service-config.ts";

const flag = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((v) => v === "true");

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  // The private uploads bucket. Optional so a deploy without them still
  // scans covers and banners; upload jobs are skipped with a warning.
  MINIO_ENDPOINT: z.string().min(1).optional(),
  MINIO_ACCESS_KEY: z.string().min(1).optional(),
  MINIO_SECRET_KEY: z.string().min(1).optional(),
  MINIO_BUCKET: z.string().min(1).optional(),
  USER_AGENT: z.string().default("brackeys-media-scan/0.1 (+https://brackeys.community)"),

  // ── Pacing ─────────────────────────────────────────────────────────────────
  // Per host, shared pool-wide through Redis (src/lib/itch-pacer.ts). itch.io
  // is the HTML site and every game's data.json; img.itch.zone is the cover
  // CDN, whose limiter has nothing to do with the pages'.
  MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().nonnegative().default(350),
  IMAGE_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().nonnegative().default(150),
  API_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().nonnegative().default(500),
  RATE_LIMIT_COOLDOWN_MS: z.coerce.number().int().positive().default(60_000),

  // ── Worker ─────────────────────────────────────────────────────────────────
  // Inference is CPU-bound and the fetches ride the shared pacer, so more
  // workers only overlap the two; past ~4 adds nothing.
  SCAN_CONCURRENCY: z.coerce.number().int().positive().default(3),
  // How much the hourly reconciler enqueues per run — the throttle a
  // detector bump drains at instead of flooding Redis with 640k jobs.
  SCAN_BATCH: z.coerce.number().int().positive().default(1500),
  // Cover drift (plan 24 phase 4): entries in jams that ended within
  // SCAN_REVISIT_DAYS get one data.json look every SCAN_REVISIT_INTERVAL_DAYS,
  // SCAN_REVISIT_BATCH per reconcile so revisits never starve first scans.
  SCAN_REVISIT_DAYS: z.coerce.number().int().positive().default(90),
  SCAN_REVISIT_INTERVAL_DAYS: z.coerce.number().int().positive().default(7),
  SCAN_REVISIT_BATCH: z.coerce.number().int().nonnegative().default(300),
  BANNER_BATCH: z.coerce.number().int().nonnegative().default(500),
  UPLOAD_BATCH: z.coerce.number().int().nonnegative().default(500),
  // Cron pattern for the DB reconciler; the worker registers it at boot.
  RECONCILE_CRON: z.string().default("15 * * * *"),

  // ── Verdicts ───────────────────────────────────────────────────────────────
  // Minimum probe probability (scan/probe.ts) that opens a flag. The probe
  // is calibrated for a balanced prior, so the useful range sits near 1:
  // on the 2026-09-06 corpus 0.99 catches every hand-labeled explicit cover
  // and 37/50 suggestive ones for ~750 flags corpus-wide, while 0.9 lets
  // ~5,500 through, mostly clean visual-novel art.
  NSFW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.99),
  // The auto-hide point for uploads — content we host, unlike an itch cover.
  // Separate from the flag threshold so it can start high; anything above 1
  // disables quarantine and uploads become flag-only like entries.
  UPLOAD_QUARANTINE_THRESHOLD: z.coerce.number().min(0).default(0.99),
  // Kill switch for the classifier only — hashing and theft matching keep
  // running without it.
  NSFW_ENABLED: flag("true"),

  // DB-only re-score of stored embeddings (jobs/rescore.ts).
  RESCORE_BATCH: z.coerce.number().int().positive().default(2000),
  RESCORE_DRY_RUN: flag("false"),
});

export const config = parseServiceConfig(schema);
export type Config = typeof config;
