package game

import (
	"strconv"
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/econ"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tally"
	"jams.team/mmo-world/sim/world"
)

// siegeAt runs the siege's first stage by hand at the first settlement:
// the garrison (provisions, holder → besieger) and the besiegers (beats,
// besieger → holder), each with a pooled side goal of mark units.
func siegeAt(t *testing.T, g *Game, holder, besieger int, mark int64) *Arc {
	t.Helper()
	seat := g.SettlementHex(0)
	r := g.World.RegionAt(seat)
	if r < 0 {
		t.Fatal("the first settlement lies in no region")
	}
	if g.Story == nil {
		g.Story = &Story{}
	}
	g.Story.NextArc++
	a := &Arc{ID: "arc-test", Template: "the-siege", Scope: arc.ScopeWorld, Regions: []int{r}, Seat: seat, By: "test",
		Cast: arc.Cast{{Role: "besieger", Ref: arc.FactionRef(besieger)}, {Role: "holder", Ref: arc.FactionRef(holder)}}}
	due := g.Tick() + 3*sheets.TicksPerDay
	side := func(id string, sponsor, opponent int, at string) SideRun {
		x := &Goal{Title: id, Issuer: goal.Ref{Kind: goal.ByFaction, ID: "0"}, Scope: goal.World, Board: 0, Mode: goal.Pooled,
			Lifetime: goal.Ephemeral, Turnover: goal.Expire, Posted: g.Tick(), Expires: due + 1, State: goal.Live, Progress: tally.Tally{},
			Cond: goal.Condition{Verb: goal.Back, Side: a.ID + "/0/" + id, Count: mark, At: at}}
		if err := goal.Valid(x, g.Tick(), g.GoalLimits()); err != nil {
			t.Fatal(err)
		}
		g.openGoal(x)
		return SideRun{Side: id, Goal: x.ID, Mark: mark, Sponsor: sponsor, Opponent: opponent, At: at}
	}
	a.Stages = []StageRun{{Began: g.Tick(), Due: due, Sides: []SideRun{
		side("garrison", holder, besieger, goal.SettlementRef(0)),
		side("besiegers", besieger, holder, goal.RegionRef(world.RegionRef(r))),
	}}}
	g.Story.Arcs = append(g.Story.Arcs, a)
	return a
}

func backGame(t *testing.T) (*Game, *Arc) {
	t.Helper()
	g := guardGame(t)
	if len(g.World.Factions) < 2 {
		t.Fatalf("a siege needs two factions; the world has %d", len(g.World.Factions))
	}
	return g, siegeAt(t, g, 0, 1, 50)
}

// provide gives a character provisions as an operator's correction.
func provide(t *testing.T, g *Game, c *Char, n int64) {
	t.Helper()
	key := "give-" + c.C.ID + "-" + strconv.Itoa(g.Log.Len())
	if _, err := g.Act(Command{Key: key, Char: c.C.ID, Kind: Correct, Asset: ledger.Provisions, Units: n, Note: "test"}); err != nil {
		t.Fatal(err)
	}
}

// outside is the centre of a region other than r.
func outside(t *testing.T, g *Game, r int) hex.Hex {
	t.Helper()
	for i, reg := range g.World.Regions {
		if h := g.r.Gen.Region(reg.Lattice).Centre; i != r && g.World.RegionAt(h) == i {
			return h
		}
	}
	t.Fatal("the world has one region")
	return hex.Hex{}
}

func back(g *Game, c *Char, key, goalID string, units int64) (Result, error) {
	cmd := Command{Key: key, Char: c.C.ID, Kind: BackSide, Target: goalID}
	if units != 0 {
		cmd.Asset, cmd.Units = ledger.Provisions, units
	}
	return g.Act(cmd)
}

func TestBackStandingAccrues(t *testing.T) {
	g, _ := backGame(t)
	c := mustCreate(t, g, "a", "knife")
	for range 3 {
		g.credit(c, 0, 1, hex.Hex{}, g.r.Story.StandingFor)
	}
	if got := c.C.Standing.Get(factionOwner(0)); got != 3 {
		t.Fatalf("three standing-for of worth gives +3 with the sponsor, got %d", got)
	}
	if got := c.C.Standing.Get(factionOwner(1)); got != -(3 * g.r.Story.StandingFor / g.r.Story.StandingAgainst) {
		t.Fatalf("the opponent loses one per standing-against, got %d", got)
	}
	// A small part is carried until it makes a whole point.
	g.credit(c, 0, 1, hex.Hex{}, g.r.Story.StandingFor-1)
	if got := c.C.Standing.Get(factionOwner(0)); got != 3 {
		t.Fatalf("part of standing-for gives nothing yet, got %d", got)
	}
	g.credit(c, 0, 1, hex.Hex{}, 1)
	if got := c.C.Standing.Get(factionOwner(0)); got != 4 {
		t.Fatalf("the carried part makes a point, got %d", got)
	}
	// Standing stays within its bounds.
	g.credit(c, 0, -1, hex.Hex{}, 1000*g.r.Story.StandingFor)
	if got := c.C.Standing.Get(factionOwner(0)); got != sheets.IntParam(g.r.Growth.Params(), "standing-max") {
		t.Fatalf("standing is clamped at its most, got %d", got)
	}
}

func TestBackNoOpponentLosesNothing(t *testing.T) {
	g, _ := backGame(t)
	c := mustCreate(t, g, "a", "knife")
	worth := 10 * g.r.Story.StandingAgainst
	g.credit(c, 0, 0, hex.Hex{}, worth)
	g.credit(c, 1, -1, hex.Hex{}, worth)
	if got := c.C.Standing.Get(factionOwner(0)); got != worth/g.r.Story.StandingFor {
		t.Fatalf("the sponsor gains even when it is the opponent, got %d", got)
	}
	if got := c.C.Standing.Get(factionOwner(1)); got != worth/g.r.Story.StandingFor {
		t.Fatalf("with no opponent the sponsor still gains, got %d", got)
	}
	for _, b := range c.BackWorth {
		if b.Key != factionOwner(0) && b.Key != factionOwner(1) {
			t.Fatalf("nothing accrues against anyone: %s", b.Key)
		}
	}
	// A keepers sponsor stands for the place it is served at.
	at := g.SettlementHex(0)
	g.credit(c, econ.Keepers, -1, at, g.r.Story.StandingFor)
	if got := c.C.Standing.Get(standingKey(econ.Keepers, at)); got != 1 {
		t.Fatalf("the keepers of the place gain standing, got %d", got)
	}
}

func TestBackGoodsSinkCountAndStanding(t *testing.T) {
	g, a := backGame(t)
	c := mustCreate(t, g, "a", "knife")
	provide(t, g, c, 30)
	garrison := a.Stages[0].Sides[0].Goal
	res, err := back(g, c, "back-1", garrison, 20)
	if err != nil {
		t.Fatal(err)
	}
	x := g.GoalOf(garrison)
	if got := x.Progress.Get(c.C.ID); got != 20 {
		t.Fatalf("20 provisions count 20 toward the garrison, got %d", got)
	}
	if got := g.Ledger.Of(ledger.ToFaction, ledger.Provisions); got < 20 {
		t.Fatalf("the goods sink to the faction at once, it holds %d", got)
	}
	worth := 20 * g.r.Values.Asset(ledger.Provisions)
	if got := c.C.Standing.Get(factionOwner(0)); got != worth/g.r.Story.StandingFor {
		t.Fatalf("standing %d, want %d", got, worth/g.r.Story.StandingFor)
	}
	if got := c.C.Standing.Get(factionOwner(1)); got != -(worth / g.r.Story.StandingAgainst) {
		t.Fatalf("standing with the besieger %d, want %d", got, -(worth / g.r.Story.StandingAgainst))
	}
	if !hasFact(res, "side.backed") || !hasFact(res, "character.marked") || !c.C.Has(char.ArcMarked, g.Tick()) {
		t.Fatalf("a world arc's backer is marked: %+v", res.Facts)
	}
	if b, ok := g.backingIn(c.C.ID, a.ID, 0); !ok || b.Side != "garrison" {
		t.Fatalf("the backer is recorded: %+v", g.Story.Backers)
	}
	// More than the mark lacks is not taken.
	provide(t, g, c, 100)
	if _, err := back(g, c, "back-2", garrison, 100); err != nil {
		t.Fatal(err)
	}
	if got := x.Total(); got != 50 || x.State != goal.Done {
		t.Fatalf("the garrison fills at its mark: %d, %s", got, x.State)
	}
	audit(t, g)
}

func TestBackRefusalsChangeNothing(t *testing.T) {
	g, a := backGame(t)
	garrison, besiegers := a.Stages[0].Sides[0].Goal, a.Stages[0].Sides[1].Goal
	c := mustCreate(t, g, "a", "knife")
	provide(t, g, c, 10)
	both := mustCreate(t, g, "b", "knife")
	provide(t, g, both, 10)
	if _, err := back(g, both, "declare", besiegers, 0); err != nil {
		t.Fatal(err)
	}
	shunned := mustCreate(t, g, "s", "knife")
	provide(t, g, shunned, 10)
	shunned.C.AdjustStanding(factionOwner(0), g.r.Story.ShunnedBelow, -100, 100)
	away := mustCreate(t, g, "w", "knife")
	provide(t, g, away, 10)
	away.C.At = huntTile(t, g)
	far := mustCreate(t, g, "f", "knife")
	far.C.At = outside(t, g, a.Regions[0])
	have := g.balance(c, ledger.Provisions)
	plain := &Goal{Title: "plain", Issuer: goal.Ref{Kind: goal.ByFaction, ID: "0"}, Scope: goal.World, Mode: goal.Pooled, Lifetime: goal.Season,
		Turnover: goal.Expire, State: goal.Live, Progress: tally.Tally{}, Cond: goal.Condition{Verb: goal.Deliver, Count: 5, At: goal.SettlementRef(0)}}
	g.openGoal(plain)
	over := siegeAt(t, g, 0, 1, 50)
	over.ID = "arc-over"
	for i := range over.Stages[0].Sides {
		x := g.GoalOf(over.Stages[0].Sides[i].Goal)
		x.Cond.Side = "arc-over/0/" + over.Stages[0].Sides[i].Side
	}
	over.Stages[0].Ended, over.Stages[0].Lapsed = g.Tick(), true
	cases := []struct {
		name, code string
		who        *Char
		goal       string
		units      int64
	}{
		{"no such goal", BadArgs, c, "q-999", 5},
		{"not a side", NotASide, c, plain.ID, 5},
		{"the stage is over", StageOver, c, over.Stages[0].Sides[0].Goal, 5},
		{"the other side", OtherSide, both, garrison, 5},
		{"shunned", Shunned, shunned, garrison, 5},
		{"goods away from the settlement", NotHere, away, garrison, 5},
		{"beats declared outside the regions", NotHere, far, besiegers, 0},
		{"short", Short, c, garrison, have + 1},
		{"units on a beats side", BadArgs, c, besiegers, 5},
		{"no units of goods", BadArgs, c, garrison, 0},
		{"declared twice", BadArgs, both, besiegers, 0},
	}
	for _, tc := range cases {
		before := digestOf(t, g)
		_, err := back(g, tc.who, "refused-"+tc.name, tc.goal, tc.units)
		if !refusedAs(err, tc.code) {
			t.Fatalf("%s: want %s, got %v", tc.name, tc.code, err)
		}
		if after := digestOf(t, g); after != before {
			t.Fatalf("%s: a refusal changed the game", tc.name)
		}
	}
	if _, err := back(g, c, "goods", garrison, have); err != nil {
		t.Fatalf("the same goods at the settlement are taken: %v", err)
	}
}

func TestBackBeatsCountForDeclaredBackers(t *testing.T) {
	g, a := backGame(t)
	besiegers := g.GoalOf(a.Stages[0].Sides[1].Goal)
	c := mustCreate(t, g, "a", "knife")
	idle := mustCreate(t, g, "b", "knife")
	won := func(who *Char, key string, score int64) {
		t.Helper()
		first := fact.ID(g.Log.Len())
		if _, err := g.factWith(who, nil, "beat.won", g.Tick(), fact.S("encounter", "e"), fact.N("beat", 1), fact.S("option", "strike"), fact.N("score", score)); err != nil {
			t.Fatal(err)
		}
		if err := g.creditGoals(first, key); err != nil {
			t.Fatal(err)
		}
	}
	won(idle, "w-0", 4)
	if besiegers.Total() != 0 {
		t.Fatal("a beat by someone who backs nothing counts toward no beats side")
	}
	if _, err := back(g, c, "declare", besiegers.ID, 0); err != nil {
		t.Fatal(err)
	}
	won(c, "w-1", 4)
	if got := besiegers.Progress.Get(c.C.ID); got != 4 {
		t.Fatalf("a declared backer's beat counts its score: %d", got)
	}
	// A fact read twice counts once.
	first := fact.ID(g.Log.Len() - 1)
	if err := g.creditGoals(first, "again"); err != nil {
		t.Fatal(err)
	}
	if got := besiegers.Progress.Get(c.C.ID); got != 4 {
		t.Fatalf("a fact read again counted again: %d", got)
	}
	c.C.At = outside(t, g, a.Regions[0])
	won(c, "w-2", 4)
	if got := besiegers.Progress.Get(c.C.ID); got != 4 {
		t.Fatalf("a beat outside the arc's regions counted: %d", got)
	}
}

func TestBackDefenceDoublesForWallCaptain(t *testing.T) {
	g := guardGame(t)
	seat := g.SettlementHex(0)
	r := g.World.RegionAt(seat)
	g.Story.NextArc++
	a := &Arc{ID: "arc-raid", Template: "raid", Scope: arc.Settlement, Regions: []int{r}, Seat: seat, Place: goal.SettlementRef(0), By: "test", Hunt: "h-raid"}
	x := &Goal{Title: "hold", Issuer: goal.Ref{Kind: goal.ByFaction, ID: "0"}, Scope: goal.World, Mode: goal.Pooled, Lifetime: goal.Ephemeral,
		Turnover: goal.Expire, Posted: g.Tick(), Expires: g.Tick() + sheets.TicksPerDay, State: goal.Live, Progress: tally.Tally{},
		Cond: goal.Condition{Verb: goal.Back, Side: a.ID + "/0/hold", Count: 100}}
	g.openGoal(x)
	a.Stages = []StageRun{{Began: g.Tick(), Due: g.Tick() + sheets.TicksPerDay, Sides: []SideRun{{Side: "hold", Goal: x.ID, Mark: 100, Sponsor: econ.Keepers, Opponent: -1}}}}
	g.Story.Arcs = append(g.Story.Arcs, a)
	plain := mustCreate(t, g, "a", "knife")
	captain := mustCreate(t, g, "b", "knife")
	with(captain, "warden", "wall-captain")
	for i, c := range []*Char{plain, captain} {
		first := fact.ID(g.Log.Len())
		if _, err := g.factWith(c, nil, "beat.won", g.Tick(), fact.S("encounter", "e"), fact.N("beat", 1), fact.S("option", "strike"), fact.N("score", 3)); err != nil {
			t.Fatal(err)
		}
		if _, err := g.factWith(c, []fact.Ref{huntRef("h-raid")}, "hunt.pressed", g.Tick(), append(fact.At(seat), fact.N("removed", 5))...); err != nil {
			t.Fatal(err)
		}
		if err := g.creditGoals(first, "d-"+c.C.ID); err != nil {
			t.Fatal(err)
		}
		want := int64(8 * (i + 1))
		if got := x.Progress.Get(c.C.ID); got != want {
			t.Fatalf("%s defends %d, want %d", c.C.ID, got, want)
		}
	}
}

func TestBackMarkedAmbushInAndOutOfRange(t *testing.T) {
	g := guardGame(t)
	seat := g.SettlementHex(0)
	r := g.World.RegionAt(seat)
	// The garrison's sponsor holds a region away from the seat's, so a
	// besieger is preferred there; the besiegers' sponsor is any other.
	holder, held := -1, hex.Hex{}
	for i, reg := range g.World.Regions {
		if h := g.r.Gen.Region(reg.Lattice).Centre; i != r && reg.Holder >= 0 && g.World.RegionAt(h) == i {
			holder, held = reg.Holder, h
			break
		}
	}
	if holder < 0 || len(g.World.Factions) < 2 {
		t.Fatal("no faction holds a region away from the first settlement's")
	}
	besieger := (holder + 1) % len(g.World.Factions)
	a := siegeAt(t, g, holder, besieger, 50)
	c := mustCreate(t, g, "a", "knife")
	if got := g.markedShare(c, seat); got != fixed.Hundredths {
		t.Fatalf("an unmarked character's chance is as it was: %d", got)
	}
	if _, err := back(g, c, "declare", a.Stages[0].Sides[1].Goal, 0); err != nil {
		t.Fatal(err)
	}
	if got := g.markedShare(c, seat); got != g.r.Story.MarkedAmbush {
		t.Fatalf("inside the arc's regions a marked backer is preferred: %d", got)
	}
	if got := g.markedShare(c, held); got != g.r.Story.MarkedAmbush {
		t.Fatalf("in the opposing sponsor's holdings a marked backer is preferred: %d", got)
	}
	out, found := hex.Hex{}, false
	for i, reg := range g.World.Regions {
		if h := g.r.Gen.Region(reg.Lattice).Centre; i != r && reg.Holder != holder && g.World.RegionAt(h) == i {
			out, found = h, true
			break
		}
	}
	if !found {
		t.Fatal("every region but the seat's is the holder's")
	}
	if got := g.markedShare(c, out); got != fixed.Hundredths {
		t.Fatalf("outside its regions and the opposing sponsor's, the chance is as it was: %d", got)
	}
	a.Ended = g.Tick()
	c.C.Clear(char.ArcMarked)
	if got := g.markedShare(c, seat); got != fixed.Hundredths {
		t.Fatalf("an ended arc marks nobody: %d", got)
	}
}

func TestSidesForListsWhatACharacterMayBack(t *testing.T) {
	g, a := backGame(t)
	c := mustCreate(t, g, "a", "knife")
	opts := g.SidesFor(c)
	if len(opts) != 2 || opts[0].Side != "garrison" || opts[0].Wants != arc.WantGoods || opts[0].Tag != ledger.Provisions ||
		opts[0].At != g.SettlementHex(0) || opts[0].Left != 50 || opts[0].Backed {
		t.Fatalf("both sides are open to a newcomer: %+v", opts)
	}
	if _, err := back(g, c, "declare", a.Stages[0].Sides[1].Goal, 0); err != nil {
		t.Fatal(err)
	}
	opts = g.SidesFor(c)
	if len(opts) != 1 || opts[0].Side != "besiegers" || !opts[0].Backed || opts[0].Region == "" {
		t.Fatalf("a backer sees only its own side: %+v", opts)
	}
}
