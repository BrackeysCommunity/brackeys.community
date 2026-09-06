import { Chonk } from "@/components/ui/chonk";
import { Censored, MicroLabel, Text } from "@/components/ui/typography";

/**
 * One row of BEHIND THE POST — the poster, the team, or the project the
 * post recruits for — as a whole-tile link. Shared by the post page and
 * the board's featured panel so the two read the same crew the same way.
 */
export function CrewTile({
  label,
  title,
  caption,
  avatar,
  link,
}: {
  label: string;
  title: string;
  caption?: string | null;
  avatar: React.ReactNode;
  link: React.ReactElement;
}) {
  return (
    <Chonk
      variant="surface"
      size="lg"
      data-hover-play-group
      className="w-full items-center gap-3 bg-card px-3 py-2 backdrop-blur-none"
      render={link}
    >
      {avatar}
      <span className="flex min-w-0 flex-col gap-0.5">
        <MicroLabel as="span">{label}</MicroLabel>
        <Text as="span" size="sm" bold ellipsis className="tracking-wider">
          {title}
        </Text>
        {caption ? (
          <Text as="span" size="xs" variant="muted" ellipsis className="max-w-56">
            <Censored>{caption}</Censored>
          </Text>
        ) : null}
      </span>
    </Chonk>
  );
}
