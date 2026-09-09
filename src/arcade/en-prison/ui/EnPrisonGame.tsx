import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { MicroLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import type { Bet } from "../sim/bets.ts";
import { nextTable, openRun, settleTable, spinSeed } from "../sim/run.ts";
import { previewDropZone, type SpinResult, trackPhase } from "../sim/spin.ts";
import { plainWheel } from "../sim/state.ts";
import { checkBets, closeTable, openTable, playSpin, totalStake } from "../sim/table.ts";
import { LayoutView } from "./LayoutView.tsx";

import "./theme.css";
import { useSpinPlayback } from "./useSpinPlayback.ts";
import { WheelView } from "./WheelView.tsx";

/**
 * En Prison's table screen.
 *
 * Everything with a rule attached lives in the sim; this owns the cursor
 * through it — which table, which spin, what is on the felt — and nothing
 * else. A bet is refused by `checkBets` rather than by a disabled button, so
 * the reason the player sees is the reason the validator would give.
 *
 * The floor between tables is built (`sim/floor.ts`) but has no screen yet,
 * so a cleared table currently rolls straight into the next one.
 */

const CHIPS = [1, 5, 25, 100];

export function EnPrisonGame({ seed = "demo" }: { seed?: string }) {
  const [wheel] = useState(() => plainWheel());
  const [run, setRun] = useState(() => openRun(seed));
  const [table, setTable] = useState(() => openTable(wheel, nextTable(openRun(seed)).rules, 120));
  const [bets, setBets] = useState<Bet[]>([]);
  const [chip, setChip] = useState(CHIPS[0]!);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const { balls, rotorAngle, running } = useSpinPlayback(result);
  const ball = table.wheel.balls[0]!;

  // The band the player reads before committing to a tap. It moves with the
  // rotor, which is the whole launch mechanic: waiting changes the answer.
  const band = useMemo(() => {
    const phase = trackPhase(spinSeed(run, run.tableIndex, table.spinsPlayed), ball.id);
    const preview = previewDropZone(table.wheel, ball, 0, phase);
    return { slot: preview.slot, halfWidth: preview.halfWidth };
  }, [run, table.spinsPlayed, table.wheel, ball]);

  const stake = totalStake(bets);
  const surplus = table.bankroll - table.rules.quota;

  const place = useCallback((bet: Bet) => {
    setRefusal(null);
    setBets((current) => [...current, bet]);
  }, []);

  const launch = useCallback(() => {
    const balls = [{ ballId: ball.id, launchTick: 0 }];
    const refused = checkBets(table, bets, balls);
    if (refused) {
      setRefusal(REFUSAL_COPY[refused] ?? refused);
      return;
    }
    const next = playSpin(table, bets, balls, spinSeed(run, run.tableIndex, table.spinsPlayed));
    setTable(next);
    setResult(next.spins.at(-1)!.result);
    setBets([]);
  }, [ball.id, bets, run, table]);

  const advance = useCallback(() => {
    const close = closeTable(table);
    const nextRun = settleTable(run, close);
    setRun(nextRun);
    setResult(null);
    if (nextRun.status !== "playing") return;
    setTable(openTable(table.wheel, nextTable(nextRun).rules, nextRun.bankroll));
  }, [run, table]);

  const open = table.spinsPlayed < table.rules.spins;

  return (
    <div className="en-prison mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-6">
      <header className="flex w-full items-baseline justify-between">
        <div>
          <MicroLabel>{run.status === "playing" ? nextTable(run).casino : run.status}</MicroLabel>
          <p className="font-mono text-sm">
            table {run.tableIndex + 1} · spin {Math.min(table.spinsPlayed + 1, table.rules.spins)}/
            {table.rules.spins}
          </p>
        </div>
        <div className="text-right">
          <MicroLabel>bankroll</MicroLabel>
          <p className="font-mono text-lg">{table.bankroll}</p>
        </div>
      </header>

      <WheelView
        wheel={table.wheel}
        rotorAngle={rotorAngle}
        band={result ? null : band}
        balls={balls}
        result={result?.pockets[0]?.number ?? null}
      />

      <dl className="grid w-full grid-cols-3 gap-2 text-center">
        <Stat label="quota" value={table.rules.quota} />
        <Stat
          label="surplus"
          value={surplus}
          tone={surplus < 0 ? "short" : "ok"}
          hint={surplus < 0 ? `${-surplus} short` : "safe to spend"}
        />
        <Stat label="nudges" value={table.nudgesRemaining} />
      </dl>

      {result ? (
        <p className="font-mono text-sm" role="status">
          {result.pockets[0]!.number} · {result.net >= 0 ? "+" : ""}
          {result.net}
        </p>
      ) : null}

      {open ? (
        <>
          <div className="flex w-full items-center gap-2">
            {CHIPS.map((value) => (
              <Button
                key={value}
                size="sm"
                variant={value === chip ? "default" : "outline"}
                onClick={() => setChip(value)}
                aria-pressed={value === chip}
              >
                {value}
              </Button>
            ))}
            <span className="ml-auto font-mono text-xs opacity-70">
              staked {stake} / min {table.rules.minimumBet}
            </span>
          </div>

          <LayoutView
            bets={bets}
            onPlace={place}
            chip={chip}
            disabled={running}
            className="w-full"
          />

          {refusal ? (
            <p className="text-sm text-destructive" role="alert">
              {refusal}
            </p>
          ) : null}

          <div className="flex w-full gap-2">
            <Button
              variant="outline"
              onClick={() => setBets([])}
              disabled={running || !bets.length}
            >
              Clear
            </Button>
            <Button className="flex-1" onClick={launch} disabled={running}>
              Launch
            </Button>
          </div>
        </>
      ) : (
        <div className="flex w-full flex-col items-center gap-2">
          <p className="text-sm">
            {closeTable(table).cleared
              ? `Cleared. ${closeTable(table).surplus} over the quota.`
              : `Short by ${table.rules.quota - closeTable(table).counted}.`}
          </p>
          <Button className="w-full" onClick={advance}>
            {closeTable(table).cleared ? "Next table" : "End run"}
          </Button>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "ok",
  hint,
}: {
  label: string;
  value: number;
  tone?: "ok" | "short";
  hint?: string;
}) {
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <dd className={cn("font-mono text-base", tone === "short" && "text-destructive")}>{value}</dd>
      {hint ? <p className="text-[10px] opacity-60">{hint}</p> : null}
    </div>
  );
}

const REFUSAL_COPY: Record<string, string> = {
  "below-minimum": "The table has a minimum. Put more down.",
  "over-bankroll": "You cannot cover that.",
  "table-closed": "The table is done. The shark is counting.",
  "illegal-bet": "That is not a spot on this layout.",
  "no-balls": "No ball to launch.",
  "unknown-ball": "That ball is not on this wheel.",
};
