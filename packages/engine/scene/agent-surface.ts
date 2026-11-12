/**
 * The version of the agent surface: issue codes, op names, JSON Schema
 * `$id`s, the scene CLI's commands and flags, `.checks.json` kinds, and the
 * MCP adapter's tool names. It moves independently of
 * the engine's semver and the scene format's `v`, so an MCP client or an
 * agent skill can check compatibility without knowing the engine version.
 * Bump it whenever one of those lists changes; `codes --json` and the
 * published JSON Schemas carry it.
 */
export const AGENT_SURFACE_VERSION = 16;

/** The keyword the engine's JSON Schemas carry `AGENT_SURFACE_VERSION` under. */
export const AGENT_SURFACE_KEYWORD = "x-agent-surface";
