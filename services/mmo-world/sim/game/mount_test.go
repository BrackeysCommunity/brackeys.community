package game

import (
	"errors"
	"testing"

	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

func TestMountUpkeepAndFeeding(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "rider", "knife")
	act := func(cmd Command) {
		t.Helper()
		cmd.Char = c.C.ID
		if _, err := g.Act(cmd); err != nil {
			t.Fatal(err)
		}
	}
	act(Command{Key: "grant", Kind: Grant, Asset: "rad-goat", Note: "test mount"})
	if c.C.Provisions > 0 {
		act(Command{Key: "empty", Kind: Correct, Asset: ledger.Provisions, Units: -c.C.Provisions, Note: "empty saddlebags"})
	}
	for g.Tick() < sheets.TicksPerDay-1 {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	version := c.Version
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
	debt := g.r.Mounts.Upkeep(1, 0)
	if debt <= 0 || c.Owed != debt || c.Fed() || c.Version <= version {
		t.Fatalf("after upkeep: owed %d, version %d", c.Owed, c.Version)
	}
	feedRefused := func(key string) {
		t.Helper()
		before, err := g.Digest()
		if err != nil {
			t.Fatal(err)
		}
		_, err = g.Act(Command{Key: key, Char: c.C.ID, Kind: Feed})
		var ref *Refused
		if !errors.As(err, &ref) || ref.Code != BadArgs {
			t.Fatalf("expected a feeding refusal, got %v", err)
		}
		after, err := g.Digest()
		if err != nil || before != after {
			t.Fatal("refused feed changed state", err)
		}
	}
	feedRefused("without-food")
	act(Command{Key: "supply", Kind: Correct, Asset: ledger.Provisions, Units: debt + 1, Note: "resupply"})
	act(Command{Key: "feed", Kind: Feed})
	if !c.Fed() || c.C.Provisions != 1 {
		t.Fatalf("owed %d, provisions %d", c.Owed, c.C.Provisions)
	}
	feedRefused("already-fed")
	audit(t, g)
}
