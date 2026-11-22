package arc

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

var (
	debtRow   = row("the-debt", Personal, "character", "character", "npc", "npc", "seat", "settlement")
	returnRow = row("the-return", Personal, "character", "character", "home", "settlement", "elsewhere", "settlement")
	oathRow   = row("the-oath", Personal, "character", "character", "board", "settlement")
	rivalRow  = row("the-rival", Personal, "character", "character", "faction", "faction", "notable", "notable", "seat", "settlement")
)

func pend(w *fake, kind, char string, ref fact.Ref, day int64) fact.ID {
	w.nextFact++
	w.pending = append(w.pending, Pending{Kind: kind, Char: char, Ref: ref, Tick: day * sheets.TicksPerDay, Fact: w.nextFact})
	return w.nextFact
}

func npcRef(id string) fact.Ref { return fact.Ref{Kind: kindNPC, ID: id} }

func TestDebt(t *testing.T) {
	w := newFake(3)
	w.place(0, nearSettlement)
	w.place(2, nearSettlement)
	w.homes["npc-1"] = hex.Hex{Q: 19}
	none(t, run(t, w, "npc-owed", debtRow))

	older := pend(w, PendDebt, "c-1", npcRef("npc-1"), 12)
	pend(w, PendDebt, "c-1", npcRef("npc-2"), 15)
	c := one(t, run(t, w, "npc-owed", debtRow))
	bound(t, c, "character", charRef("c-1"))
	bound(t, c, "npc", npcRef("npc-1"))
	bound(t, c, "seat", SettlementRef(1))
	if c.Char != "c-1" || c.Pressure != 8 || !slices.Equal(c.Causes, []fact.ID{older}) || !slices.Equal(c.Regions, []int{2}) {
		t.Fatalf("char %s pressure %d causes %v regions %v", c.Char, c.Pressure, c.Causes, c.Regions)
	}

	none(t, run(t, plain{w}, "npc-owed", debtRow))
	w.setBusy(Personal, charRef("c-1"))
	none(t, run(t, w, "npc-owed", debtRow))
}

func TestReturn(t *testing.T) {
	w := newFake(3)
	w.place(0, nearSettlement)
	w.place(2, nearSettlement)
	pend(w, PendReturn, "c-2", SettlementRef(1), 19)
	c := one(t, run(t, w, "came-back", returnRow))
	bound(t, c, "home", SettlementRef(1))
	bound(t, c, "elsewhere", SettlementRef(0))
	if c.Seat != w.places[1].Hex || !slices.Equal(c.Regions, []int{0, 2}) {
		t.Fatalf("seat %v regions %v", c.Seat, c.Regions)
	}

	w.places[0].Ruined = true
	none(t, run(t, w, "came-back", returnRow))
	w.places[0].Ruined, w.places[1].Open = false, false
	none(t, run(t, w, "came-back", returnRow))
}

func TestOath(t *testing.T) {
	w := newFake(2)
	w.place(1, nearSettlement)
	broke := pend(w, PendOath, "c-3", SettlementRef(0), 18)
	c := one(t, run(t, w, "vow-broken", oathRow))
	bound(t, c, "board", SettlementRef(0))
	bound(t, c, "character", charRef("c-3"))
	if !slices.Equal(c.Causes, []fact.ID{broke}) || !slices.Equal(c.Regions, []int{1}) {
		t.Fatalf("causes %v regions %v", c.Causes, c.Regions)
	}

	w.places[0].Ruined = true
	none(t, run(t, w, "vow-broken", oathRow))
}

func TestRival(t *testing.T) {
	w := newFake(3)
	w.place(0, nearSettlement)
	w.place(2, nearSettlement)
	w.faction("compact", militant, 2, 50, 2)
	w.factions[0].Notables = []NotableView{{ID: "n-7", Role: roleLeader, Loyalty: 60, Leading: true}}
	pend(w, PendRival, "c-4", FactionRef(0), 19)
	c := one(t, run(t, w, "lost-to-them", rivalRow))
	bound(t, c, "faction", FactionRef(0))
	bound(t, c, "notable", notableRef("n-7"))
	bound(t, c, "seat", SettlementRef(1))
	if !slices.Equal(c.Regions, []int{2}) {
		t.Fatalf("regions %v", c.Regions)
	}

	w.factions[0].Notables[0].Dead = true
	none(t, run(t, w, "lost-to-them", rivalRow))
	w.factions[0].Notables[0].Dead, w.factions[0].Fallen = false, true
	none(t, run(t, w, "lost-to-them", rivalRow))
}
