package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

// threadDays bounds how long a test waits for a thread to be cast: each
// day's chance is drawn, so a few days may pass first.
const threadDays = 30

// advanceUntil runs ticks until done holds, at most days world days.
func advanceUntil(t *testing.T, g *Game, days int64, done func() bool) {
	t.Helper()
	for range days * sheets.TicksPerDay {
		if done() {
			return
		}
		dirTick(t, g)
	}
	if !done() {
		t.Fatalf("not done in %d days", days)
	}
}

// threadOf is a character's thread of a template, if one was cast.
func threadOf(g *Game, c *Char, template string) *Arc {
	for _, a := range g.Story.Arcs {
		if a.Scope == arc.Personal && a.Char == c.C.ID && a.Template == template {
			return a
		}
	}
	return nil
}

// castThread waits for the director to cast a character's thread from
// what is pending, and checks the cast came off the queue.
func castThread(t *testing.T, g *Game, c *Char, template string) *Arc {
	t.Helper()
	advanceUntil(t, g, threadDays, func() bool { return threadOf(g, c, template) != nil })
	a := threadOf(g, c, template)
	if f := factsOf(g, "thread.cast"); len(f) == 0 || !slices.Contains(f[len(f)-1].Subjects, char.Ref(c.C.ID)) {
		t.Fatalf("%s cast without its thread.cast: %+v", template, f)
	}
	if slices.ContainsFunc(g.Story.Pending, func(p arc.Pending) bool { return p.Char == c.C.ID }) {
		t.Fatalf("%s's candidate is still queued after the cast: %+v", template, g.Story.Pending)
	}
	return a
}

// lapsed waits out a thread nobody backs and checks it ended lapsed.
func lapsed(t *testing.T, g *Game, a *Arc) {
	t.Helper()
	advanceUntil(t, g, a.Stages[0].Due/sheets.TicksPerDay+1-g.Tick()/sheets.TicksPerDay, a.over)
	if a.Outcome != outcomeLapsed || !a.Stages[0].Lapsed {
		t.Fatalf("%s ended %q", a.ID, a.Outcome)
	}
	ended := factsOf(g, "thread.ended")
	if len(ended) == 0 || !slices.Contains(ended[len(ended)-1].Subjects, char.Ref(a.Char)) {
		t.Fatalf("no thread.ended for %s: %+v", a.ID, ended)
	}
	if d, ok := ended[len(ended)-1].Get(datumLapsed); !ok || d.N != 1 {
		t.Fatalf("the thread's end is not a lapse: %+v", ended[len(ended)-1])
	}
}

func pendingOf(g *Game, c *Char, kind string) []arc.Pending {
	var out []arc.Pending
	for _, p := range g.Story.Pending {
		if p.Char == c.C.ID && p.Kind == kind {
			out = append(out, p)
		}
	}
	return out
}

// TestThreadDebtCastAndLapse: an NPC that queues a visit about helping a
// character queues the debt; the director casts it at the NPC's home and,
// unpaid, it lapses into the NPC's grudge.
func TestThreadDebtCastAndLapse(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "debtor", "knife")
	n := meetResidents(t, g, c)["settlement-smith"]
	e := npc.Entry{Kind: entryHelped, Player: c.C.ID, Weight: g.r.NPC.Param("visit-salience"), Tick: g.Tick(), Thing: "a loan"}
	if err := g.note(n, c, e, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if ps := pendingOf(g, c, arc.PendDebt); len(ps) != 1 || ps[0].Ref != npc.Ref(n.Stub.ID) || !slices.Contains(n.Visits, c.C.ID) {
		t.Fatalf("the debt pending %+v, visits %v", ps, n.Visits)
	}
	if err := g.note(n, c, e, g.Tick()); err != nil || len(pendingOf(g, c, arc.PendDebt)) != 1 {
		t.Fatalf("a second word about the same debt queued it twice: %v", err)
	}
	slight := npc.Entry{Kind: "slighted", Player: c.C.ID, Weight: e.Weight, Tick: g.Tick()}
	other := mustCreate(t, g, "slighter", "knife")
	if err := g.note(n, other, slight, g.Tick()); err != nil || len(pendingOf(g, other, arc.PendDebt)) != 0 {
		t.Fatalf("a slight is no debt: %v", err)
	}
	key := g.standingKey(n)
	before := c.C.Standing.Get(key)
	a := castThread(t, g, c, "the-debt")
	if b, _ := a.Cast.Get("npc"); b != npc.Ref(n.Stub.ID) || a.Seat != g.SettlementHex(0) {
		t.Fatalf("the debt cast %+v seated at %v", a.Cast, a.Seat)
	}
	lapsed(t, g, a)
	if got := c.C.Standing.Get(key) - before; got != -20 {
		t.Fatalf("the lapsed debt moved standing by %d", got)
	}
	if _, ok := g.r.NPC.About(n, c.C.ID, entryWronged, g.Tick()); !ok {
		t.Fatal("the NPC does not remember being wronged")
	}
	audit(t, g)
}

// TestThreadReturnCastAndLapse: a character's first command after
// return-days away queues the return at the place it last stood in;
// left alone, it lapses and takes its orders down.
func TestThreadReturnCastAndLapse(t *testing.T) {
	g := guardGame(t)
	g.World.OpenSettlement()
	c := mustCreate(t, g, "wanderer", "knife")
	stay := mustCreate(t, g, "stayer", "knife")
	mat := g.r.Book.Materials[0].ID
	dirGive(t, g, c, ledger.Material(mat), 5)
	if _, err := g.Act(Command{Key: "ask", Char: c.C.ID, Kind: Ask, Material: mat, Units: 5, Price: 1_000_000}); err != nil {
		t.Fatal(err)
	}
	orders := func() int {
		n := 0
		for range g.opens(ledger.Char(c.C.ID), false) {
			n++
		}
		return n
	}
	if orders() != 1 {
		t.Fatal("the ask is not open")
	}
	away := g.r.Story.ReturnDays * sheets.TicksPerDay
	for g.Tick() < away-1 {
		dirTick(t, g)
	}
	look := func(who *Char) {
		t.Helper()
		if _, err := g.Act(Command{Key: "look-" + who.C.ID + "-" + i64(g.Tick()), Char: who.C.ID, Kind: Look}); err != nil {
			t.Fatal(err)
		}
	}
	look(stay)
	if len(pendingOf(g, stay, arc.PendReturn)) != 0 {
		t.Fatal("a day short of return-days away is no return")
	}
	dirTick(t, g)
	dirTick(t, g)
	look(c)
	if ps := pendingOf(g, c, arc.PendReturn); len(ps) != 1 || ps[0].Ref != arc.SettlementRef(0) {
		t.Fatalf("the return pending is %+v", ps)
	}
	look(c)
	if len(pendingOf(g, c, arc.PendReturn)) != 1 {
		t.Fatal("the second command back queued another return")
	}
	a := castThread(t, g, c, "the-return")
	if b, _ := a.Cast.Get("home"); b != arc.SettlementRef(0) {
		t.Fatalf("the return's home is %v", b)
	}
	lapsed(t, g, a)
	if orders() != 0 || g.Ledger.Of(ledger.Char(c.C.ID), ledger.Material(mat)) != 5 {
		t.Fatalf("the lapsed return left %d orders and %d goods", orders(), g.Ledger.Of(ledger.Char(c.C.ID), ledger.Material(mat)))
	}
	audit(t, g)
}

// TestThreadOathCastAndLapse: a vow broken on a board queues the oath
// there; unatoned, it costs standing with the board's keepers.
func TestThreadOathCastAndLapse(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "oathbreaker", "knife")
	vow := GoalSpec{Title: "No plate today", Issuer: goal.ByCharacter, Mode: goal.First, Lifetime: goal.Ephemeral, Turnover: goal.Expire,
		Ticks: g.GoalLimits().EphemeralLeast, Cond: goal.Condition{Verb: goal.Hold, Tag: "plate"}}
	if _, err := g.Act(Command{Key: "vow", Char: c.C.ID, Kind: PostGoal, Goal: &vow}); err != nil {
		t.Fatal(err)
	}
	x := g.Goals[len(g.Goals)-1]
	x.Broken = true
	advanceUntil(t, g, 2, func() bool { return len(pendingOf(g, c, arc.PendOath)) == 1 })
	if p := pendingOf(g, c, arc.PendOath)[0]; p.Ref != arc.SettlementRef(x.Board) || p.Fact == 0 {
		t.Fatalf("the oath pending is %+v", p)
	}
	a := castThread(t, g, c, "the-oath")
	h := g.SettlementHex(x.Board)
	fi := -1
	if r := g.World.RegionAt(h); r >= 0 {
		fi = g.World.Regions[r].Holder
	}
	key := standingKey(fi, h)
	before := c.C.Standing.Get(key)
	lapsed(t, g, a)
	if got := c.C.Standing.Get(key) - before; got != -2 {
		t.Fatalf("the lapsed oath moved standing with %s by %d", key, got)
	}
	audit(t, g)
}

// TestThreadRivalCastAndLapse: backing a side that beats a faction queues
// the rival; ignored, it lapses into the Marked condition for its days.
func TestThreadRivalCastAndLapse(t *testing.T) {
	g := guardGame(t)
	siege := dirCast(t, g, "the-siege", siegeCast(t, g))
	garrison := sideNamed(t, siege, "garrison")
	c := dirChars(t, g, 1)[0]
	dirGive(t, g, c, ledger.Provisions, garrison.Mark)
	dirBack(t, g, c, garrison.Goal, ledger.Provisions, garrison.Mark)
	dirTick(t, g)
	if ps := pendingOf(g, c, arc.PendRival); siege.Stages[0].Won != "garrison" || len(ps) != 1 || ps[0].Ref != arc.FactionRef(garrison.Opponent) {
		t.Fatalf("the won garrison: stage %+v, pending %+v", siege.Stages[0], ps)
	}
	for range siege.Stages {
		if siege.over() {
			break
		}
		if err := g.endStage(siege, "", g.Tick()); err != nil {
			t.Fatal(err)
		}
	}
	if c.C.Has(char.ArcMarked, g.Tick()) {
		t.Fatal("the siege's mark outlived it")
	}
	a := castThread(t, g, c, "the-rival")
	if b, _ := a.Cast.Get(roleFaction); b != arc.FactionRef(garrison.Opponent) {
		t.Fatalf("the rival is %v", b)
	}
	lapsed(t, g, a)
	i := slices.IndexFunc(c.C.Conditions, func(k char.Condition) bool { return k.Tag == char.ArcMarked })
	if i < 0 || c.C.Conditions[i].Ends != a.Ended+3*sheets.TicksPerDay || len(factsOf(g, "character.marked")) == 0 {
		t.Fatalf("the lapsed rival marks for 3 days: %+v", c.C.Conditions)
	}
	audit(t, g)
}

// TestThreadStandingGate: a faction's notables offer a character standing
// high with them a thread with nothing pending: the debt of an NPC of
// theirs it met, else the rival; once, until that thread has run and
// rested.
func TestThreadStandingGate(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "favoured", "knife")
	look := func() {
		t.Helper()
		if _, err := g.Act(Command{Key: "look-" + i64(int64(g.Log.Len())), Char: c.C.ID, Kind: Look}); err != nil {
			t.Fatal(err)
		}
	}
	gp := g.r.Growth.Params()
	lo, hi := sheets.IntParam(gp, "standing-min"), sheets.IntParam(gp, "standing-max")
	c.C.AdjustStanding(factionOwner(0), g.r.Story.ThreadStanding-1, lo, hi)
	look()
	if len(g.Story.Pending) != 0 {
		t.Fatalf("standing short of the gate offered %+v", g.Story.Pending)
	}
	c.C.AdjustStanding(factionOwner(0), 1, lo, hi)
	look()
	if ps := pendingOf(g, c, arc.PendRival); len(ps) != 1 || ps[0].Ref != arc.FactionRef(0) {
		t.Fatalf("the gate offered %+v", g.Story.Pending)
	}
	look()
	if len(g.Story.Pending) != 1 {
		t.Fatalf("the gate offered twice: %+v", g.Story.Pending)
	}
	g.Story.Pending = nil
	g.restScope(arc.Personal, char.Ref(c.C.ID), g.Tick())
	look()
	if len(g.Story.Pending) != 0 {
		t.Fatal("the gate offered a thread during the character's rest")
	}
	g.Story.Rests = nil

	n := meetResidents(t, g, c)["settlement-smith"]
	g.World.Regions[g.World.RegionAt(n.Stub.Home)].Holder = 0
	g.Story.Pending = nil
	look()
	ps := pendingOf(g, c, arc.PendDebt)
	if len(ps) != 1 || ps[0].Ref.Kind != kindNPC || g.NPCs.Get(ps[0].Ref.ID) == nil || g.standingKey(g.NPCs.Get(ps[0].Ref.ID)) != factionOwner(0) {
		t.Fatalf("with an NPC of theirs met, the gate offered %+v", g.Story.Pending)
	}
	if last := c.C.Company[len(c.C.Company)-1].Who; last != npcPrefix+ps[0].Ref.ID {
		t.Fatalf("the gate's NPC is %s, the one met last %s", ps[0].Ref.ID, last)
	}
}

// TestThreadFactsAreTheirsAlone: a thread's facts reach its character's
// reads and nobody else's: the recap and the news NPCs tell.
func TestThreadFactsAreTheirsAlone(t *testing.T) {
	g := guardGame(t)
	c, other := mustCreate(t, g, "owner", "knife"), mustCreate(t, g, "other", "knife")
	a := dirCast(t, g, "the-oath", arc.Cast{{Role: "character", Ref: char.Ref(c.C.ID)}, {Role: "board", Ref: arc.SettlementRef(0)}})
	if err := g.endStage(a, "", g.Tick()); err != nil {
		t.Fatal(err)
	}
	cast, ended := factsOf(g, "thread.cast"), factsOf(g, "thread.ended")
	if len(cast) != 1 || len(ended) != 1 {
		t.Fatalf("cast %d, ended %d", len(cast), len(ended))
	}
	if !SeesFact(c, cast[0]) || SeesFact(other, cast[0]) || SeesFact(nil, ended[0]) || !SeesFact(other, fact.Fact{Kind: "arc.ended"}) {
		t.Fatal("a thread's facts are its character's alone")
	}
	heavy := []fact.Fact{ended[0], cast[0]}
	for i := range heavy {
		heavy[i].Weight = g.NewsWeight()
	}
	c.Seen, other.Seen = -1, -1
	for _, l := range g.Recap(other, nil, heavy).Lines {
		if ThreadFact(l.Fact.Kind) {
			t.Fatalf("another character's recap holds %+v", l)
		}
	}
	got := g.Recap(c, ended, heavy)
	if !slices.ContainsFunc(got.Lines, func(l RecapLine) bool {
		return l.Rule == RecapArc && l.Kind == RecapKindArc && l.Fact.ID == ended[0].ID
	}) {
		t.Fatalf("the character's own thread's end is not in its recap: %+v", got.Lines)
	}
	news := len(g.News)
	g.keepNews(heavy)
	if len(g.News) != news {
		t.Fatal("a thread's fact joined the news anyone hears")
	}
}
