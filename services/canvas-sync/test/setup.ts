// config.ts refuses to parse without these; tests that reach a real
// Postgres or Redis read their own CANVAS_SYNC_TEST_* URLs instead.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.CANVAS_SYNC_SECRET ??= "test-secret-for-canvas-sync";
