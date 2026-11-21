package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/sheets"
)

func TestRescueThroughClearedFloors(t *testing.T) {
	g := guardGame(t)
	h, _ := dungeonFor(t, g, "", 4)
	d := mustCreate(t, g, "downed", "knife")
	d.C.At = h
	explored(t, g, d)
	for range 2 {
		endFight(t, g, d, fight.Won, someHaul(g))
		act(t, g, d, DungeonPush, WayOption(gen.WayOpen))
	}
	d.Fight.E.Down = append(d.Fight.E.Down, d.C.ID)
	d.C.Set(char.Down, 0)
	endFight(t, g, d, fight.Lost, nil)
	act(t, g, d, CallHelp, "")
	call := g.callOf(d)
	if call == nil || call.Cond.Floor != 3 {
		t.Fatalf("the call for help names no floor: %+v", call)
	}
	advance(t, g)
	if !g.floorRead(h, 1) || !g.floorRead(h, 2) || g.floorRead(h, 3) {
		t.Fatal("floors 1 and 2 should stand cleared and 3 not")
	}

	r := mustCreate(t, g, "rescuer", "knife")
	r.C.At = h
	act(t, g, r, DungeonPush, "")
	if r.C.Floor != 1 || r.Fight != nil {
		t.Fatalf("through floor 1 with no encounter: floor %d", r.C.Floor)
	}
	act(t, g, r, DungeonPush, WayOption(d.Delving.Way))
	if r.C.Floor != 2 || r.Fight != nil {
		t.Fatalf("through floor 2 with no encounter: floor %d", r.C.Floor)
	}
	act(t, g, r, DungeonPush, WayOption(gen.WayOpen))
	if r.Fight == nil || r.Fight.E.Floor != 3 {
		t.Fatal("floor 3 stands, and must be cleared")
	}
	endFight(t, g, r, fight.Won, nil)
	if _, err := g.Act(Command{Key: "lift", Char: r.C.ID, Kind: CarryHome, Target: d.C.ID}); err != nil {
		t.Fatal(err)
	}
	e := r.Fight.E
	if want := 3 * g.fp("carry-up-beats"); int64(len(e.Beats)) != want || slices.ContainsFunc(e.Beats, func(b string) bool { return b != fight.BeatHazard }) {
		t.Fatalf("the carry up is %v, not %d hazard beats", e.Beats, want)
	}
	endFight(t, g, r, fight.Won, nil)
	if r.Long == nil || r.Long.Kind != Climb {
		t.Fatal("no climb after the carry up")
	}
	advance(t, g)
	if r.C.Floor != 0 || d.C.Floor != 0 || r.Carrying != d.C.ID {
		t.Fatalf("out: rescuer on %d, carried on %d", r.C.Floor, d.C.Floor)
	}
	audit(t, g)
}

func TestRescueTheWayBackSkipsTheCarryUp(t *testing.T) {
	g := guardGame(t)
	h, _ := dungeonFor(t, g, "", 3)
	cs := formParty(t, g, 2, h)
	toFork(t, g, cs)
	d, r := cs[1], cs[0]
	d.C.Set(char.Down, 0)
	act(t, g, d, CallHelp, "")
	with(r, "delver", "the-way-back")
	if !g.wayBack(r) {
		t.Skip("the-way-back is not live")
	}
	if _, err := g.Act(Command{Key: "lift", Char: r.C.ID, Kind: CarryHome, Target: d.C.ID}); err != nil {
		t.Fatal(err)
	}
	if r.Fight != nil || r.Long == nil || r.Long.Kind != Climb {
		t.Fatalf("The way back climbs at once: %+v", r.Long)
	}
}

func TestFloorsRefillOnTheirOwn(t *testing.T) {
	g := guardGame(t)
	h, _ := dungeonFor(t, g, "", 3)
	c := mustCreate(t, g, "refill", "knife")
	c.C.At = h
	explored(t, g, c)
	endFight(t, g, c, fight.Won, nil)
	act(t, g, c, DungeonPush, WayOption(gen.WayOpen))
	for range 5 {
		advance(t, g)
	}
	endFight(t, g, c, fight.Won, nil)
	advance(t, g)
	if !g.floorRead(h, 1) || !g.floorRead(h, 2) || g.CanExplore(h) {
		t.Fatal("cleared floors stand cleared, and the entrance waits")
	}
	d := g.recordOf(h)
	one, two := d.Floor(1).ClearedAt, d.Floor(2).ClearedAt
	if one >= two {
		t.Fatalf("floor 1 cleared at %d, floor 2 at %d", one, two)
	}
	for g.Tick() < one+g.refillTicks() {
		advance(t, g)
	}
	if g.floorRead(h, 1) || !g.floorRead(h, 2) || !g.CanExplore(h) {
		t.Fatalf("floor 1 refills a refill after it was cleared, floor 2 on its own time (1: %v, 2: %v)", g.floorRead(h, 1), g.floorRead(h, 2))
	}
	for g.Tick() < two+g.refillTicks() {
		advance(t, g)
	}
	if g.floorRead(h, 2) {
		t.Fatal("floor 2 did not refill")
	}
}

func TestHauntedComesAndGoes(t *testing.T) {
	g := guardGame(t)
	h, _ := dungeonFor(t, g, "", 3)
	falls := g.tp("haunted-falls")
	for i := range falls {
		c := mustCreate(t, g, "faller-"+string(rune('a'+i)), "knife")
		c.C.At = h
		c.C.Floor = 1
		c.Delving = &Delving{Dungeon: h.Ref(), Way: noWay}
		if err := g.downOnFloor(c, 1, "fall-"+c.C.ID); err != nil {
			t.Fatal(err)
		}
	}
	day := func() {
		for {
			advance(t, g)
			if g.Tick()%sheets.TicksPerDay == 0 {
				return
			}
		}
	}
	day()
	if d := g.recordOf(h); d == nil || !d.Haunted || len(factsOf(g, "dungeon.haunted")) != 1 {
		t.Fatalf("%d falls in the window do not haunt it", falls)
	}
	explorer := mustCreate(t, g, "haunt-explorer", "knife")
	explorer.C.At = h
	explored(t, g, explorer)
	if !slices.Contains(explorer.Fight.E.Site, tagHaunted) {
		t.Fatal("a haunted dungeon's floor is not tagged haunted")
	}
	for range g.tp("haunted-days") {
		day()
	}
	if d := g.recordOf(h); d.Haunted || len(factsOf(g, "dungeon.calm")) != 1 {
		t.Fatal("the haunting does not go once the falls age out")
	}
}

func TestGoalToTheBottom(t *testing.T) {
	g := guardGame(t)
	h, plan := dungeonFor(t, g, "", 5)
	poster := mustCreate(t, g, "poster", "knife")
	poster.C.Coin = 0
	post := func(floor int64) error {
		_, err := g.Act(Command{Key: "post-bottom-" + string(rune('0'+floor)), Char: poster.C.ID, Kind: PostGoal, Goal: &GoalSpec{
			Title: "To the bottom", Issuer: goal.ByCharacter, Mode: goal.First, Lifetime: goal.Standing, Turnover: goal.Keep,
			Cond: goal.Condition{Verb: goal.Reach, Dungeon: h.Ref(), Floor: floor, Count: 1}}})
		return err
	}
	if err := post(plan.Floors + 1); !refusedAs(err, BadArgs) {
		t.Fatalf("a floor past the bottom is posted: %v", err)
	}
	if err := post(plan.Floors); err != nil {
		t.Fatal(err)
	}
	x := g.Goals[len(g.Goals)-1]
	c := mustCreate(t, g, "bottom", "knife")
	c.C.At = h
	explored(t, g, c)
	for n := int64(1); n < plan.Floors; n++ {
		if x.State == goal.Done {
			t.Fatalf("met on floor %d", n)
		}
		endFight(t, g, c, fight.Won, nil)
		act(t, g, c, DungeonPush, WayOption(gen.WayOpen))
	}
	if c.C.Floor != plan.Floors || x.State != goal.Done || x.Claims[0].Who != c.C.ID {
		t.Fatalf("reaching floor %d of %d: the goal is %s", c.C.Floor, plan.Floors, x.State)
	}
}
