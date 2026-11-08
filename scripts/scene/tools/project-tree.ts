import type { ProjectTreeNode } from "@jams/engine/project";

import { failure, hostedOptions, usage, type ToolContext, type ToolResult } from "../context";
import { DEFAULT_PROJECT_URL, openLiveProject, ProjectClientError } from "../project-client";
import { isHandle, loadProject, pickProject, type ProjectToolContext } from "./project-show";

/** What a live project tool reads from beyond the projects: where hosted calls find the token. */
export type LiveToolContext = ProjectToolContext & Pick<ToolContext, "env" | "fetch">;

export type LiveReadFlags = {
  /** Read the project on the running dev server (or a hosted one) instead of its files. */
  live?: boolean;
  url?: string;
  /** A hosted project's agent token; `JAMS_AGENT_TOKEN` when left out. */
  token?: string;
  timeoutMs?: number;
};

export type ProjectTreeInput = LiveReadFlags & { project?: string };

/** The usage error for a live flag without `--live`; null when the flags agree. */
export function liveFlagsError(flags: LiveReadFlags): ToolResult | null {
  if (flags.live) return null;
  const liveOnly = (["url", "token"] as const).find((f) => flags[f] !== undefined);
  return liveOnly ? usage(`--${liveOnly} needs --live`) : null;
}

/** A live call's refusal as a result: a usage error that `--project` fixes, else a failure. */
export function liveFailure(e: unknown, url: string): ToolResult {
  if (!(e instanceof ProjectClientError)) throw e;
  return e.exitCode === 2 ? usage(e.message) : failure(e.message, { url });
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function nodeLines(nodes: readonly ProjectTreeNode[], depth: number, out: string[]): void {
  const pad = "  ".repeat(depth);
  for (const node of nodes) {
    if (node.type === "folder") {
      out.push(`${pad}${baseName(node.path)}/`);
      nodeLines(node.children, depth + 1, out);
    } else if (node.type === "asset") {
      const { entry } = node;
      const name = entry.name !== undefined ? ` "${entry.name}"` : "";
      out.push(`${pad}${baseName(entry.path)}  ${entry.kind} ${entry.id}${name}`);
    } else {
      const registers = Object.entries(node.info.registers)
        .map(([what, names]) => `${what}: ${names.join(", ")}`)
        .join("; ");
      out.push(`${pad}${baseName(node.path)}  code${registers ? `  (${registers})` : ""}`);
    }
  }
}

function treeResult(
  project: string,
  tree: readonly ProjectTreeNode[],
  extra: Record<string, unknown>,
): ToolResult {
  const lines = [`${project}/`];
  nodeLines(tree, 1, lines);
  return {
    exitCode: 0,
    data: { ok: true, project, ...extra, tree },
    text: tree.length > 0 ? lines.join("\n") : `${project}/ (empty)`,
  };
}

/**
 * The project's tree as the editor's panel shows it: folders, live assets
 * and read-only code modules, from its files or with `--live` from the
 * dev server's project doc.
 */
export async function projectTree(
  input: ProjectTreeInput,
  ctx: LiveToolContext,
): Promise<ToolResult> {
  const flagged = liveFlagsError(input);
  if (flagged) return flagged;
  if (!input.live) {
    const picked = pickProject(ctx, input.project, "tree");
    if (!isHandle(picked)) return picked;
    const { view } = await loadProject(picked);
    return treeResult(picked.file.id, view.tree(), {});
  }
  const url = input.url ?? DEFAULT_PROJECT_URL;
  let live;
  try {
    live = await openLiveProject({
      projects: ctx.projects,
      url,
      project: input.project,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...hostedOptions(ctx, input.token),
    });
  } catch (e) {
    return liveFailure(e, url);
  }
  try {
    return treeResult(live.project.file.id, live.client.session.view().tree(), { live: true, url });
  } finally {
    await live.client.close().catch(() => undefined);
  }
}
