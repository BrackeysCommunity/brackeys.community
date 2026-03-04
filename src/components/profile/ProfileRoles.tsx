import { cn } from '@/lib/utils';

const ROLE_COLORS: Record<string, { border: string; text: string; bg: string }> = {
  staff:     { border: 'border-red-500/40',    text: 'text-red-400',    bg: 'bg-red-500/10' },
  moderator: { border: 'border-emerald-500/40', text: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  admin:     { border: 'border-red-500/40',    text: 'text-red-400',    bg: 'bg-red-500/10' },
  helper:    { border: 'border-sky-500/40',    text: 'text-sky-400',    bg: 'bg-sky-500/10' },
};

const DEFAULT_ROLE_STYLE = {
  border: 'border-[#5865f2]/40',
  text: 'text-[#5865f2]',
  bg: 'bg-[#5865f2]/10',
};

function getRoleStyle(role: string) {
  const key = role.toLowerCase();
  for (const [match, style] of Object.entries(ROLE_COLORS)) {
    if (key.includes(match)) return style;
  }
  return DEFAULT_ROLE_STYLE;
}

interface ProfileRolesProps {
  roles: string[];
  className?: string;
}

export function ProfileRoles({ roles, className }: ProfileRolesProps) {
  if (roles.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {roles.map((role) => {
        const style = getRoleStyle(role);
        return (
          <span
            key={role}
            className={cn(
              'inline-flex items-center px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest uppercase transition-colors',
              style.border,
              style.text,
              style.bg,
              `border hover:brightness-125`,
            )}
          >
            {role}
          </span>
        );
      })}
    </div>
  );
}
