package game

import (
	"fmt"
	"slices"
	"testing"
	"time"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/season"
	"jams.team/mmo-world/sim/sheets"
)

// routeDistance is how near a tile comes to an NPC's home or route.
func routeDistance(n *npc.NPC, h hex.Hex) int64 {
	d := hex.Distance(n.Stub.Home, h)
	for _, s := range n.Route {
		d = min(d, hex.Distance(s, h))
	}
	return d
}

// stepPair finds two neighbouring tiles a character can step between,
// the first want(from) and the second want(to).
func stepPair(t *testing.T, g *Game, c *Char, around hex.Hex, radius int64, from, to func(hex.Hex) bool) (hex.Hex, hex.Hex) {
	t.Helper()
	for r := int64(1); r <= radius; r++ {
		for _, a := range hex.Ring(around, r) {
			if !from(a) || g.World.RegionAt(a) < 0 {
				continue
			}
			for d := range hex.Directions {
				b := a.Neighbour(d)
				if !to(b) {
					continue
				}
				if _, _, ok := g.EnterCost(c, a, b, g.Tick()); ok {
					return a, b
				}
			}
		}
	}
	t.Fatal("no tiles to step between")
	return hex.Hex{}, hex.Hex{}
}

// stepTo has a character step onto a neighbouring tile and waits for it to
// arrive; an ambush on the way is left standing.
func stepTo(t *testing.T, g *Game, c *Char, to hex.Hex) {
	t.Helper()
	if _, err := g.Act(Command{Key: fmt.Sprintf("step-%s-%d", c.C.ID, g.Log.Len()), Char: c.C.ID, Kind: Step, Dir: c.C.At.DirectionTo(to)}); err != nil {
		t.Fatal(err)
	}
	for c.Long != nil {
		dirTick(t, g)
	}
	if c.C.At != to {
		t.Fatalf("%s stands at %v, not %v", c.C.ID, c.C.At, to)
	}
	c.Fight = nil
}

func calledBy(p []Person, id string) bool {
	return slices.ContainsFunc(p, func(x Person) bool { return x.ID == id && x.Called })
}

// TestVisitCallsOnTheRoute: an NPC with a visit queued comes to a
// character on the first tile it enters within visit-range of the NPC's
// home or route, walks along while it stays in range, and is gone once the
// character moves out of it.
func TestVisitCallsOnTheRoute(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "caller", "knife")
	n := meetResidents(t, g, c)["settlement-smith"]
	g.NPCs.Queue(n, c.C.ID)
	reach := g.r.NPC.Param("visit-range")
	out, in := stepPair(t, g, c, n.Stub.Home, reach+g.r.NPC.Param("route-reach")+2,
		func(h hex.Hex) bool { return routeDistance(n, h) == reach+1 },
		func(h hex.Hex) bool { return routeDistance(n, h) == reach })
	c.C.At = out
	stepTo(t, g, c, in)
	if len(c.Callers) != 1 || c.Callers[0].NPC != n.Stub.ID || c.Callers[0].At != in {
		t.Fatalf("callers on entering %v: %+v", in, c.Callers)
	}
	called := factsOf(g, "npc.called")
	if len(called) != 1 || !slices.Contains(called[0].Subjects, npc.Ref(n.Stub.ID)) || !slices.Contains(called[0].Subjects, char.Ref(c.C.ID)) {
		t.Fatalf("npc.called facts %+v", called)
	}
	if !calledBy(g.PeopleHere(c, in), n.Stub.ID) {
		t.Fatal("the caller is not among the people here")
	}
	if calledBy(g.PeopleHere(c, out), n.Stub.ID) {
		t.Fatal("the caller is shown on a tile the character is not on")
	}
	walked := false
	for d := range hex.Directions {
		next := in.Neighbour(d)
		if routeDistance(n, next) > reach || next == out {
			continue
		}
		if _, _, ok := g.EnterCost(c, in, next, g.Tick()); !ok {
			continue
		}
		stepTo(t, g, c, next)
		if len(c.Callers) != 1 || c.Callers[0].At != next || len(factsOf(g, "npc.called")) != 1 {
			t.Fatalf("a caller still in range walks along without calling again: %+v", c.Callers)
		}
		stepTo(t, g, c, in)
		walked = true
		break
	}
	if !walked {
		t.Fatal("no tile in range beside the first to walk on to")
	}
	stepTo(t, g, c, out)
	if len(c.Callers) != 0 || calledBy(g.PeopleHere(c, out), n.Stub.ID) {
		t.Fatalf("the caller stayed once the character moved out of range: %+v", c.Callers)
	}
	if _, err := g.Act(Command{Key: "back-in", Char: c.C.ID, Kind: Step, Dir: out.DirectionTo(in)}); err != nil {
		t.Fatal(err)
	}
	for c.Long != nil {
		dirTick(t, g)
	}
	c.Fight = nil
	if _, err := g.Act(Command{Key: "talk-caller", Char: c.C.ID, Kind: Talk, NPC: n.Stub.ID}); err != nil {
		t.Fatalf("a caller cannot be talked to: %v", err)
	}
	if slices.Contains(n.Visits, c.C.ID) {
		t.Fatal("talking to the caller left its visit queued")
	}
}

// TestVisitOutOfRangeWaitsForTheHub: a queued NPC far from every tile the
// character enters never calls; the recap still lists it.
func TestVisitOutOfRangeWaitsForTheHub(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "far", "knife")
	n := meetResidents(t, g, c)["settlement-smith"]
	g.NPCs.Queue(n, c.C.ID)
	far := g.r.NPC.Param("visit-range") + g.r.NPC.Param("route-reach") + 4
	from, to := stepPair(t, g, c, n.Stub.Home, far+8,
		func(h hex.Hex) bool { return routeDistance(n, h) > far },
		func(h hex.Hex) bool { return routeDistance(n, h) > far })
	c.C.At = from
	stepTo(t, g, c, to)
	if len(c.Callers) != 0 || len(factsOf(g, "npc.called")) != 0 {
		t.Fatalf("an NPC out of range called: %+v", c.Callers)
	}
	if !slices.ContainsFunc(g.Recap(c, nil, nil).Lines, func(l RecapLine) bool { return l.Rule == RecapVisit && l.NPC == n.Stub.ID }) {
		t.Fatal("the recap does not list the NPC that wants a word")
	}
}

// TestVisitQueueKept: under a season a character has at most visit-kept
// visits queued; a world without one queues as it always did.
func TestVisitQueueKept(t *testing.T) {
	for _, story := range []bool{true, false} {
		g := guardGame(t)
		if !story {
			g.Story = nil
		}
		c, d := mustCreate(t, g, "wanted", "knife"), mustCreate(t, g, "also", "knife")
		kept := g.r.NPC.Param("visit-kept")
		home := g.SettlementHex(0)
		for i := range kept + 1 {
			n := g.NPCs.Save(npc.Stub{ID: fmt.Sprintf("v-%02d", i), Kind: npc.Wanderer, Role: "road-scout", Name: "x", Home: home}, 0)
			e := npc.Entry{Kind: entryHelped, Player: c.C.ID, Weight: g.r.NPC.Param("visit-salience"), Tick: g.Tick()}
			if err := g.note(n, c, e, g.Tick()); err != nil {
				t.Fatal(err)
			}
			e.Player = d.C.ID
			if i == 0 {
				if err := g.note(n, d, e, g.Tick()); err != nil {
					t.Fatal(err)
				}
			}
		}
		want := kept
		if !story {
			want = kept + 1
		}
		if got := int64(len(g.Visitors(c))); got != want {
			t.Fatalf("story %v: %d visits queued, want %d", story, got, want)
		}
		if len(g.Visitors(d)) != 1 {
			t.Fatal("the cap is per character")
		}
		if story && int64(len(pendingOf(g, c, arc.PendDebt))) != kept {
			t.Fatalf("%d debts pending for %d visits", len(pendingOf(g, c, arc.PendDebt)), kept)
		}
	}
}

// TestDormantBySeason: under a clock an NPC sleeps once nobody has met it
// since the previous season began, however few days that is; waking keeps
// its oldest dormant-summary entries and tallies the rest. A queued topic
// wakes it first, so what it hears then is kept.
func TestDormantBySeason(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "sleeper", "knife")
	people := meetResidents(t, g, c)
	n, m := people["settlement-smith"], people["settlement-keeper"]
	day := int64(sheets.TicksPerDay)
	for i := range int64(8) {
		g.r.NPC.Remember(n, npc.Entry{Kind: "greeted", Player: "someone", Weight: 1, Tick: i}, i)
		g.r.NPC.Remember(m, npc.Entry{Kind: "greeted", Player: "someone", Weight: 1, Tick: i}, i)
	}
	if g.dormant(n, 13*day) {
		t.Fatal("asleep in season zero")
	}
	g.World.Tick = 70 * day
	g.Story.Clock = &season.Clock{N: 2, Start: 56, Days: 42}
	n.Met[slices.IndexFunc(n.Met, func(x npc.Meeting) bool { return x.Player == c.C.ID })].Tick = 20 * day
	if g.dormant(n, g.Tick()) || !g.r.NPC.Dormant(n, g.Tick()) {
		t.Fatal("met last season, an NPC is awake under the clock and asleep by dormant-days")
	}
	for i := range n.Met {
		n.Met[i].Tick = min(n.Met[i].Tick, 13*day)
	}
	if !g.dormant(n, g.Tick()) {
		t.Fatal("not met since the previous season began, an NPC is awake")
	}
	before := len(factsOf(g, "npc.woke"))
	if _, err := g.Act(Command{Key: "wake", Char: c.C.ID, Kind: Talk, NPC: n.Stub.ID}); err != nil {
		t.Fatal(err)
	}
	keep := g.r.NPC.Param("dormant-summary")
	if int64(len(n.Archived)) != keep || n.Archived[0].Tick != 0 || len(n.Memory) != 0 || n.Summary.Get("greeted") != 8-keep {
		t.Fatalf("woke with archive %+v, memory %d, summary %v", n.Archived, len(n.Memory), n.Summary)
	}
	woke := factsOf(g, "npc.woke")
	if len(woke) != before+1 || !slices.Contains(woke[len(woke)-1].Subjects, npc.Ref(n.Stub.ID)) {
		t.Fatalf("npc.woke facts %+v", woke)
	}
	if g.dormant(n, g.Tick()) {
		t.Fatal("still asleep after a meeting")
	}

	for i := range m.Met {
		m.Met[i].Tick = 0
	}
	e := npc.Entry{Kind: entryHelped, Player: c.C.ID, Weight: g.r.NPC.Param("visit-salience"), Tick: g.Tick()}
	if err := g.note(m, c, e, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if len(m.Archived) != int(keep) || len(m.Memory) != 1 || m.Memory[0].Kind != entryHelped {
		t.Fatalf("a queued topic woke it to archive %d, memory %+v", len(m.Archived), m.Memory)
	}
	e.Player = "someone-else"
	if err := g.note(m, &Char{C: &char.Character{ID: "someone-else"}}, e, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if len(m.Memory) != 2 || len(factsOf(g, "npc.woke")) != before+2 {
		t.Fatalf("a second topic woke it again: memory %+v", m.Memory)
	}
}

// TestNPCDayCostFlat: a world day costs the same with 10 and 10,000 saved
// NPCs under a season: nothing walks the saved NPCs, so none is touched
// and the book's chain stands (the Social run's shape, at small size).
func TestNPCDayCostFlat(t *testing.T) {
	cost := func(n int) time.Duration {
		g := guardGame(t)
		c := mustCreate(t, g, "visited", "knife")
		home := g.SettlementHex(0)
		for i := range n {
			s := g.NPCs.Save(npc.Stub{ID: fmt.Sprintf("w-%08d", i), Kind: npc.Wanderer, Role: "road-scout", Name: "x", Home: home}, 0)
			s.Route = []hex.Hex{home}
			if i == 0 {
				g.NPCs.Queue(s, c.C.ID)
			}
		}
		g.NPCs.Rebuild()
		g.NPCs.Flush()
		chain := g.NPCs.Chain
		best := time.Duration(0)
		for day := range 4 {
			start := time.Now()
			for range sheets.TicksPerDay {
				dirTick(t, g)
			}
			if took := time.Since(start); day > 0 && (best == 0 || took < best) {
				best = took
			}
		}
		if touched := len(g.NPCs.Flush()); touched != 0 || g.NPCs.Chain != chain {
			t.Fatalf("%d NPCs: %d touched by world days", n, touched)
		}
		return best
	}
	small, big := cost(10), cost(10_000)
	if big > 3*small+50*time.Millisecond {
		t.Fatalf("a world day takes %v with 10,000 NPCs and %v with 10", big, small)
	}
}

// TestRecapStoryLines: since it left, a character's recap names the arcs
// that ended in the world, in its regions and its own threads, and the
// troubles held or lost at its places; nothing of the kind without a
// season.
func TestRecapStoryLines(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "reader", "knife")
	c.Seen = 0
	mine := g.World.RegionAt(c.C.At)
	other := (mine + 1) % len(g.World.Regions)
	w := g.NewsWeight()
	ended := func(id fact.ID, subject fact.Ref) fact.Fact {
		return fact.Fact{ID: id, Tick: 5, Kind: factArcEnded, Weight: w, Subjects: []fact.Ref{{Kind: "arc", ID: "arc-1"}, subject}}
	}
	trouble := func(id fact.ID, kind string, place int64) fact.Fact {
		return fact.Fact{ID: id, Tick: 5, Kind: kind, Weight: w, Data: []fact.Datum{fact.N(datumSettlement, place)}}
	}
	world := ended(1, fact.Ref{Kind: scopeSubject, ID: arc.ScopeWorld})
	here := ended(2, arc.RegionRef(mine))
	there := ended(3, arc.RegionRef(other))
	lost := trouble(4, factTroubleLost, 0)
	away := trouble(5, factTroubleHeld, 7)
	thread := fact.Fact{ID: 6, Tick: 5, Kind: factThreadEnded, Weight: 1, Subjects: []fact.Ref{char.Ref(c.C.ID)}}
	old := ended(7, fact.Ref{Kind: scopeSubject, ID: arc.ScopeWorld})
	old.Tick = 0
	heavy := []fact.Fact{world, here, there, lost, away, old}
	rules := func(r Recap, rule int) []fact.ID {
		var out []fact.ID
		for _, l := range r.Lines {
			if l.Rule == rule {
				out = append(out, l.Fact.ID)
			}
		}
		return out
	}
	got := g.Recap(c, []fact.Fact{thread}, heavy)
	if a := rules(got, RecapArc); !slices.Equal(a, []fact.ID{6, 2, 1}) {
		t.Fatalf("arc lines %v", a)
	}
	if tr := rules(got, RecapTrouble); !slices.Equal(tr, []fact.ID{4}) {
		t.Fatalf("trouble lines %v", tr)
	}
	for _, l := range got.Lines {
		if (l.Rule == RecapArc) != (l.Kind == RecapKindArc) || (l.Rule == RecapTrouble) != (l.Kind == RecapKindTrouble) {
			t.Fatalf("line %+v has the wrong kind", l)
		}
	}
	g.Story = nil
	got = g.Recap(c, []fact.Fact{thread}, heavy)
	if len(rules(got, RecapArc))+len(rules(got, RecapTrouble)) != 0 {
		t.Fatalf("a world with no season recaps the story: %+v", got.Lines)
	}
}
