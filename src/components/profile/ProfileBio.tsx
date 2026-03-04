import { cn } from '@/lib/utils';

interface ProfileBioProps {
  bio: string;
  maxLines?: number;
  className?: string;
}

export function ProfileBio({ bio, maxLines, className }: ProfileBioProps) {
  return (
    <div className={cn('relative', className)}>
      <p
        className={cn(
          'font-sans text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap',
          maxLines && `line-clamp-${maxLines}`,
        )}
      >
        {bio}
      </p>
      {maxLines && (
        <div className="absolute bottom-0 left-0 right-0 h-6 bg-linear-to-t from-background/80 to-transparent pointer-events-none" />
      )}
    </div>
  );
}
