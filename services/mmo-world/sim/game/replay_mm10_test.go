package game_test

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

var updateMM10 = flag.Bool("update-mm10", false, "record testdata/replay-mm10 again")

// mm10Fixture is a recorded game with emergence on: a snapshot with
// walkers on one of two neighbouring open tiles; the operator's
// hunt-start beside the first settlement as the first command after it;
// the walkers' steps back and forth until the tiles' crossings promote a
// road; and the digest the game reaches a tick after the last command.
type mm10Fixture struct {
	Label    string          `json:"label"`
	Walk     [2]hex.Hex      `json:"walk"`
	Hunt     hex.Hex         `json:"hunt"`
	Walkers  []string        `json:"walkers"`
	Snapshot json.RawMessage `json:"snapshot"`
	Ticks    int64           `json:"ticks"`
	Commands []mm8Tick       `json:"commands"`
	Digest   string          `json:"digest"`
}

const (
	mm10File = "testdata/replay-mm10/road-and-staged-hunt.json"
	mm10Hunt = "dust-runner-migration"
	// mm10Tier readies the walkers against what lives on the walk.
	mm10Tier = 2
	// mm10Days caps the scene in world days; the road's line is crossed
	// well inside its window.
	mm10Days = 3
	// mm10Search is how far from the first settlement the walk is looked
	// for.
	mm10Search = 12
)

// TestReplayMM10 replays the recorded walk and staged hunt twice from its
// snapshot. Each replay takes every command and reaches the recorded
// digest, and the first shows what the fixture is for.
func TestReplayMM10(t *testing.T) {
	r := testkit.Rules(t, testkit.Book(t), keys.Throwaway("replay-mm10"))
	if *updateMM10 {
		recordMM10(t, r)
	}
	body, err := os.ReadFile(mm10File)
	if err != nil {
		t.Fatal(err)
	}
	var fx mm10Fixture
	if err := json.Unmarshal(body, &fx); err != nil {
		t.Fatal(err)
	}
	if err := mm10Before(mm8aSnapshot(t, r, fx.Snapshot), &fx); err != nil {
		t.Fatal(err)
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
			if err := mm10Shows(g, &fx); err != nil {
				t.Fatal(err)
			}
			audit(t, g)
		}
	}
}

// mm10Before is nil when the snapshot keeps emergence with nothing
// promoted and no hunt live, and the commands after it hold exactly one
// operator command, the hunt-start, first.
func mm10Before(g *game.Game, fx *mm10Fixture) error {
	if g.Emergence == nil {
		return errors.New("the snapshot has emergence off")
	}
	if n := len(g.Emergence.Promotions); n > 0 {
		return fmt.Errorf("the snapshot already holds %d promotions", n)
	}
	if len(g.Hunts) > 0 {
		return fmt.Errorf("the snapshot already runs %d hunts", len(g.Hunts))
	}
	var ops []string
	for _, tk := range fx.Commands {
		for _, cmd := range tk.Commands {
			if game.Operator(cmd.Kind) {
				ops = append(ops, cmd.Kind)
			}
		}
	}
	if len(fx.Commands) == 0 || len(fx.Commands[0].Commands) == 0 || fx.Commands[0].Commands[0].Kind != game.HuntStart || len(ops) != 1 {
		return fmt.Errorf("the operator's commands should be one hunt-start, first: %v", ops)
	}
	return nil
}

// mm10Shows is nil when a game shows what the fixture is for: a road
// promoted on the walk by twenty or more walkers, its tile raised to a
// road and its promotion fact unstaged; and the operator's hunt, every
// fact naming it stamped staged and none of the walk's facts stamped.
func mm10Shows(g *game.Game, fx *mm10Fixture) error {
	e := g.Emergence
	if e == nil {
		return errors.New("emergence is off")
	}
	i := slices.IndexFunc(e.Promotions, func(p emerge.Promotion) bool {
		return p.Type == emerge.Road && p.At != nil && slices.Contains(fx.Walk[:], *p.At)
	})
	if i < 0 {
		return fmt.Errorf("no road was promoted on the walk: %+v", e.Promotions)
	}
	road := e.Promotions[i]
	if tl := g.World.Tile(*road.At); tl == nil || tl.Road <= 0 || e.Roads[*road.At] == "" {
		return fmt.Errorf("the promoted tile %s is no road", road.At.Ref())
	}
	pf, ok := g.Log.Get(road.Fact)
	if !ok || pf.StagedBy != nil {
		return fmt.Errorf("the road's promotion fact %d should be logged unstaged: %+v", road.Fact, pf)
	}
	if !slices.ContainsFunc(g.Log.Since(0), func(f fact.Fact) bool {
		return f.Kind == "promotion" && slices.Contains(f.Subjects, fact.Ref{Kind: "promotion", ID: road.ID})
	}) {
		return fmt.Errorf("no promotion fact names %s", road.ID)
	}
	hunts := 0
	for _, x := range g.Hunts {
		if x.Why == game.WhyOperator && x.Hex == fx.Hunt {
			hunts++
		}
	}
	if hunts != 1 {
		return fmt.Errorf("%d operator hunts at %s, want 1", hunts, fx.Hunt.Ref())
	}
	staged, walked := 0, 0
	for _, f := range g.Log.Since(0) {
		if slices.ContainsFunc(f.Subjects, func(s fact.Ref) bool { return s.Kind == "hunt" }) {
			if f.StagedBy == nil || f.StagedBy.ID != game.HuntStart {
				return fmt.Errorf("the operator hunt's %s (%d) is stamped %v", f.Kind, f.ID, f.StagedBy)
			}
			staged++
		}
		if f.Kind == "travel.entered" && slices.ContainsFunc(fx.Walkers, func(id string) bool {
			return slices.Contains(f.Subjects, fact.Ref{Kind: "character", ID: id})
		}) {
			if f.StagedBy != nil {
				return fmt.Errorf("a walker's step (%d) is stamped %v", f.ID, f.StagedBy)
			}
			walked++
		}
	}
	if staged == 0 || walked == 0 {
		return fmt.Errorf("%d staged hunt facts and %d walker steps", staged, walked)
	}
	if e.Passage[fx.Hunt] != nil {
		return fmt.Errorf("the staged hunt's tile %s carries a passage trace", fx.Hunt.Ref())
	}
	return nil
}

// recordMM10 plays the scene and writes the fixture.
func recordMM10(t *testing.T, r *game.Rules) {
	t.Helper()
	fx, err := playMM10(r)
	if err != nil {
		t.Fatal(err)
	}
	body, err := json.MarshalIndent(fx, "", " ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(mm10File), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(mm10File, append(body, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
}

// mm10Open reports whether a tile is open land a road could form on: in
// a region, passable, and holding no site, settlement, road or placed
// content.
func mm10Open(g *game.Game, h hex.Hex) bool {
	gn := g.Rules().Gen
	b := gn.Baseline(h)
	if !gn.Passable(b.Terrain) || b.Site != "" || g.World.RegionAt(h) < 0 || g.IsSettlement(h) || g.IsDungeon(h) || g.Placed(h) != nil {
		return false
	}
	tl := g.World.Tile(h)
	return tl == nil || tl.Road <= 0
}

// mm10Walk is the nearest pair of neighbouring open tiles to the first
// settlement, both in its region and off its ring, and a tile beside the
// settlement for the hunt.
func mm10Walk(g *game.Game) ([2]hex.Hex, hex.Hex, error) {
	home := g.SettlementHex(0)
	region := g.World.RegionAt(home)
	hunt, ok := hex.Hex{}, false
	for _, n := range home.Neighbours() {
		if mm10Open(g, n) {
			hunt, ok = n, true
			break
		}
	}
	if !ok {
		return [2]hex.Hex{}, hex.Hex{}, errors.New("no open land beside the first settlement")
	}
	for d := int64(2); d <= mm10Search; d++ {
		for _, a := range hex.Ring(home, d) {
			if g.World.RegionAt(a) != region || !mm10Open(g, a) {
				continue
			}
			for _, b := range a.Neighbours() {
				if hex.Distance(home, b) >= 2 && b != hunt && g.World.RegionAt(b) == region && mm10Open(g, b) {
					return [2]hex.Hex{a, b}, hunt, nil
				}
			}
		}
	}
	return [2]hex.Hex{}, hex.Hex{}, fmt.Errorf("no open pair within %d of the first settlement", mm10Search)
}

// mm10Road is the walk's road promotion, if the walk has made one.
func mm10Road(g *game.Game, walk [2]hex.Hex) bool {
	return slices.ContainsFunc(g.Emergence.Promotions, func(p emerge.Promotion) bool {
		return p.Type == emerge.Road && p.At != nil && slices.Contains(walk[:], *p.At)
	})
}

// playMM10 plays the scene: the operator opens a hunt beside the first
// settlement; the walkers, one more than the road's distinct count, step
// back and forth along the walk until a road is promoted on it.
func playMM10(r *game.Rules) (*mm10Fixture, error) {
	g, err := game.New(r)
	if err != nil {
		return nil, err
	}
	if g.Emergence == nil {
		return nil, errors.New("a new game has emergence off")
	}
	walk, huntAt, err := mm10Walk(g)
	if err != nil {
		return nil, err
	}
	line := r.Emerge.Lines[string(emerge.Road)]
	var walkers []*game.Char
	for i := range line.Distinct + 1 {
		res, err := g.Act(game.Command{Key: fmt.Sprintf("mm10-new-%d", i), Kind: game.Create, Option: "knife"})
		if err != nil {
			return nil, err
		}
		harness.Ready(r, res.Char, mm10Tier, mm10Tier)
		if err := g.Teleport(res.Char, walk[0]); err != nil {
			return nil, err
		}
		walkers = append(walkers, res.Char)
	}
	if _, err := g.Advance(); err != nil {
		return nil, err
	}
	snap, err := json.Marshal(g)
	if err != nil {
		return nil, err
	}
	start := g.Tick()
	var given []mm8Tick
	s := &harness.Script{G: g, Clock: mm8Clock, Label: "mm10", Given: func(cmd game.Command) {
		if len(given) == 0 || given[len(given)-1].Tick != g.Tick() {
			given = append(given, mm8Tick{Tick: g.Tick()})
		}
		given[len(given)-1].Commands = append(given[len(given)-1].Commands, cmd)
	}}
	at := huntAt
	res, ok := s.Act(nil, game.Command{Kind: game.HuntStart, Asset: mm10Hunt, To: &at})
	if !ok {
		return nil, errors.Join(s.Err(), errors.New("hunt-start was refused"))
	}
	for _, f := range res.Facts {
		if f.StagedBy == nil {
			return nil, fmt.Errorf("hunt-start's %s (%d) is not stamped staged", f.Kind, f.ID)
		}
	}
	for !mm10Road(g, walk) {
		if g.Tick()-start > mm10Days*sheets.TicksPerDay {
			return nil, fmt.Errorf("in %d days the walk made no road: %+v", mm10Days, g.Emergence.Passage[walk[1]])
		}
		for _, c := range walkers {
			mm10Step(s, c, walk)
		}
		if err := s.Err(); err != nil {
			return nil, err
		}
		if _, err := g.Advance(); err != nil {
			return nil, err
		}
		s.Clock = max(s.Clock, mm8Clock+(g.Tick()-start)*mm8TickMs)
	}
	if _, err := g.Advance(); err != nil {
		return nil, err
	}
	d, err := g.Digest()
	if err != nil {
		return nil, err
	}
	fx := &mm10Fixture{Label: "replay-mm10", Walk: walk, Hunt: huntAt, Snapshot: snap, Ticks: g.Tick() - start, Commands: given, Digest: d.String()}
	for _, c := range walkers {
		fx.Walkers = append(fx.Walkers, c.C.ID)
	}
	if err := mm10Shows(g, fx); err != nil {
		return nil, err
	}
	if bad := ledger.Audit(g.Ledger.Balances, g.Holdings()); len(bad) > 0 {
		return nil, fmt.Errorf("audit: %v", bad)
	}
	return fx, nil
}

// mm10Step gives a walker one turn: crawl when down, see a fight
// through, or step to the walk's other tile, back onto the walk if it
// was ever pushed off.
func mm10Step(s *harness.Script, c *game.Char, walk [2]hex.Hex) {
	switch {
	case game.IsDown(c):
		if c.Long == nil && c.Fight == nil {
			s.Act(c, game.Command{Kind: game.Crawl})
		}
	case c.Fight != nil:
		if v := s.G.Choose(c).Fight; v != nil {
			s.Act(c, game.Command{Kind: game.Press, Option: harness.Pick(v.Options, v.Beat == v.Beats-1)})
		}
	case c.Long != nil:
	case c.C.At == walk[0]:
		s.Act(c, game.Command{Kind: game.Step, Dir: walk[0].DirectionTo(walk[1])})
	case c.C.At == walk[1]:
		s.Act(c, game.Command{Kind: game.Step, Dir: walk[1].DirectionTo(walk[0])})
	default:
		s.Toward(c, walk[0])
	}
}
