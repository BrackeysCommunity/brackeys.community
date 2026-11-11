import { Button } from "@/components/ui/button";

/** In place of a room's or the editor's loading view once it failed: what failed, why, and a retry. */
export function LoadFailed({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="absolute inset-0 flex items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs break-words text-muted-foreground">{error}</p>
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  );
}
