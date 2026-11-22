package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
)

func TestTrackFledCreature(t *testing.T) {
	g := guardGame(t)
	h := huntTile(t, g)
	c := mustCreate(t, g, "chaser", "knife")
	c.C.At = h
	arch := g.Creatures(h)[0]
	g.soloEncounter(c, arch, 0, 0, "")
	c.Fight.E.Why = append(c.Fight.E.Why, whyFlees)
	endFight(t, g, c, fight.Won, nil)
	advance(t, g)
	tracks := g.FledTracks(c, h)
	if len(tracks) != 1 || tracks[0].Creature != arch || hex.Distance(tracks[0].To, h) != 1 {
		t.Fatalf("the fled track reads %+v", tracks)
	}
	if again := g.FledTracks(c, h); again[0].To != tracks[0].To {
		t.Fatal("where it ran is not one way")
	}
	if slices.ContainsFunc(g.Trails(c, h), func(x Trail) bool { return x.Who == arch }) {
		t.Fatal("a creature's track is read as a character's trail")
	}
	before := digestOf(t, g)
	if _, err := g.Act(Command{Key: "follow-1", Char: c.C.ID, Kind: FollowTrack}); !refusedAs(err, NoTrack) {
		t.Fatalf("following without The long hunt: %v", err)
	}
	if digestOf(t, g) != before {
		t.Fatal("a refused follow changed the game")
	}
	with(c, "stalker", "the-long-hunt")
	if !g.longHunt(c) {
		t.Skip("the-long-hunt is not live")
	}
	res, err := g.Act(Command{Key: "follow-2", Char: c.C.ID, Kind: FollowTrack})
	if err != nil {
		t.Fatal(err)
	}
	if c.C.At != tracks[0].To || c.Fight == nil || c.Fight.E.Creature.Archetype != arch || !hasFact(res, "track.followed") {
		t.Fatalf("following: at %v, %+v", c.C.At, c.Fight)
	}
	for range g.trackWindow(c) + 1 {
		advance(t, g)
	}
	if len(g.FledTracks(c, h)) != 0 {
		t.Fatal("a track past the window still reads")
	}
}

func TestTrackHaulAlongTheRoute(t *testing.T) {
	g := guardGame(t)
	poster := mustCreate(t, g, "route-poster", "knife")
	home := g.SettlementHex(0)
	var walked []hex.Hex
	at := home
	for range 3 {
		for d := range hex.Directions {
			n := at.Neighbour(d)
			if _, ok := g.World.EnterTicks(at, n); ok && n != home && !slices.Contains(walked, n) {
				walked = append(walked, n)
				at = n
				break
			}
		}
	}
	for i := len(walked) - 1; i >= 0; i-- {
		poster.C.Walk(walked[i], g.r.limits)
	}
	poster.C.Walk(home, g.r.limits)
	mat := someHaul(g)[0].Material
	if _, err := g.Act(Command{Key: "route-grant", Char: poster.C.ID, Kind: Correct, Asset: ledger.Material(mat), Units: 5, Note: "test"}); err != nil {
		t.Fatal(err)
	}
	if _, err := g.Act(Command{Key: "route-coin", Char: poster.C.ID, Kind: Correct, Asset: ledger.Coin, Units: 100, Note: "test"}); err != nil {
		t.Fatal(err)
	}
	if _, err := g.Act(Command{Key: "route-post", Char: poster.C.ID, Kind: PostGoal, Goal: &GoalSpec{
		Title: "Haul it", Issuer: goal.ByCharacter, Mode: goal.First, Lifetime: goal.Standing, Turnover: goal.Keep, Reward: g.gp("reward-least"),
		Cond: goal.Condition{Verb: goal.Haul, Count: 5, From: goal.SettlementRef(0), At: goal.TileRef(walked[len(walked)-1])}, Material: mat, Units: 5, Route: true}}); err != nil {
		t.Fatal(err)
	}
	x := g.Goals[len(g.Goals)-1]
	if !slices.Equal(x.Cargo.Route, walked) {
		t.Fatalf("the route is %v, not %v", x.Cargo.Route, walked)
	}
	hauler := mustCreate(t, g, "route-hauler", "knife")
	if _, err := g.Act(Command{Key: "route-hauler-coin", Char: hauler.C.ID, Kind: Correct, Asset: ledger.Coin, Units: 100, Note: "test"}); err != nil {
		t.Fatal(err)
	}
	if _, err := g.Act(Command{Key: "route-take", Char: hauler.C.ID, Kind: TakeHaul, Target: x.ID}); err != nil {
		t.Fatal(err)
	}
	travel := func(key string) error {
		_, err := g.Act(Command{Key: key, Char: hauler.C.ID, Kind: Travel, To: &walked[len(walked)-1], Along: x.ID})
		return err
	}
	if err := travel("route-go"); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(hauler.Long.Route, walked) || !x.Cargo.Used {
		t.Fatalf("travelling along: %v", hauler.Long.Route)
	}
	if _, err := g.Act(Command{Key: "route-stop", Char: hauler.C.ID, Kind: Cancel}); err != nil {
		t.Fatal(err)
	}
	if err := travel("route-again"); !refusedAs(err, Used) {
		t.Fatalf("a route travelled twice: %v", err)
	}
}
