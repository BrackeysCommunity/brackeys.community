package game_test

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
)

var updateMM8a = flag.Bool("update-mm8a", false, "record testdata/replay-mm8a again")

// mm8aFixture is a recorded game on a world that draws content from
// history: a snapshot with three walkers part way from the first
// settlement to a site nobody has reached, a designer's reserve on that
// site given first after it, every command after by tick, and the digest
// the game reaches a tick after the last.
type mm8aFixture struct {
	Label  string   `json:"label"`
	Target hex.Hex  `json:"target"`
	Pin    string   `json:"pin"`
	Reach  int64    `json:"reach"`
	Fix    tile.Fix `json:"fix"`
	// Through walk onto the pinned tile; Out keeps outside its reach.
	Through  []string        `json:"through"`
	Out      string          `json:"out"`
	Snapshot json.RawMessage `json:"snapshot"`
	Ticks    int64           `json:"ticks"`
	Commands []mm8Tick       `json:"commands"`
	Digest   string          `json:"digest"`
}

const (
	mm8aFile = "testdata/replay-mm8a/pin-in-reach.json"
	// The pinned site lies mm8aNear to mm8aFar tiles from the first
	// settlement, and the walkers set out mm8aOut tiles towards it before
	// the pin.
	mm8aNear = 9
	mm8aFar  = 12
	mm8aOut  = 4
	// mm8aReach is the pin's reach.
	mm8aReach = 6
	// mm8aAway is how far from the settlement the walker who stays out
	// heads, on the side away from the pin.
	mm8aAway = 8
	// mm8aTier readies the walkers for what the road sends.
	mm8aTier = 3
	// mm8aDays caps each leg of the walk, in world days.
	mm8aDays = 3
	// mm8aSearch is how many candidate sites the recorder tries.
	mm8aSearch = 40
)

// TestReplayMM8a replays the recorded pin twice from its snapshot. Each
// replay reaches the recorded digest. The pinned tile holds its fix,
// every tile reached after the pin within its reach drew under it and
// none outside did, and no tile reached before the pin changed.
func TestReplayMM8a(t *testing.T) {
	r := testkit.Rules(t, testkit.Book(t), keys.Throwaway("replay-mm8a"))
	if *updateMM8a {
		recordMM8a(t, r)
	}
	body, err := os.ReadFile(mm8aFile)
	if err != nil {
		t.Fatal(err)
	}
	var fx mm8aFixture
	if err := json.Unmarshal(body, &fx); err != nil {
		t.Fatal(err)
	}
	before := mm8aSnapshot(t, r, fx.Snapshot)
	if !before.World.Drawn() {
		t.Fatal("the snapshot is of a world that draws no content")
	}
	for run := range 2 {
		g := replayMM8(t, r, &mm8Fixture{Snapshot: fx.Snapshot, Ticks: fx.Ticks, Commands: fx.Commands})
		got, err := g.Digest()
		if err != nil {
			t.Fatal(err)
		}
		if got.String() != fx.Digest {
			t.Fatalf("replay %d reaches %s, recorded %s", run+1, got, fx.Digest)
		}
		if run == 0 {
			inside, outside, err := mm8aShows(before, g, &fx)
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("after the pin: %d tiles reached inside its reach, %d outside", inside, outside)
		}
	}
}

func mm8aSnapshot(t *testing.T, r *game.Rules, snap []byte) *game.Game {
	t.Helper()
	var g game.Game
	if err := json.Unmarshal(snap, &g); err != nil {
		t.Fatal(err)
	}
	g.Attach(r)
	return &g
}

// mm8aShows counts the tiles reached after the pin inside its reach and
// outside it, and errs when a game played on from before does not show
// what the fixture is for.
func mm8aShows(before, g *game.Game, fx *mm8aFixture) (int, int, error) {
	i := slices.IndexFunc(g.World.Pins, func(p world.Pin) bool { return p.ID == fx.Pin })
	if i < 0 || g.World.Pins[i].At != fx.Target || g.World.Pins[i].Reach != fx.Reach || g.World.Pins[i].Landed == 0 {
		return 0, 0, fmt.Errorf("no pin %s landed on %s with reach %d", fx.Pin, fx.Target.Ref(), fx.Reach)
	}
	pinned := g.World.Content(fx.Target)
	if pinned == nil || pinned.Digest == nil || pinned.Pin != fx.Pin || pinned.SiteKind != fx.Fix.SiteKind {
		return 0, 0, fmt.Errorf("the pinned tile %s holds %+v, fixed to %q", fx.Target.Ref(), pinned, fx.Fix.SiteKind)
	}
	// The same neighbourhood with no pin in it would have drawn another
	// kind, so the fix is what the tile holds.
	unpinned := *pinned.Digest
	unpinned.Pins = nil
	gn := g.Rules().Gen
	if k := gn.Content(fx.Target, gn.Baseline(fx.Target).Site, unpinned, unpinned.Key()).SiteKind; k == fx.Fix.SiteKind {
		return 0, 0, fmt.Errorf("the pinned tile %s would have drawn %q unpinned too", fx.Target.Ref(), k)
	}
	for _, id := range fx.Through {
		if c := g.Char(id); c == nil || c.C.At != fx.Target {
			return 0, 0, fmt.Errorf("%s never stood on the pinned tile", id)
		}
	}
	if c := g.Char(fx.Out); c == nil || hex.Distance(c.C.At, fx.Target) <= fx.Reach {
		return 0, 0, fmt.Errorf("%s did not stay out of the pin's reach", fx.Out)
	}
	for _, bt := range before.World.Tiles {
		if bt.Content == nil {
			continue
		}
		if err := sameContent(bt.Hex, bt.Content, g.World.Content(bt.Hex)); err != nil {
			return 0, 0, err
		}
	}
	inside, outside := 0, 0
	for _, at := range g.World.Tiles {
		c := at.Content
		if c == nil || before.World.Content(at.Hex) != nil {
			continue
		}
		if c.Digest == nil {
			return 0, 0, fmt.Errorf("%s was reached after the pin with no digest stored", at.Hex.Ref())
		}
		in := hex.Distance(at.Hex, fx.Target) <= fx.Reach
		if listed := slices.Contains(c.Digest.Pins, fx.Pin); listed != in {
			return 0, 0, fmt.Errorf("%s, %d from the pin, lists it: %v", at.Hex.Ref(), hex.Distance(at.Hex, fx.Target), listed)
		}
		switch {
		case at.Hex == fx.Target:
		case in:
			inside++
		default:
			outside++
		}
	}
	if inside == 0 || outside == 0 {
		return inside, outside, fmt.Errorf("after the pin %d tiles were reached inside its reach and %d outside", inside, outside)
	}
	return inside, outside, nil
}

// sameContent is nil when a tile reached before the pin holds what it
// held then.
func sameContent(h hex.Hex, was, now *tile.Content) error {
	if now == nil {
		return fmt.Errorf("%s lost the content it was reached with", h.Ref())
	}
	a, err := canon.Digest(was)
	if err != nil {
		return err
	}
	b, err := canon.Digest(now)
	if err != nil {
		return err
	}
	if a != b {
		return fmt.Errorf("%s, reached before the pin, changed", h.Ref())
	}
	return nil
}

// recordMM8a plays the scene at the nearest site that shows what the
// fixture is for, and writes the fixture.
func recordMM8a(t *testing.T, r *game.Rules) {
	t.Helper()
	probe, err := game.New(r)
	if err != nil {
		t.Fatal(err)
	}
	home := probe.SettlementHex(0)
	var sites []hex.Hex
	for d := int64(mm8aNear); d <= mm8aFar && len(sites) < mm8aSearch; d++ {
		for _, h := range hex.Ring(home, d) {
			if s := r.Gen.Baseline(h).Site; (s == gen.SiteOrdinary || s == gen.SiteEdge) && len(sites) < mm8aSearch {
				sites = append(sites, h)
			}
		}
	}
	for _, h := range sites {
		fx, ok := playMM8a(t, r, h)
		if !ok {
			continue
		}
		body, err := json.MarshalIndent(fx, "", " ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Dir(mm8aFile), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(mm8aFile, append(body, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	t.Fatal("no site near the first settlement showed a pin landing in reach")
}

// playMM8a plays the scene at one site: three walkers set out towards
// it, a designer reserves it, two walk on through its reach onto it and
// the third heads away. False when the game does not show what the
// fixture is for.
func playMM8a(t *testing.T, r *game.Rules, target hex.Hex) (*mm8aFixture, bool) {
	t.Helper()
	g, err := game.New(r)
	if err != nil {
		t.Fatal(err)
	}
	home := g.SettlementHex(0)
	tier := min(int64(len(r.Book.FightTiers)), mm8aTier)
	var walkers []*game.Char
	for i := range 3 {
		res, err := g.Act(game.Command{Key: fmt.Sprintf("mm8a-new-walker-%d", i), Kind: game.Create, Option: "knife"})
		if err != nil {
			t.Fatal(err)
		}
		if res.Char.C.At != home {
			t.Fatalf("%s began at %s, not the first settlement", res.Char.C.ID, res.Char.C.At.Ref())
		}
		harness.Ready(r, res.Char, tier, tier)
		walkers = append(walkers, res.Char)
	}
	var given []mm8Tick
	s := &harness.Script{G: g, Clock: mm8Clock, Label: "mm8a"}
	advance := func() {
		if err := s.Err(); err != nil {
			t.Fatal(err)
		}
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
		s.Clock = max(s.Clock, mm8Clock+g.Tick()*mm8TickMs)
	}
	advance()
	set := g.Tick()
	for !mm8aIdle(walkers, func(c *game.Char) bool { return hex.Distance(c.C.At, home) >= mm8aOut }) {
		if g.Tick()-set > mm8aDays*sheets.TicksPerDay {
			return nil, false
		}
		for _, c := range walkers {
			if hex.Distance(c.C.At, home) < mm8aOut {
				mm8aWalk(s, c, target)
			} else {
				mm8aWalk(s, c, c.C.At)
			}
		}
		advance()
	}
	fix, ok := mm8aFix(g, target)
	if !ok {
		return nil, false
	}
	snap, err := json.Marshal(g)
	if err != nil {
		t.Fatal(err)
	}
	start := g.Tick()
	s.Given = func(cmd game.Command) {
		if len(given) == 0 || given[len(given)-1].Tick != g.Tick() {
			given = append(given, mm8Tick{Tick: g.Tick()})
		}
		given[len(given)-1].Commands = append(given[len(given)-1].Commands, cmd)
	}
	if _, ok := s.Act(nil, game.Command{Kind: game.PinReserve, Pin: &game.PinCmd{At: target, Reach: mm8aReach, Fix: fix}}); !ok {
		t.Logf("%s: the reserve was refused", target.Ref())
		return nil, false
	}
	pin := g.World.Pins[len(g.World.Pins)-1].ID
	through, out := walkers[:2], walkers[2]
	away, ok := mm8aAwayFrom(r, home, target)
	if !ok {
		return nil, false
	}
	arrived := func(c *game.Char) bool {
		if slices.Contains(through, c) {
			return c.C.At == target
		}
		return c.C.At == away || hex.Distance(c.C.At, home) >= mm8aAway
	}
	for !mm8aIdle(walkers, arrived) {
		if g.Tick()-start > mm8aDays*sheets.TicksPerDay {
			t.Logf("%s: the walkers never got there", target.Ref())
			return nil, false
		}
		for _, c := range through {
			mm8aWalk(s, c, target)
		}
		mm8aWalk(s, out, away)
		advance()
	}
	advance()
	d, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	fx := &mm8aFixture{
		Label: "replay-mm8a", Target: target, Pin: pin, Reach: mm8aReach, Fix: fix,
		Through: []string{through[0].C.ID, through[1].C.ID}, Out: out.C.ID,
		Snapshot: snap, Ticks: g.Tick() - start, Commands: given, Digest: d.String(),
	}
	if _, _, err := mm8aShows(mm8aSnapshot(t, r, snap), g, fx); err != nil {
		t.Logf("%s: %v", target.Ref(), err)
		return nil, false
	}
	return fx, true
}

// mm8aIdle reports whether every walker is done with its leg: there,
// with nothing under way.
func mm8aIdle(walkers []*game.Char, there func(*game.Char) bool) bool {
	return !slices.ContainsFunc(walkers, func(c *game.Char) bool {
		return c.Long != nil || c.Fight != nil || game.IsDown(c) || !there(c)
	})
}

// mm8aWalk gives a walker one turn: crawl when down, see a fight
// through, or step towards a tile.
func mm8aWalk(s *harness.Script, c *game.Char, to hex.Hex) {
	switch {
	case game.IsDown(c):
		if c.Long == nil && c.Fight == nil {
			s.Act(c, game.Command{Kind: game.Crawl})
		}
	case c.Fight != nil:
		if v := s.G.Choose(c).Fight; v != nil {
			s.Act(c, game.Command{Kind: game.Press, Option: harness.Pick(v.Options, v.Beat == v.Beats-1)})
		}
	case c.Long == nil && c.C.At != to:
		s.Toward(c, to)
	}
}

// mm8aFix is a site kind the tile's slot may hold other than the one it
// would draw now, if a designer may reserve it there with mm8aReach.
func mm8aFix(g *game.Game, h hex.Hex) (tile.Fix, bool) {
	if g.World.Content(h) != nil {
		return tile.Fix{}, false
	}
	gn := g.Rules().Gen
	site := gn.Baseline(h).Site
	d := g.World.DigestAt(h, g.Tick()+1)
	drawn := gn.Content(h, site, d, d.Key()).SiteKind
	for _, k := range g.Rules().Book.SiteKinds {
		if k.ID == drawn || !slices.Contains(k.Places, site) {
			continue
		}
		fix := tile.Fix{SiteKind: k.ID}
		return fix, g.World.CheckPin(h, mm8aReach, fix, world.PinBy{Role: world.PinDesigner}, false) == nil
	}
	return tile.Fix{}, false
}

// mm8aAwayFrom is passable land mm8aAway from the settlement, as far from
// the pin as any.
func mm8aAwayFrom(r *game.Rules, home, pin hex.Hex) (hex.Hex, bool) {
	best, far := hex.Hex{}, int64(-1)
	for _, h := range hex.Ring(home, mm8aAway) {
		if d := hex.Distance(h, pin); r.Gen.Passable(r.Gen.Baseline(h).Terrain) && d > far {
			best, far = h, d
		}
	}
	return best, far > mm8aReach
}
