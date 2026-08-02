import { Text } from "@/components/ui/typography";

/**
 * `LABEL ····· value` row used by the sidebar cards (HIRE DETAILS,
 * STANDING). Dashed leader fills the gap so the rows read as the
 * same coded-block language as the section headers.
 */
export function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <Text size="xs" variant="muted" className="shrink-0 tracking-widest uppercase">
        {label}
      </Text>
      <div aria-hidden className="flex-1 border-t border-dashed border-muted-foreground/25" />
      <Text size="sm" bold className="shrink-0 text-right tabular-nums">
        {value}
      </Text>
    </div>
  );
}
