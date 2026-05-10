import { StatCard } from "@/components/ui/stat-card";

interface CollabQuickBoardProps {
  paid: number;
  hobby: number;
  playtest: number;
  mentor: number;
  /** Tighter padding/typography for narrow contexts (mobile, sidebars). */
  compact?: boolean;
}

/**
 * Four-up open-role counts by post type. Renders flat `StatCard`
 * primitives — no surrounding container — so the row reads identically
 * to the profile stats row.
 */
export function CollabQuickBoard({
  paid,
  hobby,
  playtest,
  mentor,
  compact = false,
}: CollabQuickBoardProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <StatCard
        index="01/04"
        label="PAID WORK"
        value={pad2(paid)}
        suffix="OPEN"
        compact={compact}
      />
      <StatCard index="02/04" label="HOBBY" value={pad2(hobby)} suffix="OPEN" compact={compact} />
      <StatCard
        index="03/04"
        label="PLAYTEST"
        value={pad2(playtest)}
        suffix="OPEN"
        compact={compact}
      />
      <StatCard
        index="04/04"
        label="MENTORSHIP"
        value={pad2(mentor)}
        suffix="OPEN"
        compact={compact}
      />
    </div>
  );
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
