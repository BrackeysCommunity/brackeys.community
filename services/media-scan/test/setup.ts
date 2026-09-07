// Unit tests never talk to Postgres or Redis (both connect lazily), but
// config.ts refuses to parse without the URLs — stub them in.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
