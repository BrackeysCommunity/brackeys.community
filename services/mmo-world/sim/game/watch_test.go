package game

import (
	"errors"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

// walkBack takes a character off its settlement and steps it back in,
// running the world until the step is done.
func walkBack(t *testing.T, g *Game, c *Char) hex.Hex {
	t.Helper()
	home := c.C.At
	for d := range hex.Directions {
		off := home.Neighbour(d)
		if _, ok := g.World.EnterTicks(off, home); !ok || g.IsSettlement(off) {
			continue
		}
		if err := g.Teleport(c, off); err != nil {
			t.Fatal(err)
		}
		if _, err := g.Act(Command{Key: "back", Char: c.C.ID, Kind: Step, Dir: off.DirectionTo(home)}); err != nil {
			t.Fatal(err)
		}
		for range 10 * sheets.TicksPerHour {
			if c.Long == nil {
				return home
			}
			if _, err := g.Advance(); err != nil {
				t.Fatal(err)
			}
		}
		t.Fatal("the step back never came due")
	}
	t.Fatal("no way off the settlement")
	return home
}

// stoppedThief is a character the watch holds at its settlement after a
// seen lift there.
func stoppedThief(t *testing.T) (*Game, *Char, string) {
	t.Helper()
	g, c, tr := thiefWorld(t, 50)
	g2, c2, _ := pressTo(t, g, c.C.ID, liftCmd(tr.ID), fixed.Hundredths, theftWon, nil)
	walkBack(t, g2, c2)
	return g2, c2, tr.ID
}

func refusedUnchanged(t *testing.T, g *Game, cmd Command, code string) {
	t.Helper()
	before, _ := g.Digest()
	var ref *Refused
	if _, err := g.Act(cmd); !errors.As(err, &ref) || ref.Code != code {
		t.Fatalf("%s: %v, want %s", cmd.Kind, err, code)
	}
	if after, _ := g.Digest(); after != before {
		t.Fatalf("a refused %s changed the game", cmd.Kind)
	}
}

// Entering a settlement where it is wanted, a character is held at the
// gate: its journey ends, the fine is told, and until it pays or runs it
// may only talk, look, pay or flee.
func TestWatchStopsOnArrival(t *testing.T) {
	g, c, tr := stoppedThief(t)
	n, ok := g.StoppedNow(c)
	if !ok || c.Long != nil || char.StoppedAt(c.C) != n+1 {
		t.Fatalf("the watch did not hold the thief: stopped %d, long %+v", char.StoppedAt(c.C), c.Long)
	}
	stops := factsOfKind(g, factWatchStopped)
	w := char.WantedOf(c.C)[0]
	if len(stops) != 1 || datum(stops[0], "settlement").N != int64(n) || datum(stops[0], "fine").N != w.Coin+w.Worth {
		t.Fatalf("watch.stopped %+v for %+v", stops, w)
	}
	for _, cmd := range []Command{
		{Kind: Rest},
		{Kind: Step, Dir: 0},
		{Kind: Steal, Option: KindLift, NPC: tr},
		{Kind: Gather, Material: ledger.Provisions, Ticks: 1},
	} {
		cmd.Key, cmd.Char = "held-"+cmd.Kind, c.C.ID
		refusedUnchanged(t, g, cmd, StoppedCode)
	}
	if _, err := g.Act(Command{Key: "talk", Char: c.C.ID, Kind: Talk, NPC: tr}); err != nil {
		var ref *Refused
		if errors.As(err, &ref) && ref.Code == StoppedCode {
			t.Fatal("a held character may not talk")
		}
	}
	if _, err := g.Act(Command{Key: "look", Char: c.C.ID, Kind: Look}); err != nil && strings.Contains(err.Error(), StoppedCode) {
		t.Fatal("a held character may not look")
	}
	// Once its entries run out the watch lets it go.
	c.C.Alignment.Wanted[0].Ends = g.Tick()
	if _, ok := g.StoppedNow(c); ok {
		t.Fatal("the watch holds a character it no longer wants")
	}
	audit(t, g)
}

// Paying the fine sends the lifted coin back to the purse and the haul's
// worth into the fees sink, and lets the character go; one short of coin
// cannot pay.
func TestPayFineConserved(t *testing.T) {
	g, c, tr := stoppedThief(t)
	w := char.WantedOf(c.C)[0]
	n, _ := g.StoppedNow(c)
	if fine, ok := g.FineAt(c, n); !ok || fine != w.Coin+w.Worth || g.WantedFine(c, 0) != fine || !slices.Contains(g.WantedPlaces(c, 0), n) {
		t.Fatalf("the watch asks %d (%v), one entry %d at %v", fine, ok, g.WantedFine(c, 0), g.WantedPlaces(c, 0))
	}
	acc := ledger.Char(c.C.ID)
	keep := c.C.Coin
	if err := g.postAll(ledger.Move("spend", "test", g.Tick(), acc, ledger.ToFees, ledger.Coin, keep)); err != nil {
		t.Fatal(err)
	}
	refusedUnchanged(t, g, Command{Key: "pay-short", Char: c.C.ID, Kind: PayFine}, ShortCode)
	fund(t, g, acc, ledger.Coin, w.Coin+w.Worth)
	hold(c.C, ledger.Coin, w.Coin+w.Worth)
	before := map[string]int64{}
	for _, b := range g.Ledger.Balances() {
		before[b.Account+"|"+b.Asset] = b.Units
	}
	if _, err := g.Act(Command{Key: "pay", Char: c.C.ID, Kind: PayFine}); err != nil {
		t.Fatal(err)
	}
	delta := func(account, asset string) int64 { return g.Ledger.Of(account, asset) - before[account+"|"+asset] }
	switch {
	case delta(acc, ledger.Coin) != -(w.Coin + w.Worth):
		t.Fatalf("the thief paid %d", -delta(acc, ledger.Coin))
	case delta(ledger.NPCPool(tr), ledger.Coin) != w.Coin:
		t.Fatalf("the purse got back %d of %d", delta(ledger.NPCPool(tr), ledger.Coin), w.Coin)
	case delta(ledger.ToFees, ledger.Coin) != w.Worth:
		t.Fatalf("the fees took %d, want %d", delta(ledger.ToFees, ledger.Coin), w.Worth)
	}
	for _, b := range g.Ledger.Balances() {
		if strings.HasPrefix(b.Account, ledger.Source) && b.Units != before[b.Account+"|"+b.Asset] {
			t.Fatalf("paying the fine drew on %s", b.Account)
		}
	}
	if _, ok := g.StoppedNow(c); ok || char.StoppedAt(c.C) != 0 || len(char.WantedOf(c.C)) != 0 || len(factsOfKind(g, factWatchPaid)) != 1 {
		t.Fatal("paying off left the thief held or wanted")
	}
	audit(t, g)
}

// Running and getting away leaves the character free but still wanted.
func TestFleeWon(t *testing.T) {
	g, c, _ := stoppedThief(t)
	g2, c2, f := pressTo(t, g, c.C.ID, Command{Kind: Flee}, -1, theftWon, nil)
	n, _ := g.StoppedNow(c)
	switch {
	case f.Kind != factWatchFled || datum(f, "settlement").N != int64(n):
		t.Fatalf("a flight away wrote %+v", f)
	case char.StoppedAt(c2.C) != 0 || len(char.WantedOf(c2.C)) != 1 || c2.C.Has(char.Down, g2.Tick()):
		t.Fatal("a flight away left the thief held, unwanted or down")
	}
	audit(t, g2)
}

// Run down, the character goes down and the goods it holds go back with no
// fine; what the watch there wanted it for ends.
func TestFleeLost(t *testing.T) {
	g, c, mat := burgleWorld(t)
	g2, c2, _ := pressTo(t, g, c.C.ID, Command{Kind: Steal, Option: KindBurgle}, fixed.Hundredths, theftWon, nil)
	walkBack(t, g2, c2)
	if _, ok := g2.StoppedNow(c2); !ok {
		t.Fatal("the burglar was not held")
	}
	store := g2.Ledger.Of(ledger.StorePool(0), ledger.Material(mat))
	units := g2.HotUnits(c2, mat, g2.Tick()/sheets.TicksPerDay)
	coin := c2.C.Coin
	g3, c3, f := pressTo(t, g2, c2.C.ID, Command{Kind: Flee}, -1, theftLost, nil)
	switch {
	case f.Kind != factWatchCaught || datum(f, "worth").N != char.WantedOf(c2.C)[0].Worth:
		t.Fatalf("a flight run down wrote %+v", f)
	case !c3.C.Has(char.Down, g3.Tick()):
		t.Fatal("a flight run down left the thief up")
	case g3.Ledger.Of(ledger.StorePool(0), ledger.Material(mat)) != store+units || g3.hotHeld(c3, mat) != 0:
		t.Fatal("the goods did not go back to the store")
	case c3.C.Coin != coin || char.StoppedAt(c3.C) != 0 || len(char.WantedOf(c3.C)) != 0:
		t.Fatal("a flight run down fined the thief or left it held or wanted")
	}
	audit(t, g3)
}

// A hold whose entries lapse ends when the character walks off, so a later
// entry that applies at that settlement does not hold it somewhere else.
func TestStaleHoldEndsOffTheGate(t *testing.T) {
	g, c, _ := stoppedThief(t)
	n, ok := g.StoppedNow(c)
	if !ok {
		t.Fatal("the thief was not held")
	}
	h := g.SettlementHex(n)
	a := c.C.Alignment
	for i := range a.Wanted {
		a.Wanted[i].Ends = g.Tick()
	}
	var off hex.Hex
	for d := range hex.Directions {
		if off = h.Neighbour(d); !g.IsSettlement(off) {
			break
		}
	}
	c.C.At = off
	if err := g.tileEntered(c, off, g.Tick()); err != nil {
		t.Fatal(err)
	}
	holder := g.holderAt(h)
	a.Wanted = append(a.Wanted, char.Wanted{Victim: "npc:elsewhere", Faction: standingKey(holder, h), Place: n,
		Ends: g.Tick() + g.hotCell("wanted-days")*sheets.TicksPerDay})
	if _, ok := g.StoppedNow(c); ok || char.StoppedAt(c.C) != 0 {
		t.Fatalf("the watch holds the character off its gate: stopped %d", char.StoppedAt(c.C))
	}
	if err := g.watchGuard(c, Travel); err != nil {
		t.Fatalf("a character off the gate may not travel: %v", err)
	}
}
