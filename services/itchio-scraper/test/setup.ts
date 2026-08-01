// Unit tests never talk to Postgres (pg.Pool connects lazily), but config.ts
// refuses to parse without a DATABASE_URL — stub one in.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
