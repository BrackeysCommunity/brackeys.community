import { cn } from "@/lib/utils";

interface ProfileBioProps {
  bio: string;
  maxLines?: number;
  className?: string;
}

export function ProfileBio({ bio, maxLines, className }: ProfileBioProps) {
  return (
    <div className={cn("relative", className)}>
      <p
        className={cn(
          "font-sans text-[13px] leading-[1.7] whitespace-pre-wrap text-muted-foreground/80",
          maxLines && `line-clamp-${maxLines}`,
        )}
      >
        {bio}
      </p>
      {maxLines && (
        <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-6 bg-linear-to-t from-background/80 to-transparent" />
      )}
    </div>
  );
}
