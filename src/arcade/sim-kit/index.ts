// The kit lives in the engine (`@jams/engine/sim-kit`). This relative re-export
// keeps the arcade's imports working where tsconfig paths don't resolve: the
// validator's container and plain `node --experimental-strip-types`.
export * from "../../engine/sim-kit/index.ts";
