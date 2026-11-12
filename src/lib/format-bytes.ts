// Sizes and counts as people read them. The bytes are the engine's own
// formatter, reached by relative path so the services that copy this file
// (and the engine's project directory) need nothing else.

/** KiB-based, as the engine measures: "512 B", "32 KB", "1.4 MB", "256 MB". */
export { formatBytes } from "../../packages/engine/project/index.ts";

/** A whole count with thousands separators: "2,000". */
export function formatCount(count: number): string {
  return Math.round(count).toLocaleString("en-US");
}
