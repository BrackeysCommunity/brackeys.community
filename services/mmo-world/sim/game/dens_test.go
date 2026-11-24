package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
)

// plainPlace founds a settlement nobody made a city on the first free tile
// at least dist from tile h, with the charter's structures.
func plainPlace(t *testing.T, g *Game, h hex.Hex, dist int64) *Place {
	t.Helper()
	for r := dist; r <= dist+20; r++ {
		for _, at := range hex.Ring(h, r) {
			if !g.freeGround(at) || g.World.RegionAt(at) < 0 || slices.ContainsFunc(g.Places, func(p *Place) bool { return hex.Distance(p.Hex, at) < dist }) {
				continue
			}
			p := &Place{N: len(g.Places), Hex: at, Lattice: -1, Name: "Plainfield", Founded: g.Tick()}
			for _, row := range settle.Charter(g.r.Book.Structures) {
				p.Raise(row, g.Tick(), g.r.Settle)
			}
			g.Places = append(g.Places, p)
			g.Market.Trader = append(g.Market.Trader, 0)
			return p
		}
	}
	t.Fatal("no free ground for a settlement")
	return nil
}

// Every open starting settlement and every city holds one den, in place
// order, its fence the den slot's resident; a plain settlement holds none
// until it is a city.
func TestDensByPlace(t *testing.T) {
	g := storyGame(t)
	plain := plainPlace(t, g, g.SettlementHex(0), 6)
	var starting int
	for _, p := range g.Places {
		if p.Lattice >= 0 {
			starting++
		}
	}
	dens := g.Dens()
	if len(dens) != starting {
		t.Fatalf("%d dens for %d starting settlements", len(dens), starting)
	}
	for i, d := range dens {
		s, ok := g.fenceStub(d.Origin)
		if !ok || s.ID != d.Fence || d.Index != i || d.At != d.Origin || g.Places[d.Place].Hex != d.At {
			t.Fatalf("den %d is %+v, its slot's fence %+v", i, d, s)
		}
		if d.Fence != "r-"+d.Origin.Ref()+"-den-fence-0" {
			t.Fatalf("a fence is %s", d.Fence)
		}
	}
	if _, ok := g.DenAt(plain.Hex); ok {
		t.Fatal("a plain settlement holds a den")
	}
	plain.City = &settle.City{Raised: g.Tick()}
	if d, ok := g.DenAt(plain.Hex); !ok || d.Place != plain.N || len(g.Dens()) != starting+1 {
		t.Fatalf("a city holds den %+v of %d", d, len(g.Dens()))
	}
}

// A den in a ruined settlement moves at the world day to the nearest open
// settlement with no den; its fence is the same saved NPC, with its
// memory, its leaning and its id, homed there. Its fence's purse empties
// into the syndicate's sink.
func TestDormantDenMoves(t *testing.T) {
	g := storyGame(t)
	origin := g.Places[0]
	near := plainPlace(t, g, origin.Hex, 6)
	plainPlace(t, g, origin.Hex, 15)
	d, ok := g.DenAt(origin.Hex)
	if !ok {
		t.Fatal("no den in the first settlement")
	}
	n, err := g.denNPC(d, g.Tick())
	if err != nil {
		t.Fatal(err)
	}
	g.drawLeaning(n)
	g.r.NPC.Remember(n, npc.Entry{Kind: entryTraded, Player: "someone", Weight: g.r.NPC.Param("traded-weight"), Tick: g.Tick(), Thing: "fibre"}, g.Tick())
	memory, leaning, seq := slices.Clone(n.Memory), n.Leaning, n.Seq
	if err := g.post(ledger.Move("fence-purse", "test", g.Tick(), ledger.FromFaction, ledger.NPCPool(d.Fence), ledger.Coin, 12)); err != nil {
		t.Fatal(err)
	}

	if err := g.denDay(g.Tick()); err != nil {
		t.Fatal(err)
	}
	if g.Syndicate != nil {
		t.Fatal("a den moved from a settlement that stands")
	}
	if g.Ledger.Of(ledger.NPCPool(d.Fence), ledger.Coin) != 0 || g.Ledger.Of(ledger.ToSyndicate, ledger.Coin) != 12 {
		t.Fatal("the fence's purse did not empty into the syndicate's sink")
	}

	origin.Ruined = g.Tick() + 1
	if err := g.denDay(g.Tick()); err != nil {
		t.Fatal(err)
	}
	moved, ok := g.DenAt(near.Hex)
	switch {
	case !ok || moved.Fence != d.Fence || moved.Origin != origin.Hex:
		t.Fatalf("the den did not move to the nearest settlement: %+v", g.Dens())
	case g.Syndicate == nil || len(g.Syndicate.Moves) != 1 || g.Syndicate.Moves[0].Cause != denMoveDormant || g.Syndicate.Moves[0].To != near.Hex:
		t.Fatalf("the syndicate keeps %+v", g.Syndicate)
	case len(factsOf(g, factDenMoved)) != 1:
		t.Fatal("no den.moved fact")
	}
	if _, ok := g.DenAt(origin.Hex); ok {
		t.Fatal("the ruined settlement still holds a den")
	}
	after := g.NPCs.Get(d.Fence)
	if after == nil || after.Seq != seq || after.Stub.Home != near.Hex || after.Leaning != leaning || !slices.Equal(after.Memory, memory) {
		t.Fatalf("the fence moved as %+v", after)
	}
	if err := g.denDay(g.Tick()); err != nil || len(g.Syndicate.Moves) != 1 {
		t.Fatal("a moved den moved again from a settlement that stands")
	}
	audit(t, g)
}

// Dens reads a city that was never a starting settlement off the city
// itself: with City cleared by hand a den nobody met is gone, and one whose
// fence was met stays dormant until the world day moves it on. The ruin and
// the fall-back save the fence first (holdDen), so neither loses a den.
func TestFallenCityDen(t *testing.T) {
	g := storyGame(t)
	city := plainPlace(t, g, g.SettlementHex(0), 6)
	plainPlace(t, g, city.Hex, 6)
	city.City = &settle.City{Raised: g.Tick()}
	d, ok := g.DenAt(city.Hex)
	if !ok {
		t.Fatal("the city holds no den")
	}
	city.City = nil
	if _, ok := g.DenAt(city.Hex); ok {
		t.Fatal("a den nobody met outlived its city")
	}
	city.City = &settle.City{Raised: g.Tick()}
	if _, err := g.denNPC(d, g.Tick()); err != nil {
		t.Fatal(err)
	}
	city.City = nil
	still, ok := g.DenAt(city.Hex)
	if !ok || !g.dormantDen(still) {
		t.Fatal("a met fence's den is not dormant once its city fell back")
	}
	if err := g.denDay(g.Tick()); err != nil {
		t.Fatal(err)
	}
	if _, ok := g.DenAt(city.Hex); ok || g.Syndicate == nil || len(g.Syndicate.Moves) != 1 {
		t.Fatal("the fallen city's den did not move")
	}
}

// A den's fence is among the people only for a character who can find it,
// and the syndicate's notables only for the made.
func TestFenceVisibility(t *testing.T) {
	g := storyGame(t)
	c := mustCreate(t, g, "seen", "knife")
	d, ok := g.DenAt(c.C.At)
	if !ok {
		t.Fatal("no den where a character starts")
	}
	here := func() (fence, notables bool) {
		for _, p := range g.PeopleHere(c, c.C.At) {
			if p.ID == d.Fence {
				fence = p.Fence
			}
			notables = notables || (isFenceID(p.ID) || isNotableID(p.ID)) && p.ID != d.Fence
		}
		return fence, notables
	}
	if f, n := here(); f || n || g.FenceVisible(c) {
		t.Fatal("an unremarked character finds the den")
	}
	if err := g.talk(c, Command{NPC: d.Fence}); err == nil {
		t.Fatal("talked to a hidden fence")
	}
	c.C.Align().Value = -15
	if f, n := here(); !f || n {
		t.Fatalf("a crooked character sees fence %v, notables %v", f, n)
	}
	c.C.Align().Made = true
	if d.Index != 0 {
		t.Fatal("the first den is not where characters start")
	}
	if _, n := here(); !n {
		t.Fatal("the made see no notable at the first den")
	}
	c.C.Align().Value, c.C.Align().Made = 0, false
	mat := g.r.Book.Materials[0].ID
	if err := g.postAll(ledger.Move("hot-in", "test", g.Tick(), ledger.FromFaction, ledger.Char(c.C.ID), ledger.Material(mat), 2)); err != nil {
		t.Fatal(err)
	}
	g.markHot(c, []item.Spoil{{Material: mat, Qty: 2}}, g.hotMark("npc:someone", "", c.C.At, g.Tick()))
	if f, _ := here(); !f {
		t.Fatal("hot goods do not find the fence")
	}
}

// A leader at the first den and a captain over every dens-per-captain
// dens, homed at the first of them.
func TestSyndicateNotables(t *testing.T) {
	g := storyGame(t)
	per := sheets.IntParam(g.r.Book.SyndicateParams, "dens-per-captain")
	for int64(len(g.Dens())) <= per {
		p := plainPlace(t, g, g.Places[len(g.Places)-1].Hex, 5)
		p.City = &settle.City{Raised: g.Tick()}
	}
	dens := g.Dens()
	ns := g.SyndicateNotables()
	want := 1 + (int64(len(dens))+per-1)/per
	if int64(len(ns)) != want || ns[0].ID != synLeaderID || ns[0].Home != dens[0].At {
		t.Fatalf("%d dens have notables %+v", len(dens), ns)
	}
	for k, s := range ns[1:] {
		if s.Home != dens[int64(k)*per].At || s.Role != roleSynCaptain || !isNotableID(s.ID) {
			t.Fatalf("captain %d is %+v", k, s)
		}
	}
	if g.factionKeyOf(ns[0]) != syndicateKey || g.factionKeyOf(npc.Stub{ID: dens[0].Fence, Role: roleDenFence, Home: dens[0].At}) != syndicateKey {
		t.Fatal("the syndicate's people answer to another standing")
	}
}

// Syndicate standing is held to the growth bounds; the gate queues one
// invitation for a character not made, and a made character under 0 is
// unmade.
func TestSyndicateStanding(t *testing.T) {
	g := storyGame(t)
	c := mustCreate(t, g, "climber", "knife")
	gate := sheets.IntParam(g.r.Book.SyndicateParams, "gate")
	invites := func() int {
		return len(slices.DeleteFunc(slices.Clone(g.Story.Pending), func(p arc.Pending) bool { return p.Kind != arc.PendInvite || p.Char != c.C.ID }))
	}
	if err := g.addSyndicateStanding(c, gate-1, 0, g.Tick()); err != nil || invites() != 0 {
		t.Fatal("queued an invitation under the gate")
	}
	if err := g.addSyndicateStanding(c, 1, 0, g.Tick()); err != nil || invites() != 1 {
		t.Fatal("no invitation at the gate")
	}
	if err := g.addSyndicateStanding(c, 1, 0, g.Tick()); err != nil || invites() != 1 {
		t.Fatal("a second invitation while one waits")
	}
	g.Story.Pending = nil
	if err := g.addSyndicateStanding(c, -1, 0, g.Tick()); err != nil || invites() != 0 {
		t.Fatal("a loss above the gate queued an invitation")
	}
	g.Story.Rests = append(g.Story.Rests, ScopeRest{Scope: arc.ScopeInvite, Ref: char.Ref(c.C.ID), Until: g.Tick() + sheets.TicksPerDay})
	slices.SortFunc(g.Story.Rests, cmpRest)
	if err := g.addSyndicateStanding(c, 1, 0, g.Tick()); err != nil || invites() != 0 {
		t.Fatal("an invitation while the last one rests")
	}
	hi := sheets.IntParam(g.r.Growth.Params(), "standing-max")
	if err := g.addSyndicateStanding(c, 10*hi, 0, g.Tick()); err != nil || c.C.Standing.Get(syndicateKey) != hi {
		t.Fatal("syndicate standing ran past its bound")
	}

	c.C.Align().Made = true
	if err := g.addSyndicateStanding(c, -hi-1, 0, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if char.IsMade(c.C) || len(factsOf(g, factUnmade)) != 1 {
		t.Fatal("a made character under 0 stays made")
	}
}

// The first time a character is Crooked or worse, the nearest den's fence
// is saved and queues a visit to it, once.
func TestFenceComes(t *testing.T) {
	g := storyGame(t)
	c := mustCreate(t, g, "found", "knife")
	if err := g.fenceCheck(c, g.Tick()); err != nil || char.FenceFound(c.C) {
		t.Fatal("a fence came for an unremarked character")
	}
	c.C.Align().Value = -20
	if err := g.fenceCheck(c, g.Tick()); err != nil {
		t.Fatal(err)
	}
	d, _ := g.nearestDen(c.C.At)
	n := g.NPCs.Get(d.Fence)
	switch {
	case n == nil || !slices.Contains(n.Visits, c.C.ID):
		t.Fatal("the fence queued no visit")
	case !char.FenceFound(c.C) || len(factsOf(g, factFenceCame)) != 1:
		t.Fatal("the fence's coming is not kept")
	}
	if err := g.fenceCheck(c, g.Tick()); err != nil || len(factsOf(g, factFenceCame)) != 1 {
		t.Fatal("a fence came twice")
	}
}
