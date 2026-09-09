import { cn } from "@/lib/utils";

import { type Bet, betNumbers } from "../sim/bets.ts";
import { pocketColor } from "../sim/wheel.ts";

/**
 * The felt: the numbers grid and the outside bets, sized for a thumb.
 *
 * Only the bets `07` puts in the thumb zone are here — straight-up, dozens,
 * columns and the even-money row. Splits, streets, corners and six-lines are
 * real bets the sim already resolves, but they are placed by touching a line
 * between two spots, which needs a gesture layer this does not have yet.
 */

export type LayoutViewProps = {
  bets: readonly Bet[];
  onPlace: (bet: Bet) => void;
  chip: number;
  disabled?: boolean;
  className?: string;
};

const ROWS = Array.from({ length: 12 }, (_, row) => [row * 3 + 1, row * 3 + 2, row * 3 + 3]);

export function LayoutView({ bets, onPlace, chip, disabled, className }: LayoutViewProps) {
  const staked = new Map<string, number>();
  for (const bet of bets) {
    const key = betKey(bet);
    staked.set(key, (staked.get(key) ?? 0) + bet.amount);
  }

  const spot = (bet: Bet, label: string, extra?: string) => {
    const key = betKey(bet);
    const amount = staked.get(key) ?? 0;
    return (
      <button
        key={key}
        type="button"
        disabled={disabled}
        onClick={() => onPlace({ ...bet, amount: chip } as Bet)}
        aria-label={`${label}, ${amount} chips`}
        className={cn(
          "relative flex min-h-9 items-center justify-center rounded-sm border border-white/15 text-xs font-medium text-white transition-colors",
          "disabled:opacity-40",
          extra,
        )}
      >
        {label}
        {amount > 0 ? (
          <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--ep-mark)] px-1 font-mono text-[10px] text-black">
            {amount}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="grid grid-cols-3 gap-1">
        {spot(
          { kind: "straight", amount: chip, number: 0 },
          "0",
          "col-span-3 bg-[var(--ep-green)]",
        )}
      </div>

      <div className="grid grid-cols-3 gap-1">
        {ROWS.flatMap((row) =>
          row.map((n) =>
            spot(
              { kind: "straight", amount: chip, number: n },
              String(n),
              pocketColor(n) === "red" ? "bg-[var(--ep-red)]" : "bg-[var(--ep-black)]",
            ),
          ),
        )}
      </div>

      <div className="grid grid-cols-3 gap-1">
        {[0, 1, 2].map((dozen) =>
          spot(
            { kind: "dozen", amount: chip, dozen },
            `${dozen * 12 + 1}-${dozen * 12 + 12}`,
            "bg-white/5",
          ),
        )}
      </div>

      <div className="grid grid-cols-3 gap-1">
        {[0, 1, 2].map((column) =>
          spot({ kind: "column", amount: chip, column }, `col ${column + 1}`, "bg-white/5"),
        )}
      </div>

      <div className="grid grid-cols-6 gap-1">
        {(["low", "even", "red", "black", "odd", "high"] as const).map((pick) =>
          spot(
            { kind: "evenMoney", amount: chip, pick },
            pick === "low" ? "1-18" : pick === "high" ? "19-36" : pick,
            pick === "red"
              ? "bg-[var(--ep-red)]"
              : pick === "black"
                ? "bg-[var(--ep-black)]"
                : "bg-white/5",
          ),
        )}
      </div>
    </div>
  );
}

/** Two bets stack on the felt when they cover the same spot the same way. */
export function betKey(bet: Bet): string {
  switch (bet.kind) {
    case "straight":
      return `straight:${bet.number}`;
    case "dozen":
      return `dozen:${bet.dozen}`;
    case "column":
      return `column:${bet.column}`;
    case "evenMoney":
      return `even:${bet.pick}`;
    default:
      return `${bet.kind}:${betNumbers(bet).join("-")}`;
  }
}
