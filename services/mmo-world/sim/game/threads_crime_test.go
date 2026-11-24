package game

import (
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/align"
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

// atGate is a crooked character, so it can find the fence, at the
// syndicate's gate standing.
func atGate(t *testing.T, g *Game, key string) *Char {
	t.Helper()
	c := mustCreate(t, g, key, "knife")
	c.C.Align().Value = -15
	if err := g.addSyndicateStanding(c, g.r.Story.Gate, 0, g.Tick()); err != nil {
		t.Fatal(err)
	}
	return c
}

// answer gives a character's word on a thread's side to the NPC cast in
// it, and waits for the thread to end.
func answer(t *testing.T, g *Game, c *Char, a *Arc, side string) {
	t.Helper()
	to, ok := a.Cast.Get(roleThreadNPC)
	if !ok {
		t.Fatalf("%s casts no npc: %+v", a.ID, a.Cast)
	}
	chose(t, g, c, to.ID, side)
	advanceUntil(t, g, 2, a.over)
	if a.Outcome != side {
		t.Fatalf("%s ended %q, want %q", a.ID, a.Outcome, side)
	}
}

// castAll waits for the director to cast each character's thread of a
// template.
func castAll(t *testing.T, g *Game, template string, cs ...*Char) []*Arc {
	t.Helper()
	advanceUntil(t, g, threadDays, func() bool {
		return !slices.ContainsFunc(cs, func(c *Char) bool { return threadOf(g, c, template) == nil })
	})
	out := make([]*Arc, len(cs))
	for i, c := range cs {
		out[i] = threadOf(g, c, template)
	}
	return out
}

// talkTo is a character's meeting with one NPC where it stands.
func talkTo(t *testing.T, g *Game, c *Char, id string) {
	t.Helper()
	if _, err := g.Act(Command{Key: fmt.Sprintf("meet-%s-%d", c.C.ID, g.Log.Len()), Char: c.C.ID, Kind: Talk, NPC: id}); err != nil {
		t.Fatal(err)
	}
}

func restLeft(g *Game, scope string, c *Char) int64 {
	i, ok := slices.BinarySearchFunc(g.Story.Rests, ScopeRest{Scope: scope, Ref: char.Ref(c.C.ID)}, cmpRest)
	if !ok {
		return 0
	}
	return g.Story.Rests[i].Until - g.Tick()
}

func alignMoves(g *Game, c *Char, act string) []fact.Fact {
	var out []fact.Fact
	for _, f := range factsOf(g, factAlignment) {
		if d, _ := f.Get("act"); d.S == act && slices.Contains(f.Subjects, char.Ref(c.C.ID)) {
			out = append(out, f)
		}
	}
	return out
}

// TestInvitationCastsAtTheGate: a character reaching the gate is queued
// for the invitation, cast with the nearest den's fence, the captain over
// that den and the den's settlement; one under the gate is not queued.
func TestInvitationCastsAtTheGate(t *testing.T) {
	g := guardGame(t)
	under := mustCreate(t, g, "under", "knife")
	if err := g.addSyndicateStanding(under, g.r.Story.Gate-1, 0, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if len(pendingOf(g, under, arc.PendInvite)) != 0 {
		t.Fatal("a character under the gate is queued for the invitation")
	}
	c := atGate(t, g, "invited")
	if ps := pendingOf(g, c, arc.PendInvite); len(ps) != 1 {
		t.Fatalf("the invitation pending %+v", ps)
	}
	d, ok := g.nearestDen(c.C.At)
	if !ok {
		t.Fatal("no den")
	}
	a := castThread(t, g, c, inviteTemplate)
	fence, _ := a.Cast.Get(roleThreadNPC)
	notable, _ := a.Cast.Get("notable")
	seat, _ := a.Cast.Get("seat")
	if fence != npc.Ref(d.Fence) || notable != npc.Ref(synCaptainID+"0") || seat != arc.SettlementRef(d.Place) || a.Seat != d.At {
		t.Fatalf("the invitation cast %+v seated at %v, the den %+v", a.Cast, a.Seat, d)
	}
	if !g.inviteBusy(c, g.Tick()) {
		t.Fatal("an open invitation leaves the character free to be invited again")
	}
	c.C.Align().Value = 0
	if !g.FenceVisible(c) {
		t.Fatal("an open invitation hides the fence that must be answered")
	}
}

// TestInvitationTakeTheJobMade: a word with the fence taking the job
// makes the character, and leaves it no invitation rest.
func TestInvitationTakeTheJobMade(t *testing.T) {
	g := guardGame(t)
	c := atGate(t, g, "taker")
	a := castThread(t, g, c, inviteTemplate)
	answer(t, g, c, a, sideTakeTheJob)
	if !char.IsMade(c.C) {
		t.Fatal("taking the job did not make the character")
	}
	made := factsOf(g, factMade)
	fence, _ := a.Cast.Get(roleThreadNPC)
	if len(made) != 1 || !slices.Contains(made[0].Subjects, char.Ref(c.C.ID)) || !slices.Contains(made[0].Subjects, fence) {
		t.Fatalf("syndicate.made %+v", made)
	}
	if !SeesFact(c, made[0]) || SeesFact(nil, made[0]) || SeesFact(mustCreate(t, g, "outsider", "knife"), made[0]) {
		t.Fatal("syndicate.made is seen by the wrong viewers")
	}
	if restLeft(g, arc.ScopeInvite, c) > 0 {
		t.Fatal("taking the job rests the invitation")
	}
	audit(t, g)
}

// TestInvitationRests: turning the invitation down or letting it lapse
// rests it 14 days, and the gate queues no other until the rest ends.
func TestInvitationRests(t *testing.T) {
	g := guardGame(t)
	down := atGate(t, g, "declines")
	idle := atGate(t, g, "idles")
	as := castAll(t, g, inviteTemplate, down, idle)
	da, ia := as[0], as[1]
	answer(t, g, down, da, "turn-it-down")
	rest := g.r.Story.InviteRestDays * sheets.TicksPerDay
	if g.r.Story.InviteRestDays != 14 || restLeft(g, arc.ScopeInvite, down) != rest {
		t.Fatalf("turning it down rests %d ticks, want %d", restLeft(g, arc.ScopeInvite, down), rest)
	}
	lapsed(t, g, ia)
	if restLeft(g, arc.ScopeInvite, idle) != rest {
		t.Fatalf("a lapsed invitation rests %d ticks, want %d", restLeft(g, arc.ScopeInvite, idle), rest)
	}
	for _, c := range []*Char{down, idle} {
		if char.IsMade(c.C) {
			t.Fatalf("%s was made without taking the job", c.C.ID)
		}
		if err := g.addSyndicateStanding(c, 1, 0, g.Tick()); err != nil {
			t.Fatal(err)
		}
		if len(pendingOf(g, c, arc.PendInvite)) != 0 {
			t.Fatalf("%s is invited again while its invitation rests", c.C.ID)
		}
	}
	g.Story.Rests = slices.DeleteFunc(g.Story.Rests, func(r ScopeRest) bool { return r.Scope == arc.ScopeInvite })
	if err := g.addSyndicateStanding(down, 1, 0, g.Tick()); err != nil || len(pendingOf(g, down, arc.PendInvite)) != 1 {
		t.Fatalf("the rest over, the gate queues no invitation: %v", err)
	}
}

// informerGame is a world with a plain settlement nearby for a den to
// move to.
func informerGame(t *testing.T) (*Game, *Place) {
	t.Helper()
	g := guardGame(t)
	return g, plainPlace(t, g, g.SettlementHex(0), 6)
}

// meetCaptain is a character's meeting with the watch captain where it
// stands.
func meetCaptain(t *testing.T, g *Game, c *Char) *npc.NPC {
	t.Helper()
	for _, p := range g.PeopleHere(c, c.C.At) {
		if p.Role != roleWatchCaptain {
			continue
		}
		talkTo(t, g, c, p.ID)
		return g.NPCs.Get(p.ID)
	}
	t.Fatal("no watch captain here")
	return nil
}

// TestInformerCastsAtACaptainMeeting: a crooked character meeting a watch
// captain near a den is queued for the informer once an informer rest;
// an unremarked one is not. It casts the captain, the den and the
// captain's settlement.
func TestInformerCastsAtACaptainMeeting(t *testing.T) {
	g, _ := informerGame(t)
	honest := mustCreate(t, g, "honest", "knife")
	meetCaptain(t, g, honest)
	if len(pendingOf(g, honest, arc.PendInformer)) != 0 {
		t.Fatal("an unremarked character is queued for the informer")
	}
	c := mustCreate(t, g, "crook", "knife")
	c.C.Align().Value = -15
	captain := meetCaptain(t, g, c)
	ps := pendingOf(g, c, arc.PendInformer)
	if len(ps) != 1 || ps[0].Ref != npc.Ref(captain.Stub.ID) || ps[0].Fact == 0 {
		t.Fatalf("the informer pending %+v", ps)
	}
	if met, ok := g.Log.Get(ps[0].Fact); !ok || met.Kind != "npc.met" {
		t.Fatalf("the informer's cause is %+v", met)
	}
	if restLeft(g, arc.ScopeInformer, c) != g.r.Story.InformerRestDays*sheets.TicksPerDay {
		t.Fatal("queueing the informer did not rest it")
	}
	g.Story.Pending = slices.DeleteFunc(g.Story.Pending, func(p arc.Pending) bool { return p.Kind == arc.PendInformer })
	meetCaptain(t, g, c)
	if len(pendingOf(g, c, arc.PendInformer)) != 0 {
		t.Fatal("the informer was queued twice inside its rest")
	}
	g.Story.Rests = slices.DeleteFunc(g.Story.Rests, func(r ScopeRest) bool { return r.Scope == arc.ScopeInformer })
	meetCaptain(t, g, c)
	at, _ := g.SettlementAt(captain.Stub.Home)
	d, _ := g.nearestDen(captain.Stub.Home)
	a := castThread(t, g, c, informerTemplate)
	who, _ := a.Cast.Get(roleThreadNPC)
	den, _ := a.Cast.Get("den")
	seat, _ := a.Cast.Get("seat")
	if who != npc.Ref(captain.Stub.ID) || den != arc.SettlementRef(d.Place) || seat != arc.SettlementRef(at) {
		t.Fatalf("the informer cast %+v", a.Cast)
	}
}

// informerOf casts a character's informer from a captain meeting.
func informerOf(t *testing.T, g *Game, c *Char) (*Arc, Den) {
	t.Helper()
	captain := meetCaptain(t, g, c)
	d, ok := g.nearestDen(captain.Stub.Home)
	if !ok {
		t.Fatal("no den near the captain")
	}
	return castThread(t, g, c, informerTemplate), d
}

func movedFor(g *Game, d Den, cause string) bool {
	if g.Syndicate == nil {
		return false
	}
	return slices.ContainsFunc(g.Syndicate.Moves, func(m DenMove) bool { return m.Fence == d.Fence && m.From == d.At && m.Cause == cause })
}

// TestInformerNameTheFence: naming the fence is +6, a betrayal of the
// syndicate for the made, and the den moves on; the informer then rests
// 14 days.
func TestInformerNameTheFence(t *testing.T) {
	for _, made := range []bool{false, true} {
		t.Run(fmt.Sprintf("made=%v", made), func(t *testing.T) {
			g, near := informerGame(t)
			c := mustCreate(t, g, "informer", "knife")
			if made {
				c.C.Align().Made = true
				g.adjustStanding(c, syndicateKey, g.r.Story.Gate)
			} else {
				c.C.Align().Value = -15
			}
			before := AlignmentOf(c)
			a, d := informerOf(t, g, c)
			answer(t, g, c, a, "name-the-fence")
			p := g.AlignParams()
			plus := align.Deepen(p, before, 6)
			informed := alignMoves(g, c, ActInformed)
			if len(informed) != 1 {
				t.Fatalf("informing moved alignment %d times", len(informed))
			}
			if delta, _ := informed[0].Get("delta"); delta.N != plus {
				t.Fatalf("informing moved alignment by %d, want %d", delta.N, plus)
			}
			betrayals := factsOf(g, factBetrayed)
			if made {
				if len(betrayals) != 1 || char.IsMade(c.C) || c.C.Standing.Get(syndicateKey) > -50 || !c.GrudgeWith(syndicateKey, g.Tick()/sheets.TicksPerDay) {
					t.Fatalf("a made informer: betrayals %d, made %v, standing %d", len(betrayals), char.IsMade(c.C), c.C.Standing.Get(syndicateKey))
				}
				if want := before + plus + align.Deepen(p, before+plus, -25); AlignmentOf(c) != want || len(alignMoves(g, c, ActBetrayal)) != 1 {
					t.Fatalf("a made informer stands at %d, want %d", AlignmentOf(c), want)
				}
				if len(factsOf(g, factUnmade)) != 1 {
					t.Fatal("no syndicate.unmade")
				}
			} else if len(betrayals) != 0 {
				t.Fatal("informing betrayed the syndicate for one not made")
			}
			if !movedFor(g, d, denMoveInformed) {
				t.Fatalf("the named den did not move: %+v", g.Syndicate)
			}
			if moved, ok := g.DenAt(near.Hex); !ok || moved.Fence != d.Fence {
				t.Fatalf("the den is not at the nearest free settlement: %+v", g.Dens())
			}
			if restLeft(g, arc.ScopeInformer, c) != g.r.Story.InformerRestDays*sheets.TicksPerDay {
				t.Fatal("the informer's end did not rest it 14 days")
			}
			audit(t, g)
		})
	}
}

// TestInformerKeepQuietAndLapse: keeping quiet changes nothing; a lapse
// moves the den with nothing said, and both rest the informer.
func TestInformerKeepQuietAndLapse(t *testing.T) {
	g, _ := informerGame(t)
	quiet := mustCreate(t, g, "quiet", "knife")
	quiet.C.Align().Value = -15
	qa, qd := informerOf(t, g, quiet)
	answer(t, g, quiet, qa, "keep-quiet")
	if movedFor(g, qd, denMoveInformed) || movedFor(g, qd, denMoveLapsed) || AlignmentOf(quiet) != -15 {
		t.Fatal("keeping quiet moved the den or the character's alignment")
	}
	if restLeft(g, arc.ScopeInformer, quiet) <= 0 {
		t.Fatal("keeping quiet did not rest the informer")
	}

	g, _ = informerGame(t)
	c := mustCreate(t, g, "silent", "knife")
	c.C.Align().Made = true
	a, d := informerOf(t, g, c)
	lapsed(t, g, a)
	if !movedFor(g, d, denMoveLapsed) {
		t.Fatalf("the lapse did not move the den: %+v", g.Syndicate)
	}
	if len(alignMoves(g, c, ActInformed)) != 0 || len(factsOf(g, factBetrayed)) != 0 || !char.IsMade(c.C) {
		t.Fatal("a lapse was told as informing")
	}
	if restLeft(g, arc.ScopeInformer, c) != g.r.Story.InformerRestDays*sheets.TicksPerDay {
		t.Fatal("the lapse did not rest the informer 14 days")
	}
	audit(t, g)
}

// TestTrustedDebt: at trusted standing a made character is offered the
// debt of the last fence it met, counted against the syndicate's own cap;
// under it, or not made, it is offered nothing.
func TestTrustedDebt(t *testing.T) {
	g := guardGame(t)
	cs := dirChars(t, g, int(g.r.Story.OffersFloor)+1)
	trusted := sheets.IntParam(g.r.Book.SyndicateParams, "trusted")
	d, ok := g.nearestDen(g.SettlementHex(0))
	if !ok {
		t.Fatal("no den")
	}
	for _, c := range cs {
		c.C.Align().Made = true
		g.adjustStanding(c, syndicateKey, trusted-1)
		talkTo(t, g, c, d.Fence)
		if g.NPCs.Get(d.Fence) == nil {
			t.Fatal("the made met no fence")
		}
	}
	first := cs[0]
	lookAt(t, g, first)
	if len(pendingOf(g, first, arc.PendDebt)) != 0 {
		t.Fatal("the syndicate offered under its trusted standing")
	}
	unmade := mustCreate(t, g, "unmade", "knife")
	g.adjustStanding(unmade, syndicateKey, trusted)
	unmade.C.Meet(char.Met{Who: npcPrefix + d.Fence, How: char.MetMet, Tick: g.Tick()}, g.r.limits)
	lookAt(t, g, unmade)
	if len(pendingOf(g, unmade, arc.PendDebt)) != 0 {
		t.Fatal("the syndicate offered one not made")
	}
	for _, c := range cs {
		g.adjustStanding(c, syndicateKey, 1)
		lookAt(t, g, c)
	}
	ps := pendingOf(g, first, arc.PendDebt)
	if len(ps) != 1 || ps[0].Ref != npc.Ref(d.Fence) || ps[0].Via != syndicateVia || !ps[0].Offer {
		t.Fatalf("the trusted debt pending %+v", ps)
	}
	if n := offersOf(g, syndicateVia); n != g.offerCap() {
		t.Fatalf("the syndicate offered %d, want its cap %d", n, g.offerCap())
	}
	if len(pendingOf(g, cs[len(cs)-1], arc.PendDebt)) != 0 {
		t.Fatal("the syndicate offered past its cap")
	}
	a := castAll(t, g, "the-debt", first)[0]
	if who, _ := a.Cast.Get(roleThreadNPC); who != npc.Ref(d.Fence) || a.Via != syndicateVia {
		t.Fatalf("the trusted debt cast %+v via %v", a.Cast, a.Via)
	}
}
