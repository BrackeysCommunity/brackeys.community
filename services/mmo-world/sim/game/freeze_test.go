package game_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/world"
)

// testdata/pre-mm8a is a game recorded before content was drawn from
// history: three characters, six days of walking that discovered a
// dungeon's entrance, a site and a second settlement, and a resident
// talked to. reads.json is what every discovered tile read then.
const (
	preDir = "testdata/pre-mm8a/"
	// preTiers are the live tiers a floor is read at.
	preTiers = 4
)

type preFloor struct {
	N     int64           `json:"n"`
	Way   int64           `json:"way"`
	Plan  gen.FloorPlan   `json:"plan"`
	Tiers []gen.FloorPlan `json:"tiers"`
}

type prePerson struct {
	ID     string   `json:"id"`
	Role   string   `json:"role"`
	Name   string   `json:"name"`
	Traits []string `json:"traits"`
}

type preTile struct {
	At        hex.Hex          `json:"at"`
	Site      string           `json:"site"`
	Creatures []string         `json:"creatures"`
	Dungeon   *gen.Plan        `json:"dungeon,omitempty"`
	Floors    []preFloor       `json:"floors,omitempty"`
	Stock     map[string]int64 `json:"stock"`
	People    []prePerson      `json:"people,omitempty"`
}

// preReads are what every discovered tile reads through the game, as
// reads.json was written.
func preReads(g *game.Game) []byte {
	var out []preTile
	for _, tl := range g.World.Tiles {
		if tl.Discovered == nil {
			continue
		}
		h := tl.Hex
		rt := preTile{At: h, Site: g.SiteAt(h), Creatures: g.Creatures(h), Stock: map[string]int64{}}
		for _, m := range g.Materials(h) {
			rt.Stock[m] = g.StockLeft(h, m)
		}
		if p, ok := g.Plan(h); ok {
			rt.Dungeon = &p
			for n := int64(1); n <= p.Floors; n++ {
				ways := []int64{0, 1, 2}
				if n == 1 {
					ways = []int64{-1}
				}
				for _, w := range ways {
					f := preFloor{N: n, Way: w, Plan: g.Floor(h, n, w)}
					for tier := int64(1); tier <= preTiers; tier++ {
						f.Tiers = append(f.Tiers, g.FloorAt(h, n, w, tier))
					}
					rt.Floors = append(rt.Floors, f)
				}
			}
		}
		if g.IsSettlement(h) {
			for _, p := range g.PeopleHere(g.Chars[0], h) {
				rt.People = append(rt.People, prePerson{ID: p.ID, Role: p.Role, Name: p.Name, Traits: p.Traits})
			}
		}
		out = append(out, rt)
	}
	slices.SortFunc(out, func(a, b preTile) int { return hex.Compare(a.At, b.At) })
	body, _ := json.MarshalIndent(out, "", "\t")
	return append(body, '\n')
}

func preLoad(t *testing.T, r *game.Rules, body []byte) *game.Game {
	t.Helper()
	var g game.Game
	if err := json.Unmarshal(body, &g); err != nil {
		t.Fatal(err)
	}
	g.Attach(r)
	return &g
}

// A game saved before content was drawn from history loads at its saved
// digest and reads as it did; the freeze stores that content on every
// discovered tile, changes none of those reads, and saves and loads
// again at its own digest.
func TestPreMM8aFrozen(t *testing.T) {
	r := testkit.Rules(t, testkit.Book(t), keys.Throwaway("pre-mm8a"))
	body, err := os.ReadFile(preDir + "snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	saved, err := os.ReadFile(preDir + "digest.txt")
	if err != nil {
		t.Fatal(err)
	}
	reads, err := os.ReadFile(preDir + "reads.json")
	if err != nil {
		t.Fatal(err)
	}
	g := preLoad(t, r, body)
	if d, err := g.Digest(); err != nil || d.String() != strings.TrimSpace(string(saved)) {
		t.Fatalf("the pre-MM8a snapshot digests %s (%v), saved as %s", d, err, saved)
	}
	if g.World.Drawn() {
		t.Fatal("a world from before content was drawn reads as drawing")
	}
	if got := preReads(g); !bytes.Equal(got, reads) {
		t.Fatalf("before the freeze the discovered tiles read otherwise:\n%s", got)
	}
	discovered := 0
	for _, tl := range g.World.Tiles {
		if tl.Discovered != nil {
			discovered++
		}
	}

	var frozen []string
	for range 2 {
		g := preLoad(t, r, body)
		res, err := g.Act(game.Command{Key: game.ContentFreeze, Kind: game.ContentFreeze})
		if err != nil {
			t.Fatal(err)
		}
		if !g.World.Drawn() || len(res.Facts) != 1 || res.Facts[0].Kind != "world.content-frozen" {
			t.Fatalf("the freeze left version %d with facts %+v", g.World.ContentVersion, res.Facts)
		}
		if n, ok := res.Facts[0].Get("tiles"); !ok || n.N != int64(discovered) {
			t.Fatalf("the freeze says it froze %+v tiles, %d are discovered", n, discovered)
		}
		for _, tl := range g.World.Tiles {
			if tl.Discovered != nil && (tl.Content == nil || !tl.Content.Native || tl.Content.Key != "" || tl.Content.SiteKind != "") {
				t.Fatalf("%s froze as %+v", tl.Hex.Ref(), tl.Content)
			}
		}
		if got := preReads(g); !bytes.Equal(got, reads) {
			t.Fatalf("after the freeze the discovered tiles read otherwise:\n%s", got)
		}
		d, err := g.Digest()
		if err != nil {
			t.Fatal(err)
		}
		before := d
		_, err = g.Act(game.Command{Key: game.ContentFreeze + "-again", Kind: game.ContentFreeze})
		var ref *game.Refused
		if !errors.As(err, &ref) || ref.Code != world.CodeAlreadyFrozen {
			t.Fatalf("a second freeze: %v", err)
		}
		if again, _ := g.Digest(); again != before {
			t.Fatal("a refused second freeze moved the digest")
		}
		out, err := json.Marshal(g)
		if err != nil {
			t.Fatal(err)
		}
		h := preLoad(t, r, out)
		if d2, _ := h.Digest(); d2 != d {
			t.Fatalf("the frozen game saved and loaded digests %s, %s before", d2, d)
		}
		if !h.World.Drawn() || !bytes.Equal(preReads(h), reads) {
			t.Fatal("the frozen game saved and loaded reads otherwise")
		}
		frozen = append(frozen, d.String())
	}
	if frozen[0] != frozen[1] {
		t.Fatalf("two freezes of one snapshot digest %s and %s", frozen[0], frozen[1])
	}
}

// A character who arrived on a tile whose discovery is still pending
// when the freeze runs keeps the native content it stood on.
func TestFreezePendingArrival(t *testing.T) {
	r := testkit.Rules(t, testkit.Book(t), keys.Throwaway("freeze-pending"))
	g, err := game.New(r)
	if err != nil {
		t.Fatal(err)
	}
	g.World.ContentVersion = world.ContentNative
	res, err := g.Act(game.Command{Key: "a", Kind: game.Create})
	if err != nil {
		t.Fatal(err)
	}
	c := res.Char
	h := c.C.At
	if tl := g.World.Tile(h); tl != nil && tl.Discovered != nil {
		t.Fatalf("%s is already discovered", h.Ref())
	}
	if !slices.ContainsFunc(g.Pending, func(a world.Action) bool { return a.Kind == world.ActDiscover && a.Hex == h }) {
		t.Fatalf("no discovery pending for %s: %+v", h.Ref(), g.Pending)
	}
	people := func() []game.Person { return g.PeopleHere(c, h) }
	before := people()
	if _, err := g.Act(game.Command{Key: game.ContentFreeze, Kind: game.ContentFreeze}); err != nil {
		t.Fatal(err)
	}
	native := g.World.Content(h)
	if native == nil || !native.Native {
		t.Fatalf("the tile the character stands on froze to %+v", native)
	}
	lead, stock := native.Lead, len(native.Stock)
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
	after := g.World.Content(h)
	if after == nil || !after.Native || after.Key != "" || after.SiteKind != "" || after.Lead != lead || len(after.Stock) != stock {
		t.Fatalf("the tile read %+v after the tick, froze as %+v", after, native)
	}
	if !reflect.DeepEqual(before, people()) {
		t.Fatalf("the residents read %+v before the freeze, %+v after", before, people())
	}
}

// A site a resident told of is queued for discovery though nobody stands on
// it; the freeze keeps it native too.
func TestFreezePendingRumour(t *testing.T) {
	r := testkit.Rules(t, testkit.Book(t), keys.Throwaway("freeze-rumour"))
	g, err := game.New(r)
	if err != nil {
		t.Fatal(err)
	}
	g.World.ContentVersion = world.ContentNative
	res, err := g.Act(game.Command{Key: "a", Kind: game.Create})
	if err != nil {
		t.Fatal(err)
	}
	c := res.Char
	var h hex.Hex
	found := false
	for _, x := range hex.Ring(c.C.At, 5) {
		if tl := g.World.Tile(x); (tl == nil || tl.Discovered == nil) && g.World.Content(x) == nil {
			h, found = x, true
			break
		}
	}
	if !found {
		t.Fatal("no unreached tile five out")
	}
	g.Pending = append(g.Pending, world.Action{Kind: world.ActDiscover, Hex: h, By: char.Ref(c.C.ID)})
	if _, err := g.Act(game.Command{Key: game.ContentFreeze, Kind: game.ContentFreeze}); err != nil {
		t.Fatal(err)
	}
	if ct := g.World.Content(h); ct == nil || !ct.Native {
		t.Fatalf("the rumoured tile froze to %+v", ct)
	}
}

// An open Reach goal's entrance keeps the native plan its floor was checked against.
func TestFreezeReachGoal(t *testing.T) {
	r := testkit.Rules(t, testkit.Book(t), keys.Throwaway("freeze-reach"))
	g, err := game.New(r)
	if err != nil {
		t.Fatal(err)
	}
	g.World.ContentVersion = world.ContentNative
	res, err := g.Act(game.Command{Key: "a", Kind: game.Create})
	if err != nil {
		t.Fatal(err)
	}
	c := res.Char
	busy := func(h hex.Hex) bool {
		if tl := g.World.Tile(h); tl != nil && tl.Discovered != nil {
			return true
		}
		if g.World.Content(h) != nil {
			return true
		}
		for _, a := range g.Pending {
			if (a.Kind == world.ActDiscover || a.Kind == world.ActVisit) && a.Hex == h {
				return true
			}
		}
		for _, o := range g.Chars {
			if o.C.At == h {
				return true
			}
		}
		return false
	}
	var h hex.Hex
	var native gen.Plan
	found := false
	for radius := int64(1); radius <= 40 && !found; radius++ {
		for _, x := range hex.Ring(c.C.At, radius) {
			if busy(x) {
				continue
			}
			if p, ok := g.Rules().Gen.Dungeon(x); ok {
				h, native, found = x, p, true
				break
			}
		}
	}
	if !found {
		t.Skip("no undiscovered dungeon entrance near the start")
	}
	g.Goals = append(g.Goals, &game.Goal{ID: "g-freeze-reach", State: goal.Live, Cond: goal.Condition{Verb: goal.Reach, Dungeon: h.Ref(), Floor: native.Floors, Count: 1}})
	slices.SortFunc(g.Goals, func(a, b *game.Goal) int { return strings.Compare(a.ID, b.ID) })
	if _, err := g.Act(game.Command{Key: game.ContentFreeze, Kind: game.ContentFreeze}); err != nil {
		t.Fatal(err)
	}
	if ct := g.World.Content(h); ct == nil || !ct.Native {
		t.Fatalf("the goal's entrance froze to %+v", ct)
	}
	plan, ok := g.Plan(h)
	if !ok || !reflect.DeepEqual(plan, native) {
		t.Fatalf("the entrance reads %+v (%v) after the freeze, was %+v", plan, ok, native)
	}
}
