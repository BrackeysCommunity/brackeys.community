package store_test

import (
	"context"
	"testing"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store/pgtest"
)

// The readers of recorded play give back what was stored, by tick range,
// and Counts agrees with them.
func TestRecordedPlayReaders(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	st, g, c := founded(t, ctx, pool, rules(t))
	testkit.Act(t, ctx, st, g, game.Command{Key: "i-2", Char: c.C.ID, Kind: game.Correct, Asset: ledger.Coin, Units: 5, Note: "test purse"}, "")
	testkit.Ticks(t, ctx, st, g, sheets.TicksPerDay+2)
	testkit.Act(t, ctx, st, g, game.Command{Key: "i-3", Char: c.C.ID, Kind: game.Rest, Ticks: 1}, "")
	end := g.Tick() + 1

	acts, err := st.ActionsBetween(ctx, 0, end)
	if err != nil {
		t.Fatal(err)
	}
	if len(acts) != 3 || acts[0].Cmd.Kind != game.Create || acts[1].Cmd.Key != "i-2" || acts[2].AfterTick != g.Tick() || acts[2].Character != c.C.ID {
		t.Fatalf("actions %+v", acts)
	}
	if late, err := st.ActionsBetween(ctx, 1, end); err != nil || len(late) != 1 || late[0].InteractionID != "i-3" {
		t.Fatalf("actions after tick 1: %+v %v", late, err)
	}
	facts, err := st.FactsBetween(ctx, 0, end)
	if err != nil {
		t.Fatal(err)
	}
	for i, f := range facts {
		if i > 0 && f.ID <= facts[i-1].ID {
			t.Fatalf("facts out of order at %d", i)
		}
	}
	day, err := st.FactsBetween(ctx, 1, sheets.TicksPerDay)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range day {
		if f.Tick < 1 || f.Tick >= sheets.TicksPerDay {
			t.Fatalf("fact %d at tick %d read for [1, %d)", f.ID, f.Tick, sheets.TicksPerDay)
		}
	}
	snaps, err := st.SnapshotsBetween(ctx, 0, end)
	if err != nil {
		t.Fatal(err)
	}
	if len(snaps) != 2 || snaps[0].Tick != 0 || snaps[1].Tick != sheets.TicksPerDay || len(snaps[1].Body) == 0 || snaps[1].Digest == "" {
		t.Fatalf("%d snapshots", len(snaps))
	}
	if later, err := st.SnapshotsBetween(ctx, 1, end); err != nil || len(later) != 1 {
		t.Fatalf("snapshots after tick 1: %d %v", len(later), err)
	}
	ticks, err := st.TicksBetween(ctx, 0, g.Tick())
	if err != nil {
		t.Fatal(err)
	}
	if int64(len(ticks)) != g.Tick() || ticks[0].Tick != 1 || ticks[len(ticks)-1].Digest == "" {
		t.Fatalf("%d ticks for %d", len(ticks), g.Tick())
	}
	n, err := st.Counts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n.Actions != 3 || n.Snapshots != 2 || n.LastSnapshotTick != sheets.TicksPerDay || n.Ticks != g.Tick() || n.Characters != 1 ||
		n.Facts != int64(g.Log.Count) || n.Facts != int64(len(facts)) || n.LedgerTxns != g.Ledger.Posted || n.LedgerEntries < n.LedgerTxns {
		t.Fatalf("counts %+v", n)
	}
}
