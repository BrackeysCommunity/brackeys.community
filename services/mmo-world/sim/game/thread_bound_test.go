package game

import (
	"fmt"
	"math/rand/v2"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

// favoured are n characters standing at the thread gate with faction 0.
func favoured(t *testing.T, g *Game, n int) []*Char {
	t.Helper()
	gp := g.r.Growth.Params()
	lo, hi := sheets.IntParam(gp, "standing-min"), sheets.IntParam(gp, "standing-max")
	cs := dirChars(t, g, n)
	for _, c := range cs {
		c.C.AdjustStanding(factionOwner(0), g.r.Story.ThreadStanding, lo, hi)
	}
	return cs
}

func lookAt(t *testing.T, g *Game, c *Char) {
	t.Helper()
	if _, err := g.Act(Command{Key: fmt.Sprintf("look-%s-%d", c.C.ID, g.Log.Len()), Char: c.C.ID, Kind: Look}); err != nil {
		t.Fatal(err)
	}
}

func offersOf(g *Game, via fact.Ref) int64 {
	var n int64
	for _, p := range g.Story.Pending {
		if p.Offer && p.Via == via {
			n++
		}
	}
	return n
}

// TestThreadBoundCap: a faction offers threads up to its cap, pending and
// running together, and none past it.
func TestThreadBoundCap(t *testing.T) {
	g := guardGame(t)
	via := arc.FactionRef(0)
	limit := g.offerCap()
	if limit != g.r.Story.OffersFloor {
		t.Fatalf("a world of %d active characters has cap %d, want the floor %d", g.Active(), limit, g.r.Story.OffersFloor)
	}
	cs := favoured(t, g, int(limit)+1)
	for _, c := range cs {
		lookAt(t, g, c)
	}
	if n := offersOf(g, via); n != limit {
		t.Fatalf("%d offers queued, want the cap %d: %+v", n, limit, g.Story.Pending)
	}
	last := cs[len(cs)-1]
	if len(pendingOf(g, last, arc.PendRival)) != 0 {
		t.Fatal("the faction offered past its cap")
	}
	if g.resting(scopeOffer, char.Ref(last.C.ID), g.Tick()) {
		t.Fatal("a character the cap refused was rested")
	}

	// A running thread the faction offered still counts.
	first := g.Story.Pending[0]
	g.Story.Pending = g.Story.Pending[1:]
	g.Story.Arcs = append(g.Story.Arcs, &Arc{ID: "arc-offered", Scope: arc.Personal, Char: first.Char, Via: via})
	lookAt(t, g, last)
	if len(pendingOf(g, last, arc.PendRival)) != 0 {
		t.Fatal("a thread cast from an offer did not count against the cap")
	}
	if !g.threadBusy(g.Char(first.Char), g.Tick()) {
		t.Fatal("the character following the offered thread is not busy")
	}
	g.Story.Arcs[len(g.Story.Arcs)-1].Outcome = outcomeLapsed
	g.Story.threads = nil
	lookAt(t, g, last)
	if ps := pendingOf(g, last, arc.PendRival); len(ps) != 1 || ps[0].Via != via || !ps[0].Offer {
		t.Fatalf("with room again the gate offered %+v", ps)
	}
	if got := g.Queued(); got.Gate != limit+1 || got.Winners != 0 {
		t.Fatalf("queued %+v, want %d from the gate", got, limit+1)
	}
}

// TestThreadBoundOfferRest: a gate offer evicted from a full queue, or
// aged out of it, rests its character from the gate for offer-rest-days;
// an earned candidate's leaving rests nobody.
func TestThreadBoundOfferRest(t *testing.T) {
	g := guardGame(t)
	want := g.Tick() + g.r.Story.OfferRestDays*sheets.TicksPerDay
	if g.r.Story.OfferRestDays != 5 {
		t.Fatalf("offer-rest-days is %d", g.r.Story.OfferRestDays)
	}
	until := func(id string) int64 {
		i, ok := slices.BinarySearchFunc(g.Story.Rests, ScopeRest{Scope: scopeOffer, Ref: char.Ref(id)}, cmpRest)
		if !ok {
			return 0
		}
		return g.Story.Rests[i].Until
	}
	kept := int(g.r.Story.PendingKept)
	for i := range kept {
		g.pend(arc.Pending{Kind: arc.PendReturn, Char: fmt.Sprintf("earned-%d", i), Ref: arc.SettlementRef(0), Tick: g.Tick()})
	}
	g.pend(arc.Pending{Kind: arc.PendRival, Char: "offered", Ref: arc.FactionRef(0), Tick: g.Tick(), Via: arc.FactionRef(0), Offer: true})
	if len(g.Story.Pending) != kept || slices.ContainsFunc(g.Story.Pending, func(p arc.Pending) bool { return p.Offer }) {
		t.Fatalf("a full queue kept the offer over an earned candidate: %+v", g.Story.Pending)
	}
	if got := until("offered"); got != want {
		t.Fatalf("the evicted offer rests until %d, want %d", got, want)
	}
	g.pend(arc.Pending{Kind: arc.PendReturn, Char: "late", Ref: arc.SettlementRef(0), Tick: g.Tick()})
	if until("earned-0") != 0 || slices.ContainsFunc(g.Story.Pending, func(p arc.Pending) bool { return p.Char == "earned-0" }) {
		t.Fatal("the oldest earned candidate should leave, unrested, once no offer is queued")
	}

	g.Story.Pending = nil
	old := g.Tick() - (g.r.Story.MemoryDays+1)*sheets.TicksPerDay
	g.Story.Pending = []arc.Pending{
		{Kind: arc.PendDebt, Char: "aged", Ref: fact.Ref{Kind: kindNPC, ID: "n"}, Tick: old, Via: arc.FactionRef(1), Offer: true},
		{Kind: arc.PendReturn, Char: "aged-earned", Ref: arc.SettlementRef(0), Tick: old},
	}
	g.forget()
	if len(g.Story.Pending) != 0 || until("aged") != want || until("aged-earned") != 0 {
		t.Fatalf("aged out: pending %+v, rests %+v", g.Story.Pending, g.Story.Rests)
	}

	c := favoured(t, g, 1)[0]
	g.pend(arc.Pending{Kind: arc.PendRival, Char: c.C.ID, Ref: arc.FactionRef(0), Tick: old, Via: arc.FactionRef(0), Offer: true})
	g.forget()
	lookAt(t, g, c)
	if len(pendingOf(g, c, arc.PendRival)) != 0 {
		t.Fatal("the gate offered a thread during the character's offer rest")
	}
	g.World.Tick = want
	lookAt(t, g, c)
	if len(pendingOf(g, c, arc.PendRival)) != 1 {
		t.Fatalf("the gate offered nothing once the offer rest ran out: %+v", g.Story.Pending)
	}
}

// TestThreadBoundEarnedKept: while any gate offer is queued, a full queue
// drops offers, oldest first, and never an earned candidate.
func TestThreadBoundEarnedKept(t *testing.T) {
	g := guardGame(t)
	kept := int(g.r.Story.PendingKept)
	rng := rand.New(rand.NewPCG(7, 11))
	var earned []string
	for i := range 4 * kept {
		p := arc.Pending{Char: fmt.Sprintf("c-%d", i), Ref: arc.FactionRef(i % 3), Tick: g.Tick() + int64(i)}
		if rng.IntN(2) == 0 {
			p.Kind, p.Via, p.Offer = arc.PendRival, p.Ref, true
		} else {
			p.Kind = arc.PendReturn
			earned = append(earned, p.Char)
		}
		g.pend(p)
		var offers []int64
		var queued []string
		for _, q := range g.Story.Pending {
			if q.Offer {
				offers = append(offers, q.Tick)
			} else {
				queued = append(queued, q.Char)
			}
		}
		if !slices.IsSorted(offers) {
			t.Fatalf("offers out of order: %v", offers)
		}
		if want := earned[max(0, len(earned)-kept):]; !slices.Equal(queued, want) {
			t.Fatalf("after %d pends the earned queued are %v, want the newest %v", i+1, queued, want)
		}
	}
}

// TestThreadBoundWinnersQueue: a contributor to a side that beat a faction
// at its cap still gets its rival, which counts against the cap and is no
// gate offer.
func TestThreadBoundWinnersQueue(t *testing.T) {
	g := guardGame(t)
	siege := dirCast(t, g, "the-siege", siegeCast(t, g))
	garrison := sideNamed(t, siege, "garrison")
	via := arc.FactionRef(garrison.Opponent)
	for _, d := range dirChars(t, g, int(g.offerCap())) {
		g.pend(arc.Pending{Kind: arc.PendRival, Char: d.C.ID, Ref: via, Tick: g.Tick(), Via: via, Offer: true})
	}
	if g.offerRoom(via) {
		t.Fatal("the faction has room after its cap's offers")
	}
	c := dirChars(t, g, 1)[0]
	dirGive(t, g, c, ledger.Provisions, garrison.Mark)
	dirBack(t, g, c, garrison.Goal, ledger.Provisions, garrison.Mark)
	dirTick(t, g)
	ps := pendingOf(g, c, arc.PendRival)
	if siege.Stages[0].Won != "garrison" || len(ps) != 1 || ps[0].Faction() != via || ps[0].Offer {
		t.Fatalf("the won garrison at a full faction: stage %+v, pending %+v", siege.Stages[0], ps)
	}
	if got := g.Queued(); got.Winners != 1 {
		t.Fatalf("queued %+v, want one for the winners", got)
	}
	a := castThread(t, g, c, "the-rival")
	if a.Via != via {
		t.Fatalf("the rival thread's via is %v, want %v", a.Via, via)
	}
	if g.offerRoom(via) {
		t.Fatal("the cast rival stopped counting against its faction")
	}
	audit(t, g)
}

// scanBusy is threadBusy as a scan of the whole story.
func scanBusy(g *Game, c *Char, t int64) bool {
	s := g.Story
	ref := char.Ref(c.C.ID)
	if slices.ContainsFunc(s.Pending, func(p arc.Pending) bool { return p.Char == c.C.ID }) {
		return true
	}
	if slices.ContainsFunc(s.Rests, func(r ScopeRest) bool { return r.Scope == arc.Personal && r.Ref == ref && r.Until > t }) {
		return true
	}
	return slices.ContainsFunc(g.openArcs(arc.Personal), func(a *Arc) bool { return a.Char == c.C.ID })
}

// TestThreadBusyAgreesWithScan: over random stories changed as the game
// changes them, threadBusy and slotFree read what a scan reads.
func TestThreadBusyAgreesWithScan(t *testing.T) {
	g := guardGame(t)
	cs := dirChars(t, g, 12)
	rng := rand.New(rand.NewPCG(3, 5))
	scopes := []string{arc.Personal, arc.Region, arc.Settlement, scopeOffer}
	s := g.Story
	for step := range 4000 {
		c := cs[rng.IntN(len(cs))]
		now := g.Tick() + int64(rng.IntN(int(sheets.TicksPerDay)))
		switch rng.IntN(6) {
		case 0:
			p := arc.Pending{Kind: arc.PendReturn, Char: c.C.ID, Ref: arc.SettlementRef(0), Tick: now}
			switch rng.IntN(3) {
			case 1:
				p.Kind, p.Ref = arc.PendRival, arc.FactionRef(rng.IntN(3))
			case 2:
				p.Kind, p.Ref, p.Via, p.Offer = arc.PendDebt, fact.Ref{Kind: kindNPC, ID: "n"}, arc.FactionRef(rng.IntN(3)), true
			}
			g.pend(p)
		case 1:
			if len(s.Pending) > 0 {
				i := rng.IntN(len(s.Pending))
				p := s.Pending[i]
				g.unpend(arc.Candidate{From: &p})
			}
		case 2:
			s.rest(ScopeRest{Scope: scopes[rng.IntN(len(scopes))], Ref: char.Ref(c.C.ID), Until: now + int64(rng.IntN(int(sheets.TicksPerDay)))})
		case 3:
			scope := scopes[rng.IntN(len(scopes)-1)]
			a := &Arc{ID: fmt.Sprintf("arc-r%d", step), Scope: scope, Char: c.C.ID}
			if rng.IntN(2) == 0 {
				a.Via = arc.FactionRef(rng.IntN(3))
			}
			s.Arcs = append(s.Arcs, a)
			s.threads = nil
		case 4:
			if len(s.Arcs) > 0 {
				a := s.Arcs[rng.IntN(len(s.Arcs))]
				if !a.over() {
					a.Ended, a.Outcome = now, outcomeLapsed
					s.threads = nil
				}
			}
		case 5:
			g.storyKept(now)
		}
		for _, d := range cs {
			if got, want := g.threadBusy(d, now), scanBusy(g, d, now); got != want {
				t.Fatalf("step %d: threadBusy(%s) = %v, the scan %v", step, d.C.ID, got, want)
			}
			open := slices.ContainsFunc(g.openArcs(arc.Personal), func(a *Arc) bool { return a.Char == d.C.ID })
			if err := g.slotFree(arc.Personal, arc.Candidate{Char: d.C.ID}); (err != nil) != open {
				t.Fatalf("step %d: slotFree(%s) = %v with an open thread %v", step, d.C.ID, err, open)
			}
		}
		for fi := range 3 {
			via := arc.FactionRef(fi)
			var load int64
			for _, p := range s.Pending {
				if p.Faction() == via {
					load++
				}
			}
			for _, a := range g.openArcs(arc.Personal) {
				if a.Via == via {
					load++
				}
			}
			if got := g.offerRoom(via); got != (load < g.offerCap()) {
				t.Fatalf("step %d: offerRoom(%s) = %v with load %d of %d", step, via, got, load, g.offerCap())
			}
		}
	}
}
