package game

import (
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
)

// freshWay is a direction from h onto a tile nobody has discovered that c
// can enter.
func freshWay(t *testing.T, g *Game, c *Char, h hex.Hex) int {
	t.Helper()
	for d := range hex.Directions {
		to := h.Neighbour(d)
		if tl := g.World.Tile(to); tl != nil && tl.Discovered != nil {
			continue
		}
		if _, _, ok := g.EnterCost(c, h, to, g.Tick()); ok {
			return d
		}
	}
	t.Fatal("no undiscovered tile to enter")
	return -1
}

// firsts are the characters whose travel.entered on h says first sight.
func firsts(g *Game, h hex.Hex) []string {
	var out []string
	for _, f := range g.Log.Since(0) {
		if f.Kind != "travel.entered" {
			continue
		}
		if at, ok := fact.HexOf(f); !ok || at != h {
			continue
		}
		if d, _ := f.Get("first"); d.N > 0 {
			out = append(out, factWho(f))
		}
	}
	return out
}

func stepAll(t *testing.T, g *Game, dir int, cs ...*Char) {
	t.Helper()
	for _, c := range cs {
		if _, err := g.Act(Command{Key: "step-" + c.C.ID, Char: c.C.ID, Kind: Step, Dir: dir}); err != nil {
			t.Fatal(err)
		}
	}
	for cs[0].Long != nil {
		advance(t, g)
	}
}

// A party that walks onto a tile first sees it together: the follower's
// entry is a first sight too, and its mount is ridden the step (GDD 6.2).
func TestFollowerSeesFirstAndRides(t *testing.T) {
	g := guardGame(t)
	start := mustCreate(t, g, "start", "knife").C.At
	cs := formParty(t, g, 2, start)
	lead, f := cs[0], cs[1]
	f.C.Carry(char.Mount, 0, g.r.Mounts.NewMount("follow-mount", g.r.Book.MountKinds[0].ID))
	act(t, g, f, Follow, "")
	dir := freshWay(t, g, lead, start)
	stepAll(t, g, dir, lead)
	to := start.Neighbour(dir)
	if f.C.At != to {
		t.Fatalf("the follower is at %v, want %v", f.C.At, to)
	}
	got := firsts(g, to)
	if len(got) != 2 {
		t.Fatalf("first sights on the tile: %v, want the leader and the follower", got)
	}
	if f.Rode == 0 {
		t.Fatal("the follower's mount was not ridden")
	}
}

// Two strangers entering one undiscovered tile on the same tick: only the
// one the world records as its discoverer sees it first.
func TestOneFirstSightATick(t *testing.T) {
	g := guardGame(t)
	start := mustCreate(t, g, "start", "knife").C.At
	cs := feedChars(t, g, 2, start)
	dir := freshWay(t, g, cs[0], start)
	stepAll(t, g, dir, cs...)
	to := start.Neighbour(dir)
	if cs[0].C.At != to || cs[1].C.At != to {
		t.Fatal("both did not arrive")
	}
	got := firsts(g, to)
	if len(got) != 1 {
		t.Fatalf("first sights on the tile: %v, want one", got)
	}
	if by := g.World.Tile(to).Discovered.By.ID; by != got[0] {
		t.Fatalf("%s saw it first, the world says %s", got[0], by)
	}
}

// A wounded follower holds the party back as a wounded leader would.
func TestWoundedFollowerSlowsTheParty(t *testing.T) {
	g := guardGame(t)
	start := mustCreate(t, g, "start", "knife").C.At
	cs := formParty(t, g, 2, start)
	lead, f := cs[0], cs[1]
	act(t, g, f, Follow, "")
	f.C.Set(char.Wounded, g.Tick()+100)
	dir := freshWay(t, g, lead, start)
	to := start.Neighbour(dir)
	cost := g.slowest(lead, start, to, 0, g.Tick())
	if _, err := g.Act(Command{Key: "step-wounded", Char: lead.C.ID, Kind: Step, Dir: dir}); err != nil {
		t.Fatal(err)
	}
	if want := cost + g.r.wp("wounded-ticks"); lead.Long.StepTicks != want {
		t.Fatalf("the step takes %d ticks, want %d", lead.Long.StepTicks, want)
	}
}
