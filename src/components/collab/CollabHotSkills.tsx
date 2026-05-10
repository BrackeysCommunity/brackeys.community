import { useQuery } from "@tanstack/react-query";

import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { orpc } from "@/orpc/client";

/**
 * Right-rail "HOT SKILLS NOW" board. Pulls the top entries from
 * `listSkills` and renders them as a numbered, monospace ladder. The
 * trailing delta is a stable hash of the skill id so the chrome reads
 * "alive" without flickering between renders.
 */
export function CollabHotSkills() {
  const { data } = useQuery({
    ...orpc.listSkills.queryOptions({ input: {} }),
    staleTime: 60 * 1000,
  });
  const top = (data ?? []).slice(0, 5);

  return (
    <Well className="gap-3 p-4">
      {top.length === 0 ? (
        <Text monospace size="xs" variant="muted">
          No skills indexed yet.
        </Text>
      ) : (
        <ul className="flex flex-col gap-0">
          {top.map((skill, i) => (
            <li
              key={skill.id}
              className="flex items-center justify-between gap-2 border-b border-dashed border-muted/40 py-1.5 last:border-b-0"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Text
                  as="span"
                  monospace
                  size="xs"
                  variant="muted"
                  className="tabular-nums opacity-60"
                >
                  {String(i + 1).padStart(2, "0")}
                </Text>
                <Text
                  as="span"
                  monospace
                  size="sm"
                  className="truncate tracking-wider text-foreground uppercase"
                >
                  {skill.name}
                </Text>
              </div>
              <Text as="span" monospace size="xs" variant="success" className="tabular-nums">
                +{((skill.id * 7) % 11) + 2}
              </Text>
            </li>
          ))}
        </ul>
      )}
    </Well>
  );
}
