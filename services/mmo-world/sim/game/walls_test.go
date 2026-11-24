package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

const wallsTrouble = "thief-in-walls"

// wallsGame is a guard game far enough on that walls-days lie behind it.
func wallsGame(t *testing.T) *Game {
	t.Helper()
	g := guardGame(t)
	g.World.Tick = 2 * g.r.Story.WallsDays * sheets.TicksPerDay
	return g
}

// burgleAt notes won burglaries at place n, the newest now and each one
// tick older than the last.
func burgleAt(g *Game, n int, count int64) {
	for k := count - 1; k >= 0; k-- {
		g.noteBurglary(n, g.Tick()-k)
	}
}

func burgledAt(g *Game, n int) int64 { return g.storyView().Places()[n].Burgled }

// wallsFinds reports whether the thief-in-walls predicate finds place n.
func wallsFinds(t *testing.T, g *Game, n int) bool {
	t.Helper()
	tpl, ok := g.template(wallsTrouble)
	if !ok {
		t.Fatalf("no template %q", wallsTrouble)
	}
	return slices.ContainsFunc(tpl.When(g.storyView(), tpl.Row, g.r.Story), func(c arc.Candidate) bool { return c.Place == n })
}

// TestWallsCastAtFiveInSevenDays: walls-burglaries won burglaries within
// walls-days cast a thief in the walls at the place, its beats counted in
// the place's region, with a mark and a goal.
func TestWallsCastAtFiveInSevenDays(t *testing.T) {
	g := wallsGame(t)
	if g.r.Story.WallsBurglaries != 5 || g.r.Story.WallsDays != 7 {
		t.Fatalf("theft.params walls cells read %d in %d days", g.r.Story.WallsBurglaries, g.r.Story.WallsDays)
	}
	// The oldest lies one tick inside the window.
	g.noteBurglary(0, g.Tick()-g.r.Story.WallsDays*sheets.TicksPerDay+1)
	burgleAt(g, 0, g.r.Story.WallsBurglaries-1)
	if got := burgledAt(g, 0); got != g.r.Story.WallsBurglaries {
		t.Fatalf("the view counts %d burglaries, not %d", got, g.r.Story.WallsBurglaries)
	}
	_, c := predicateCast(t, g, wallsTrouble, 0)
	if c.Pressure != g.r.Story.WallsBurglaries || !slices.Equal(c.Regions, []int{homeRegion(g)}) {
		t.Fatalf("a thief in the walls found %+v", c)
	}
	a := castTrouble(t, g, wallsTrouble, 0)
	hold := sideNamed(t, a, sideHold)
	if hold.Mark < 1 || g.GoalOf(hold.Goal) == nil || lastFact(t, g, "trouble.started").Tick != g.Tick() {
		t.Fatalf("a thief in the walls cast without its side: %+v", hold)
	}
	if a.Place != goal.SettlementRef(0) || !slices.Equal(a.Regions, []int{homeRegion(g)}) {
		t.Fatalf("a thief in the walls cast at %s over %v", a.Place, a.Regions)
	}
	audit(t, g)
}

// TestWallsFourCannot: one burglary short of walls-burglaries casts
// nothing.
func TestWallsFourCannot(t *testing.T) {
	g := wallsGame(t)
	burgleAt(g, 0, g.r.Story.WallsBurglaries-1)
	if got := burgledAt(g, 0); got != g.r.Story.WallsBurglaries-1 {
		t.Fatalf("the view counts %d burglaries", got)
	}
	if wallsFinds(t, g, 0) {
		t.Fatal("a thief in the walls under walls-burglaries")
	}
}

// TestWallsOldBurglariesDropOut: a burglary walls-days old no longer
// counts, whether time passes after it or it was noted that long ago, and
// the next one noted trims it from the place's story.
func TestWallsOldBurglariesDropOut(t *testing.T) {
	g := wallsGame(t)
	window := g.r.Story.WallsDays * sheets.TicksPerDay
	g.noteBurglary(0, g.Tick()-window+1)
	burgleAt(g, 0, g.r.Story.WallsBurglaries-1)
	if !wallsFinds(t, g, 0) {
		t.Fatal("five within the window find nothing")
	}
	g.World.Tick++
	if got := burgledAt(g, 0); got != g.r.Story.WallsBurglaries-1 || wallsFinds(t, g, 0) {
		t.Fatalf("a burglary walls-days old still counts: %d", got)
	}
	g.noteBurglary(0, g.Tick())
	if got := len(g.storyAt(0).Burgled); int64(got) != g.r.Story.WallsBurglaries {
		t.Fatalf("the story keeps %d burglaries after the oldest aged out", got)
	}
	if !wallsFinds(t, g, 0) {
		t.Fatal("five within the window again find nothing")
	}

	old := wallsGame(t)
	old.noteBurglary(0, old.Tick()-window)
	burgleAt(old, 0, old.r.Story.WallsBurglaries-1)
	if got := burgledAt(old, 0); got != old.r.Story.WallsBurglaries-1 || wallsFinds(t, old, 0) {
		t.Fatalf("a burglary noted walls-days ago counts: %d", got)
	}
	old.World.Tick += window
	if got := burgledAt(old, 0); got != 0 || wallsFinds(t, old, 0) {
		t.Fatalf("burglaries a week gone still count: %d", got)
	}
}

// TestWallsDirectorCastsOnItsDraw: the director casts a thief in the walls
// like any trouble, on a day its trouble.start draw passes and not on one
// it fails.
func TestWallsDirectorCastsOnItsDraw(t *testing.T) {
	row := troubleRow(t, wallsTrouble)
	g := guardGame(t)
	from := g.r.Story.WallsDays + 1
	pass, fail := int64(-1), int64(-1)
	for d := from; d < from+64 && (pass < 0 || fail < 0); d++ {
		if g.r.draw.Percent(row.Chance, troubleDraw, draw.Int(0), draw.Str(row.ID), draw.Int(d)) {
			if pass < 0 {
				pass = d
			}
		} else if fail < 0 {
			fail = d
		}
	}
	if pass < 0 || fail < 0 {
		t.Fatalf("the trouble's chance of %d%% never passes or never fails", row.Chance)
	}
	walls := func() int {
		n := 0
		for _, a := range g.openArcs(arc.Settlement) {
			if a.Template == wallsTrouble && a.Place == goal.SettlementRef(0) {
				n++
			}
		}
		return n
	}
	for _, c := range []struct {
		day  int64
		want int
	}{{fail, 0}, {pass, 1}} {
		g.Story.Arcs = nil
		g.placeStory(0).Burgled = nil
		g.World.Tick = c.day * sheets.TicksPerDay
		burgleAt(g, 0, g.r.Story.WallsBurglaries)
		if err := g.castSettlements(g.storyView(), g.Tick()); err != nil || walls() != c.want {
			t.Fatalf("day %d cast %d thieves in the walls, want %d: %v", c.day, walls(), c.want, err)
		}
	}
}

// TestWallsHeldAndLost: held, a thief in the walls writes trouble.held and
// its gauge move; lost, trouble.lost, its gauge move and market fees for
// its days.
func TestWallsHeldAndLost(t *testing.T) {
	row := troubleRow(t, wallsTrouble)

	held := wallsGame(t)
	burgleAt(held, 0, held.r.Story.WallsBurglaries)
	a := castTrouble(t, held, wallsTrouble, 0)
	before := len(held.Pending)
	if err := held.endStage(a, sideHold, held.Tick()); err != nil {
		t.Fatal(err)
	}
	if held.storyAt(0).Held != 1 || a.Outcome != sideHold || len(factsOf(held, "trouble.held")) != 1 {
		t.Fatalf("held: %+v", a)
	}
	if got, want := gaugeActs(held.Pending[before:]), gaugeEffects(row.Held); got != want || want == 0 {
		t.Fatalf("held queues %d gauge moves, its row %d", got, want)
	}
	audit(t, held)

	lost := wallsGame(t)
	burgleAt(lost, 0, lost.r.Story.WallsBurglaries)
	a = castTrouble(t, lost, wallsTrouble, 0)
	before = len(lost.Pending)
	lose(t, lost, a)
	if lost.storyAt(0).Lost != 1 || len(factsOf(lost, "trouble.lost")) != 1 {
		t.Fatal("lost is not counted")
	}
	if got, want := gaugeActs(lost.Pending[before:]), gaugeEffects(row.Lost); got != want || want == 0 {
		t.Fatalf("lost queues %d gauge moves, its row %d", got, want)
	}
	fees := false
	for _, e := range row.Lost {
		if e.Kind == effFees {
			fees = true
			if until := lost.Tick() + e.Amount*sheets.TicksPerDay; lost.storyAt(0).Fees != until {
				t.Fatalf("fees run to %d, not %d", lost.storyAt(0).Fees, until)
			}
		}
	}
	if !fees {
		t.Fatal("a thief in the walls lost raises no fees")
	}
	audit(t, lost)
}

func needSum(f world.Faction) int64 {
	n := int64(0)
	for _, nd := range f.Needs {
		n += nd.Goods
	}
	return n
}

// TestBurgledFactionNeed: a burglary's fall in a faction's Stock (its
// goods-per-unit for each unit taken) scores at the next world day as need
// like any shortfall below need-threshold: all of it while the faction is
// already short, the part under the threshold when the fall crosses it,
// and none while it stays at or above.
func TestBurgledFactionNeed(t *testing.T) {
	probe := guardGame(t)
	k, ok := probe.TheftKind(KindBurgle)
	if !ok || k.GoodsPerUnit < 1 {
		t.Fatal("no burgle kind")
	}
	fi := slices.IndexFunc(probe.World.Factions, func(f world.Faction) bool {
		a := probe.r.Values.Archetype(f.Archetype)
		return !f.Fallen && a != nil && len(a.Buys) > 0
	})
	if fi < 0 {
		t.Fatal("no living faction buys anything")
	}
	threshold := sheets.IntParam(probe.r.Book.FactionParams, "need-threshold")
	fall := k.Goods / k.GoodsPerUnit * k.GoodsPerUnit

	// needAfter is faction fi's need at day 1, holding the first
	// settlement's region with its Stock set to stock and then burgled of
	// fall there.
	needAfter := func(stock, fall int64) int64 {
		t.Helper()
		g := guardGame(t)
		g.World.Regions[homeRegion(g)].Holder = fi
		g.World.Factions[fi].Stock = stock - fall
		if fall > 0 {
			g.noteBurglary(0, g.Tick())
		}
		toDay(t, g, 1)
		return needSum(g.World.Factions[fi])
	}

	low := threshold / 2
	short := needAfter(low, 0)
	if short < 1 {
		t.Fatalf("a faction at %d of %d scores no need", low, threshold)
	}
	if got := needAfter(low, fall); got != short+fall {
		t.Fatalf("burgled of %d, a short faction's need is %d, not %d", fall, got, short+fall)
	}
	// What a day adds to Stock before needs are scored.
	net := threshold - low - short

	at := threshold - net + fall
	if got := needAfter(at, fall); got != 0 {
		t.Fatalf("burgled down to the threshold, a faction needs %d", got)
	}
	crossing := threshold - net + fall/2
	if got, want := needAfter(crossing, 0), int64(0); got != want {
		t.Fatalf("above the threshold, a faction needs %d", got)
	}
	if got, want := needAfter(crossing, fall), fall-fall/2; got != want {
		t.Fatalf("burgled across the threshold, a faction needs %d, not its shortfall %d", got, want)
	}
}
