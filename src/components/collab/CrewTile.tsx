import { Chonk } from "@/components/ui/chonk";
import { Censored, MicroLabel, Text } from "@/components/ui/typography";
/**
 * One row of BEHIND THE POST — the poster, the team, or the project the
 * post recruits for — as a whole-tile link. Shared by the post page and
 * the board's featured panel so the two read the same crew the same way.
 */
import { cn } from "@/lib/utils";

export function CrewTile({
  label,
  title,
  titleClassName,
  titleStyle,
  caption,
  avatar,
  link,
}: {
  label: string;
  title: string;
  /** The poster's name glow, when this tile is a member. Team and project
   *  tiles leave both unset. */
  titleClassName?: string;
  titleStyle?: React.CSSProperties;
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
        <span className="flex min-w-0 items-center gap-2">
          <Text
            as="span"
            size="sm"
            bold
            ellipsis
            className={cn("min-w-0 tracking-wider", titleClassName)}
            style={titleStyle}
          >
            {title}
          </Text>
        </span>
        {caption ? (
          <Text as="span" size="xs" variant="muted" ellipsis className="max-w-56">
            <Censored>{caption}</Censored>
          </Text>
        ) : null}
      </span>
    </Chonk>
  );
}
