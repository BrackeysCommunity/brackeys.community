import { useQuery } from '@tanstack/react-query';
import { Fragment, useMemo } from 'react';
import type { ContributionDay } from '@/lib/github';
import { cn } from '@/lib/utils';
import { client } from '@/orpc/client';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

function getIntensity(count: number, max: number): number {
  if (count === 0) return 0;
  if (max === 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

const intensityClasses = [
  'bg-muted/20',
  'bg-primary/20',
  'bg-primary/40',
  'bg-primary/60',
  'bg-primary/85',
] as const;

function CalendarGrid({ weeks, totalContributions }: {
  weeks: Array<{ contributionDays: ContributionDay[] }>;
  totalContributions: number;
}) {
  const maxCount = useMemo(
    () => Math.max(1, ...weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount))),
    [weeks],
  );

  const monthHeaders = useMemo(() => {
    const headers: Array<{ label: string; col: number }> = [];
    let lastMonth = -1;

    for (let wi = 0; wi < weeks.length; wi++) {
      const firstDay = weeks[wi].contributionDays[0];
      if (!firstDay) continue;
      const month = new Date(firstDay.date).getMonth();
      if (month !== lastMonth) {
        headers.push({ label: MONTH_LABELS[month], col: wi });
        lastMonth = month;
      }
    }
    return headers;
  }, [weeks]);

  const totalCols = weeks.length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] font-bold tracking-[0.15em] text-muted-foreground/50 uppercase">
          Contributions
        </span>
        <span className="font-mono text-[10px] text-muted-foreground/40">
          {totalContributions.toLocaleString()} in the last year
        </span>
      </div>

      <div
        className="grid w-full"
        style={{
          gridTemplateColumns: `auto repeat(${totalCols}, 1fr)`,
          gridTemplateRows: `auto repeat(7, 1fr)`,
          gap: '1px',
        }}
      >
        {/* Month header row: empty label cell + week columns */}
        <div />
        {weeks.map((week, wi) => {
          const firstDay = week.contributionDays[0];
          const header = monthHeaders.find((h) => h.col === wi);
          const weekKey = firstDay?.date ?? `w${wi}`;
          return (
            <div key={weekKey} className="min-w-0">
              {header && (
                <span className="font-mono text-[7px] text-muted-foreground/30 leading-none whitespace-nowrap">
                  {header.label}
                </span>
              )}
            </div>
          );
        })}

        {/* Day rows */}
        {DAY_LABELS.map((label, dayIndex) => (
          <Fragment key={label || `day${dayIndex}`}>
            <span className="font-mono text-[7px] text-muted-foreground/25 text-right pr-0.5 self-center leading-none">
              {label}
            </span>
            {weeks.map((week) => {
              const day = week.contributionDays[dayIndex];
              if (!day) return <div key={`empty-${week.contributionDays[0]?.date}`} />;
              const intensity = getIntensity(day.contributionCount, maxCount);
              return (
                <div
                  key={day.date}
                  className={cn(
                    'aspect-square w-full rounded-[2px] transition-colors',
                    intensityClasses[intensity],
                  )}
                  title={`${day.date}: ${day.contributionCount} contribution${day.contributionCount === 1 ? '' : 's'}`}
                />
              );
            })}
          </Fragment>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-1">
        <span className="font-mono text-[7px] text-muted-foreground/25 mr-0.5">Less</span>
        {intensityClasses.map((cls) => (
          <div key={cls} className={cn('w-[8px] h-[8px] rounded-[2px]', cls)} />
        ))}
        <span className="font-mono text-[7px] text-muted-foreground/25 ml-0.5">More</span>
      </div>
    </div>
  );
}

interface ContributionCalendarProps {
  userId: string;
  className?: string;
}

export function ContributionCalendar({ userId, className }: ContributionCalendarProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['contributions', userId],
    queryFn: () => client.getContributions({ userId }),
    staleTime: 1000 * 60 * 30,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className={cn('px-5 py-4', className)}>
        <div className="animate-pulse space-y-2">
          <div className="h-2.5 w-20 bg-muted/40 rounded-sm" />
          <div className="h-[82px] bg-muted/20 rounded-sm" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className={cn('px-5 py-4 border-b border-muted/40', className)}>
      <CalendarGrid weeks={data.weeks} totalContributions={data.totalContributions} />
    </div>
  );
}
