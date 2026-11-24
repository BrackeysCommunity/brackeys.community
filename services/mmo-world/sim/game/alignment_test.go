package game

import (
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

// alChars are characters standing at the first settlement.
func alChars(t *testing.T, g *Game, start string, n int) []*Char {
	t.Helper()
	var out []*Char
	for i := range n {
		c := mustCreate(t, g, fmt.Sprintf("al-%d-%d", len(g.Chars), i), start)
		c.C.At = g.SettlementHex(0)
		out = append(out, c)
	}
	return out
}

func alDo(t *testing.T, g *Game, c *Char, cmd Command) {
	t.Helper()
	cmd.Char = c.C.ID
	cmd.Key = fmt.Sprintf("al-%s-%s-%d-%d", cmd.Kind, c.C.ID, g.Tick(), g.Log.Len())
	if _, err := g.Act(cmd); err != nil {
		t.Fatalf("%s %s: %v", c.C.ID, cmd.Kind, err)
	}
}

func alMove(t *testing.T, g *Game, c *Char, act string, asked int64, partner string, public bool) int64 {
	t.Helper()
	d, err := g.moveAlignment(c, act, asked, 1, partner, public, g.Tick())
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// alMoves are the alignment.moved facts about a character.
func alMoves(g *Game, c *Char) []fact.Fact {
	return slices.DeleteFunc(factsOf(g, factAlignment), func(f fact.Fact) bool { return !slices.Contains(f.Subjects, char.Ref(c.C.ID)) })
}

func alDatum(f fact.Fact, key string) fact.Datum {
	d, _ := f.Get(key)
	return d
}

// alCited checks that a character's newest alignment move is an act's
// own, for a delta, citing the fact of a kind that caused it.
func alCited(t *testing.T, g *Game, c *Char, act string, delta int64, partner, causeKind string) fact.Fact {
	t.Helper()
	ms := alMoves(g, c)
	if len(ms) == 0 {
		t.Fatalf("%s: no alignment.moved for %s", act, c.C.ID)
	}
	m := ms[len(ms)-1]
	if alDatum(m, "act").S != act || alDatum(m, "delta").N != delta || alDatum(m, "partner").S != partner {
		t.Fatalf("%s: moved %+v", act, m.Data)
	}
	if len(m.Causes) != 1 {
		t.Fatalf("%s: causes %v", act, m.Causes)
	}
	cause, ok := g.Log.Get(m.Causes[0])
	if !ok || cause.Kind != causeKind || !slices.Contains(cause.Subjects, char.Ref(c.C.ID)) && causeKind != "trouble.held" {
		t.Fatalf("%s: cites %+v, want a %s", act, cause, causeKind)
	}
	return m
}

// TestAlignmentDepthOnACharacter: −15 is unremarked again after three +2
// acts across days, and −80 needs 31 to leave notorious; the caps never
// bind at six a day.
func TestAlignmentDepthOnACharacter(t *testing.T) {
	g := guardGame(t)
	c := alChars(t, g, "knife", 1)[0]
	c.C.Align().Value = -15
	var got []int64
	for range 3 {
		alMove(t, g, c, ActVowKept, 2, "", true)
		got = append(got, AlignmentOf(c))
		alDays(t, g, 1)
	}
	if !slices.Equal(got, []int64{-13, -11, -9}) || g.Band(c) != "unremarked" {
		t.Fatalf("from −15: %v, %s", got, g.Band(c))
	}
	c.C.Alignment.Value = -80
	acts := 0
	for g.Band(c) == "notorious" {
		if d := alMove(t, g, c, ActTroubleHeld, 2, "", true); d != 1 {
			t.Fatalf("at %d a +2 act moved %d", AlignmentOf(c), d)
		}
		acts++
		if acts%int(g.AlignParams().GoodDay) == 0 {
			alDays(t, g, 1)
		}
	}
	if acts != 31 || AlignmentOf(c) != -49 {
		t.Fatalf("from −80: %d acts to %d", acts, AlignmentOf(c))
	}
}

func alDays(t *testing.T, g *Game, days int64) {
	t.Helper()
	for range days * sheets.TicksPerDay {
		advance(t, g)
	}
}

// TestAlignmentFact: one move is one alignment.moved naming the act, what
// it asked and moved, the value, the band, whether it is public and its
// partner, citing its cause; a move the caps leave at nothing writes
// nothing and allocates nothing.
func TestAlignmentFact(t *testing.T) {
	g := guardGame(t)
	cs := alChars(t, g, "knife", 3)
	c, partner, quiet := cs[0], cs[1], cs[2]
	if d := alMove(t, g, c, ActGoalMet, 2, partner.C.ID, true); d != 2 {
		t.Fatalf("moved %d", d)
	}
	ms := alMoves(g, c)
	if len(ms) != 1 {
		t.Fatalf("%d facts", len(ms))
	}
	m := ms[0]
	for k, want := range map[string]int64{"asked": 2, "delta": 2, "value": 2, "public": 1} {
		if alDatum(m, k).N != want {
			t.Errorf("%s = %d, want %d", k, alDatum(m, k).N, want)
		}
	}
	if alDatum(m, "act").S != ActGoalMet || alDatum(m, "band").S != "unremarked" || alDatum(m, "partner").S != partner.C.ID ||
		!slices.Equal(m.Causes, []fact.ID{1}) || !slices.Equal(m.Subjects, []fact.Ref{char.Ref(c.C.ID)}) {
		t.Fatalf("fact %+v", m)
	}
	if k := char.KnownOf(c.C); len(k) != 1 || k[0].Tick != g.Tick() || k[0].At != c.C.At || k[0].Region != g.World.RegionAt(c.C.At) {
		t.Fatalf("known %+v", k)
	}

	// Private: moved, written, never known.
	n := g.Log.Len()
	if d := alMove(t, g, quiet, ActTheft, -3, "", false); d != -3 || g.Log.Len() != n+1 {
		t.Fatalf("a private move moved %d", d)
	}
	if len(char.KnownOf(quiet.C)) != 0 || alDatum(alMoves(g, quiet)[0], "public").N != 0 || alDatum(alMoves(g, quiet)[0], "partner").S != "" {
		t.Fatal("a private move is known")
	}

	// Nothing moved, nothing written, nothing made.
	n = g.Log.Len()
	if d := alMove(t, g, partner, ActGoalMet, 0, c.C.ID, true); d != 0 || g.Log.Len() != n || partner.C.Alignment != nil {
		t.Fatalf("a zero move wrote %d facts, alignment %+v", g.Log.Len()-n, partner.C.Alignment)
	}
	if _, err := g.moveAlignment(c, "no-such-act", 2, 1, "", true, g.Tick()); err == nil {
		t.Fatal("an unknown act moved")
	}

	// Known holds the newest known-kept.
	kept := g.AlignParams().KnownKept
	for range kept + 3 {
		alMove(t, g, quiet, ActTheft, -2, "", true)
	}
	if k := char.KnownOf(quiet.C); int64(len(k)) != kept {
		t.Fatalf("known holds %d", len(k))
	}

	// Only its own character reads it.
	if Visible("", factAlignment, m.Subjects) || Visible(partner.C.ID, factAlignment, m.Subjects) || !Visible(c.C.ID, factAlignment, m.Subjects) ||
		!SeesFact(c, m) || SeesFact(partner, m) || SeesFact(nil, m) {
		t.Fatal("alignment.moved is its character's alone")
	}
}

// TestAlignmentCaps: good acts add six a day at most, a paired act two a
// day per partner, the rest dropped and not banked; a new day starts
// afresh; bad acts are never capped.
func TestAlignmentCaps(t *testing.T) {
	g := guardGame(t)
	cs := alChars(t, g, "knife", 4)
	c, a, b, d := cs[0], cs[1], cs[2], cs[3]
	var got []int64
	for _, m := range []struct {
		act, partner string
		asked        int64
	}{
		{ActGoalMet, a.C.ID, 2}, {ActGoalMet, a.C.ID, 2}, {ActGoalMet, b.C.ID, 2}, {ActRescue, a.C.ID, 3}, {ActVowKept, "", 2},
	} {
		got = append(got, alMove(t, g, c, m.act, m.asked, m.partner, true))
	}
	if !slices.Equal(got, []int64{2, 0, 2, 2, 0}) || AlignmentOf(c) != 6 || c.C.Alignment.Good != 6 {
		t.Fatalf("a day's moves %v to %d", got, AlignmentOf(c))
	}
	if len(alMoves(g, c)) != 3 {
		t.Fatalf("%d facts for three moves", len(alMoves(g, c)))
	}
	if bad := alMove(t, g, c, ActVowBroken, -3, "", true); bad != -3 || AlignmentOf(c) != 3 {
		t.Fatalf("a bad act past the cap moved %d", bad)
	}
	// Rescue and the storied return count to the day but not to a pair.
	if r1, r2 := alMove(t, g, d, ActRescue, 3, a.C.ID, true), alMove(t, g, d, ActStoried, 5, a.C.ID, true); r1 != 3 || r2 != 3 {
		t.Fatalf("rescue %d, then a storied return %d", r1, r2)
	}

	alDays(t, g, 1)
	if up := alMove(t, g, c, ActGoalMet, 2, a.C.ID, true); up != 2 || c.C.Alignment.Good != 2 || c.C.Alignment.Day != g.Tick()/sheets.TicksPerDay {
		t.Fatalf("a new day: moved %d, good %d", up, c.C.Alignment.Good)
	}
	if !slices.Equal(c.C.Alignment.Pairs, []char.PairGood{{With: a.C.ID, N: 2}}) {
		t.Fatalf("pairs %+v", c.C.Alignment.Pairs)
	}
}

// TestAlignmentHoldsIdle: alignment never decays; thirty idle days leave
// it where it stood.
func TestAlignmentHoldsIdle(t *testing.T) {
	g := guardGame(t)
	cs := alChars(t, g, "knife", 2)
	up, down := cs[0], cs[1]
	up.C.Align().Value = 37
	down.C.Align().Value = -64
	n, day := len(factsOf(g, factAlignment)), g.World.Day
	alDays(t, g, 30)
	if g.World.Day-day != 30 {
		t.Fatalf("%d world days went by", g.World.Day-day)
	}
	if AlignmentOf(up) != 37 || AlignmentOf(down) != -64 || len(factsOf(g, factAlignment)) != n {
		t.Fatalf("after 30 days: %d and %d", AlignmentOf(up), AlignmentOf(down))
	}
}

// TestGoalMetMoves: a paid claim on a goal another character posted, at
// goal-reward-least or more, is a goal met for the claimant, partnered
// with the poster and citing the claim.
func TestGoalMetMoves(t *testing.T) {
	g := guardGame(t)
	cs := alChars(t, g, "knife", 2)
	poster, runner := cs[0], cs[1]
	fibre := alMaterial(t, g, "fibre")
	dirGive(t, g, poster, ledger.Coin, 100)
	dirGive(t, g, runner, ledger.Material(fibre), 4)
	n, _ := g.SettlementAt(poster.C.At)
	alDo(t, g, poster, Command{Kind: PostGoal, Goal: &GoalSpec{Title: "Four fibre", Issuer: goal.ByCharacter, Reward: 50, Mode: goal.First,
		Lifetime: goal.Ephemeral, Turnover: goal.Expire, Ticks: sheets.TicksPerDay, Cond: goal.Condition{Verb: goal.Deliver, Tag: "fibre", Count: 4, At: goal.SettlementRef(n)}}})
	x := g.Goals[len(g.Goals)-1]
	alDo(t, g, runner, Command{Kind: DeliverGoal, Target: x.ID, Material: fibre, Units: 4})
	if x.State != goal.Done {
		t.Fatalf("goal %s", x.State)
	}
	alCited(t, g, runner, ActGoalMet, 2, poster.C.ID, "goal.claimed")
	if len(alMoves(g, poster)) != 0 {
		t.Fatal("the poster moved")
	}

	// Who counts: claims checked one by one.
	cl := goal.Claim{Who: runner.C.ID, Coin: 20}
	for _, c := range []struct {
		why string
		x   Goal
		cl  goal.Claim
	}{
		{"its own goal", Goal{Poster: runner.C.ID, Reward: 50, Issuer: goal.Ref{Kind: goal.ByCharacter}}, cl},
		{"a faction's", Goal{Reward: 50, Issuer: goal.Ref{Kind: goal.ByFaction}}, cl},
		{"an admin's", Goal{Poster: poster.C.ID, Reward: 50, Issuer: goal.Ref{Kind: goal.ByAdmin}}, cl},
		{"under the least reward", Goal{Poster: poster.C.ID, Reward: g.AlignParams().GoalRewardLeast - 1, Issuer: goal.Ref{Kind: goal.ByCharacter}}, cl},
		{"no coin", Goal{Poster: poster.C.ID, Reward: 50, Issuer: goal.Ref{Kind: goal.ByCharacter}}, goal.Claim{Who: runner.C.ID}},
		{"the rescued carrying itself", Goal{Poster: runner.C.ID, Reward: 50, Cond: goal.Condition{Verb: goal.Carry, Who: runner.C.ID}}, cl},
	} {
		before := len(alMoves(g, runner))
		if err := g.claimMoves(runner, &c.x, c.cl, 1); err != nil {
			t.Fatal(err)
		}
		if len(alMoves(g, runner)) != before {
			t.Errorf("%s moved alignment", c.why)
		}
	}
}

func alMaterial(t *testing.T, g *Game, tag string) string {
	t.Helper()
	for _, m := range g.r.Book.Materials {
		if slices.Contains(m.Tags, tag) {
			return m.ID
		}
	}
	t.Fatalf("no material tagged %s", tag)
	return ""
}

// alStep walks a character one tile and waits out the walk.
func alStep(t *testing.T, g *Game, c *Char, to hex.Hex) {
	t.Helper()
	alDo(t, g, c, Command{Kind: Step, Dir: c.C.At.DirectionTo(to)})
	for c.Long != nil {
		advance(t, g)
	}
	if c.Fight != nil {
		alDo(t, g, c, Command{Kind: Press, Option: "back-out"})
	}
}

// TestRescueMoves: carrying a downed character home is a rescue,
// partnered with the rescued and citing the claim, and not also a goal
// met.
func TestRescueMoves(t *testing.T) {
	g := guardGame(t)
	cs := alChars(t, g, "knife", 2)
	downed, rescuer := cs[0], cs[1]
	home := downed.C.At
	out := home.Neighbour(0)
	for d := range hex.Directions {
		if _, _, ok := g.World.Path(home, home.Neighbour(d)); ok {
			out = home.Neighbour(d)
			break
		}
	}
	dirGive(t, g, downed, ledger.Coin, 40)
	downed.C.At = out
	downed.C.Set(char.Down, 0)
	alDo(t, g, downed, Command{Kind: CallHelp})
	x := g.Goals[len(g.Goals)-1]
	alStep(t, g, rescuer, out)
	alDo(t, g, rescuer, Command{Kind: CarryHome, Target: downed.C.ID})
	alStep(t, g, rescuer, home)
	if x.State != goal.Done {
		t.Fatalf("rescue %s", x.State)
	}
	alCited(t, g, rescuer, ActRescue, 3, downed.C.ID, "goal.claimed")
	if ms := alMoves(g, rescuer); len(ms) != 1 {
		t.Fatalf("a rescue moved %d times", len(ms))
	}
	if len(alMoves(g, downed)) != 0 {
		t.Fatal("the rescued moved")
	}
}

// TestVowMoves: a vow kept is +2 and one broken −3, each citing its own
// fact.
func TestVowMoves(t *testing.T) {
	g := guardGame(t)
	cs := alChars(t, g, "hook", 2)
	vow := GoalSpec{Title: "No blade this season", Issuer: goal.ByCharacter, Mode: goal.First, Lifetime: goal.Season, Turnover: goal.Expire,
		Cond: goal.Condition{Verb: goal.Hold, Tag: "blade"}}
	alDo(t, g, cs[0], Command{Kind: PostGoal, Goal: &vow})
	kept := g.Goals[len(g.Goals)-1]
	alDo(t, g, cs[1], Command{Kind: PostGoal, Goal: &vow})
	broken := g.Goals[len(g.Goals)-1]
	broken.Broken = true
	for _, x := range []*Goal{kept, broken} {
		if err := g.closeGoal(x, "al-close-"+x.ID); err != nil {
			t.Fatal(err)
		}
	}
	if kept.Why != "kept" || broken.Why != "broken" {
		t.Fatalf("kept %s, broken %s", kept.Why, broken.Why)
	}
	alCited(t, g, cs[0], ActVowKept, 2, "", "goal.vow-kept")
	alCited(t, g, cs[1], ActVowBroken, -3, "", "goal.vow-broken")
	if len(factsOf(g, "goal.vow-kept")) != 1 || len(factsOf(g, "goal.vow-broken")) != 1 {
		t.Fatal("each vow writes its fact once")
	}
}

// TestTroubleHeldMoves: everyone who worked toward holding a trouble
// gains, once, citing trouble.held; a bystander does not.
func TestTroubleHeldMoves(t *testing.T) {
	g := guardGame(t)
	a := troubleAt(t, g, "shortage")
	hold := sideNamed(t, a, sideHold)
	x := g.GoalOf(hold.Goal)
	cs := dirChars(t, g, 3)
	// Two share the mark when it has room for two, else one holds it.
	shares := []int64{hold.Mark - hold.Mark/2, hold.Mark / 2}
	if shares[1] == 0 {
		shares = shares[:1]
	}
	backers, bystander := cs[:len(shares)], cs[2]
	for i, c := range backers {
		dirGive(t, g, c, ledger.Provisions, shares[i])
		dirBack(t, g, c, x.ID, ledger.Provisions, shares[i])
	}
	for range sheets.TicksPerDay {
		if a.Ended != 0 {
			break
		}
		dirTick(t, g)
	}
	if len(factsOf(g, "trouble.held")) != 1 {
		t.Fatalf("trouble %s", a.Outcome)
	}
	for _, c := range backers {
		alCited(t, g, c, ActTroubleHeld, 2, "", "trouble.held")
		if len(alMoves(g, c)) != 1 {
			t.Fatalf("%s moved %d times", c.C.ID, len(alMoves(g, c)))
		}
	}
	if len(alMoves(g, bystander)) != 0 {
		t.Fatal("a bystander moved")
	}
}

// TestTroubleLostMovesNobody: a lapsed trouble is no good act.
func TestTroubleLostMovesNobody(t *testing.T) {
	g := guardGame(t)
	a := troubleAt(t, g, "shortage")
	x := g.GoalOf(sideNamed(t, a, sideHold).Goal)
	c := dirChars(t, g, 1)[0]
	dirGive(t, g, c, ledger.Provisions, 1)
	dirBack(t, g, c, x.ID, ledger.Provisions, 1)
	lose(t, g, a)
	if len(alMoves(g, c)) != 0 {
		t.Fatal("a lost trouble moved alignment")
	}
}

// TestStoriedReturnMoves: a storied find records who left it, and giving
// it back to them is +5, partnered and citing the gift, once.
func TestStoriedReturnMoves(t *testing.T) {
	g := guardGame(t)
	cs := alChars(t, g, "knife", 2)
	owner, finder := cs[0], cs[1]
	h := finder.C.At
	in := finder.C.In(char.Hand, 0)
	g.Left = append(g.Left, &Left{Hex: h, By: owner.C.ID, Item: in})
	if f, ok := g.fromPool(finder, h, rarityStoried, 1); !ok || f.By != owner.C.ID || f.Item != in.ID {
		t.Fatalf("a storied find %+v", f)
	}
	if f, ok := g.fromPool(finder, h, rarityRare, 1); !ok || f.By != "" {
		t.Fatalf("a rare find %+v records who left it", f)
	}
	if _, ok := g.fromPool(owner, h, rarityStoried, 1); ok {
		t.Fatal("its own item is a storied find")
	}
	g.Left = nil

	finder.C.Equipped = slices.DeleteFunc(finder.C.Equipped, func(e char.Equipped) bool { return e.Item == in.ID })
	finder.Finds = append(finder.Finds, Find{Trigger: TrigSpoils, Rarity: rarityStoried, Item: in.ID, By: owner.C.ID})
	alDo(t, g, finder, Command{Kind: Give, Target: owner.C.ID, Item: in.ID})
	alCited(t, g, finder, ActStoried, 5, owner.C.ID, "character.gave")
	if finder.Finds[0].By != "" {
		t.Fatal("the find still owes its return")
	}
	owner.C.Equipped = slices.DeleteFunc(owner.C.Equipped, func(e char.Equipped) bool { return e.Item == in.ID })
	alDo(t, g, owner, Command{Kind: Give, Target: finder.C.ID, Item: in.ID})
	alDo(t, g, finder, Command{Kind: Give, Target: owner.C.ID, Item: in.ID})
	if len(alMoves(g, finder)) != 1 || len(alMoves(g, owner)) != 0 {
		t.Fatalf("returned again: finder moved %d times, owner %d", len(alMoves(g, finder)), len(alMoves(g, owner)))
	}
	audit(t, g)
}
