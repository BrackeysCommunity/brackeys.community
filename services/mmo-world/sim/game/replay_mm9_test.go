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
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

var updateMM9 = flag.Bool("update-mm9", false, "record testdata/replay-mm9 again")

// mm9Fixture is a recorded game on a world that keeps a season: a
// snapshot with the garrison's backers at the first settlement carrying
// provisions and the besiegers' beside it; the operator's arc-cast of a
// siege and of a raid on that settlement as the first commands after it;
// every later command by tick; and the digest the game reaches a tick
// after the last, the one the siege's first stage ends on.
type mm9Fixture struct {
	Label     string          `json:"label"`
	Garrison  []string        `json:"garrison"`
	Besiegers []string        `json:"besiegers"`
	Snapshot  json.RawMessage `json:"snapshot"`
	Ticks     int64           `json:"ticks"`
	Commands  []mm8Tick       `json:"commands"`
	Digest    string          `json:"digest"`
}

const (
	mm9File = "testdata/replay-mm9/siege-and-raid.json"
	// The template's sides and the roles a siege and a trouble cast, as
	// story.arcs and story.troubles name them.
	mm9Siege     = "the-siege"
	mm9Raid      = "raid"
	mm9Garrison  = "garrison"
	mm9Besiegers = "besiegers"
	// mm9Guards back the garrison with goods and mm9Fighters the besiegers
	// with beats, all readied at mm9Tier.
	mm9Guards   = 3
	mm9Fighters = 2
	mm9Tier     = 2
	// mm9Carry is the provisions each guard holds at the snapshot, and
	// mm9First what each sends at the cast; the rest goes in once the raid
	// is over.
	mm9Carry = 60
	mm9First = 10
	// mm9Settle is the ticks the world runs before the snapshot, and
	// mm9Days caps the scene in world days.
	mm9Settle = 2
	mm9Days   = 2
	// mm9Search is how far from the settlement the fighters' tile is
	// looked for.
	mm9Search = 10
)

// TestReplayMM9 replays the recorded siege and raid twice from its
// snapshot. Each replay takes every command and reaches the recorded
// digest, and the first shows what the fixture is for.
func TestReplayMM9(t *testing.T) {
	r := testkit.Rules(t, testkit.Book(t), keys.Throwaway("replay-mm9"))
	if *updateMM9 {
		recordMM9(t, r)
	}
	body, err := os.ReadFile(mm9File)
	if err != nil {
		t.Fatal(err)
	}
	var fx mm9Fixture
	if err := json.Unmarshal(body, &fx); err != nil {
		t.Fatal(err)
	}
	before := mm8aSnapshot(t, r, fx.Snapshot)
	if err := mm9Before(before); err != nil {
		t.Fatal(err)
	}
	if day := before.Tick() / sheets.TicksPerDay; (before.Tick()+fx.Ticks)/sheets.TicksPerDay <= day {
		t.Fatalf("the scene never leaves day %d, so the director never runs in it", day)
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
			if err := mm9Shows(g, &fx); err != nil {
				t.Fatal(err)
			}
			audit(t, g)
		}
	}
}

// mm9Before is nil when the snapshot keeps a season and runs no arc yet.
func mm9Before(g *game.Game) error {
	if g.Story == nil || g.Story.Clock == nil {
		return errors.New("the snapshot keeps no season")
	}
	for _, a := range g.Story.Arcs {
		if a.Template == mm9Siege || a.Template == mm9Raid {
			return fmt.Errorf("the snapshot already runs %s", a.ID)
		}
	}
	return nil
}

// mm9Arc is the arc of a template the operator cast.
func mm9Arc(g *game.Game, template string) *game.Arc {
	for _, a := range g.Story.Arcs {
		if a.Template == template && a.By == game.ByOperator {
			return a
		}
	}
	return nil
}

// mm9Side is a side of one of an arc's stages.
func mm9Side(a *game.Arc, stage int, side string) (game.SideRun, bool) {
	if stage >= len(a.Stages) {
		return game.SideRun{}, false
	}
	i := slices.IndexFunc(a.Stages[stage].Sides, func(s game.SideRun) bool { return s.Side == side })
	if i < 0 {
		return game.SideRun{}, false
	}
	return a.Stages[stage].Sides[i], true
}

// mm9Shows is nil when a game shows what the fixture is for: the siege's
// first stage won by the garrison's goods from more than one hand, the
// besiegers' beats counted and paid their share, the walls begun, and the
// raid on the first settlement opened through its hunt and decided.
func mm9Shows(g *game.Game, fx *mm9Fixture) error {
	siege, raid := mm9Arc(g, mm9Siege), mm9Arc(g, mm9Raid)
	if siege == nil || raid == nil {
		return fmt.Errorf("the operator's siege %v and raid %v", siege != nil, raid != nil)
	}
	if siege.Scope != arc.ScopeWorld || siege.Stage != 1 || len(siege.Stages) != 2 || siege.Stages[0].Won != mm9Garrison || siege.Stages[1].Ended != 0 {
		return fmt.Errorf("the siege should have its first stage won by the garrison and the walls running: stage %d of %+v", siege.Stage, siege.Stages)
	}
	garrison, ok := mm9Side(siege, 0, mm9Garrison)
	besiegers, ok2 := mm9Side(siege, 0, mm9Besiegers)
	if !ok || !ok2 {
		return errors.New("the siege's first stage lost a side")
	}
	x, y := g.GoalOf(garrison.Goal), g.GoalOf(besiegers.Goal)
	if x == nil || y == nil || x.State != goal.Done || x.Total() < garrison.Mark {
		return fmt.Errorf("the garrison's goal %+v should be met at %d", x, garrison.Mark)
	}
	if err := mm9Hands(x, fx.Garrison, 2); err != nil {
		return fmt.Errorf("garrison: %w", err)
	}
	if err := mm9Hands(y, fx.Besiegers, 1); err != nil {
		return fmt.Errorf("besiegers: %w", err)
	}
	if y.State != goal.Ended || len(y.Claims) == 0 {
		return fmt.Errorf("the besiegers' unmet side should be paid its share: %s, claims %+v", y.State, y.Claims)
	}
	for _, id := range fx.Besiegers {
		if !slices.ContainsFunc(g.Story.Backers, func(b game.Backing) bool {
			return b.Char == id && b.Arc == siege.ID && b.Stage == 0 && b.Side == mm9Besiegers
		}) {
			return fmt.Errorf("%s never declared for the besiegers", id)
		}
	}
	if raid.Scope != arc.Settlement || raid.Place != goal.SettlementRef(0) || raid.Hunt == "" || raid.Ended == 0 || raid.Outcome == "" {
		return fmt.Errorf("the raid on the first settlement should open its hunt and be decided: %+v", raid)
	}
	kinds := map[string]int{}
	for _, f := range g.Log.Since(0) {
		kinds[f.Kind]++
	}
	if kinds["arc.cast"] == 0 || kinds["trouble.started"] == 0 || kinds["arc.stage-ended"] == 0 || kinds["arc.stage-began"] == 0 ||
		kinds["trouble.held"]+kinds["trouble.lost"] == 0 {
		return fmt.Errorf("the story's facts: %v", kinds)
	}
	return nil
}

// mm9Hands is nil when a side's goal counts at least least contributors,
// every one of them among its backers.
func mm9Hands(x *game.Goal, backers []string, least int) error {
	n := 0
	for _, p := range x.Progress {
		if p.N <= 0 {
			continue
		}
		if !slices.Contains(backers, p.Key) {
			return fmt.Errorf("%s counted for %s, not one of %v", p.Key, x.ID, backers)
		}
		n++
	}
	if n < least {
		return fmt.Errorf("%d hands counted for %s, want %d", n, x.ID, least)
	}
	return nil
}

// recordMM9 plays the scene and writes the fixture.
func recordMM9(t *testing.T, r *game.Rules) {
	t.Helper()
	fx, err := playMM9(t, r)
	if err != nil {
		t.Fatal(err)
	}
	body, err := json.MarshalIndent(fx, "", " ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(mm9File), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(mm9File, append(body, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
}

// mm9Cast is the siege of the first faction holding a region by another,
// seated at the first settlement, and the raid on that settlement.
func mm9Cast(g *game.Game) (arc.Cast, arc.Cast, error) {
	held := -1
	for i, reg := range g.World.Regions {
		if reg.Holder >= 0 && len(g.World.Factions) > 1 {
			held = i
			break
		}
	}
	if held < 0 {
		return nil, nil, errors.New("no faction holds a region for a siege")
	}
	holder := g.World.Regions[held].Holder
	besieger := (holder + 1) % len(g.World.Factions)
	siege := arc.Cast{{Role: "besieger", Ref: arc.FactionRef(besieger)}, {Role: "holder", Ref: arc.FactionRef(holder)},
		{Role: "holding", Ref: arc.HoldingRef(held)}, {Role: "seat", Ref: arc.SettlementRef(0)}}
	home := g.World.RegionAt(g.SettlementHex(0))
	raid := arc.Cast{{Role: "place", Ref: arc.SettlementRef(0)}, {Role: "source", Ref: arc.RegionRef(home)}}
	return siege, raid, nil
}

// mm9Field is the nearest tile to the first settlement, in its region,
// where something lives to fight.
func mm9Field(g *game.Game) (hex.Hex, bool) {
	home := g.SettlementHex(0)
	for d := int64(1); d <= mm9Search; d++ {
		for _, h := range hex.Ring(home, d) {
			if g.World.RegionAt(h) == g.World.RegionAt(home) && g.CanExplore(h) && len(g.Creatures(h)) > 0 {
				return h, true
			}
		}
	}
	return hex.Hex{}, false
}

// playMM9 plays the scene: the operator casts a siege and a raid; the
// guards send provisions to the garrison and press the raid's band; the
// fighters declare for the besiegers and win beats beside the settlement;
// once the raid is decided and the director has had its day, the guards
// meet the garrison's mark.
func playMM9(t *testing.T, r *game.Rules) (*mm9Fixture, error) {
	t.Helper()
	g, err := game.New(r)
	if err != nil {
		return nil, err
	}
	field, ok := mm9Field(g)
	if !ok {
		return nil, errors.New("nothing to fight beside the first settlement")
	}
	create := func(who string) (*game.Char, error) {
		res, err := g.Act(game.Command{Key: "mm9-new-" + who, Kind: game.Create, Option: "knife"})
		if err != nil {
			return nil, err
		}
		harness.Ready(r, res.Char, mm9Tier, mm9Tier)
		return res.Char, nil
	}
	var guards, fighters []*game.Char
	for i := range mm9Guards {
		c, err := create(fmt.Sprintf("guard-%d", i))
		if err != nil {
			return nil, err
		}
		if _, err := g.Act(game.Command{Key: "mm9-give-" + c.C.ID, Char: c.C.ID, Kind: game.Correct, Asset: ledger.Provisions, Units: mm9Carry, Note: "replay-mm9"}); err != nil {
			return nil, err
		}
		guards = append(guards, c)
	}
	for i := range mm9Fighters {
		c, err := create(fmt.Sprintf("fighter-%d", i))
		if err != nil {
			return nil, err
		}
		if err := g.Teleport(c, field); err != nil {
			return nil, err
		}
		fighters = append(fighters, c)
	}
	for range mm9Settle {
		if _, err := g.Advance(); err != nil {
			return nil, err
		}
	}
	siegeCast, raidCast, err := mm9Cast(g)
	if err != nil {
		return nil, err
	}
	snap, err := json.Marshal(g)
	if err != nil {
		return nil, err
	}
	start := g.Tick()
	var given []mm8Tick
	s := &harness.Script{G: g, Clock: mm8Clock, Label: "mm9", Given: func(cmd game.Command) {
		if len(given) == 0 || given[len(given)-1].Tick != g.Tick() {
			given = append(given, mm8Tick{Tick: g.Tick()})
		}
		given[len(given)-1].Commands = append(given[len(given)-1].Commands, cmd)
	}}
	must := func(c *game.Char, cmd game.Command) error {
		if _, ok := s.Act(c, cmd); !ok {
			return errors.Join(s.Err(), fmt.Errorf("%s was refused", cmd.Kind))
		}
		return nil
	}
	advance := func() error {
		if err := s.Err(); err != nil {
			return err
		}
		if _, err := g.Advance(); err != nil {
			return err
		}
		s.Clock = max(s.Clock, mm8Clock+(g.Tick()-start)*mm8TickMs)
		return nil
	}
	for _, c := range []game.ArcCmd{{Template: mm9Siege, Cast: siegeCast}, {Template: mm9Raid, Cast: raidCast}} {
		if err := must(nil, game.Command{Kind: game.ArcCast, Arc: &c}); err != nil {
			return nil, err
		}
	}
	siege, raid := mm9Arc(g, mm9Siege), mm9Arc(g, mm9Raid)
	garrison, _ := mm9Side(siege, 0, mm9Garrison)
	besiegers, _ := mm9Side(siege, 0, mm9Besiegers)
	if mm9Guards*mm9Carry < garrison.Mark {
		return nil, fmt.Errorf("the guards carry %d provisions for a mark of %d", mm9Guards*mm9Carry, garrison.Mark)
	}
	for _, c := range fighters {
		if err := must(c, game.Command{Kind: game.BackSide, Target: besiegers.Goal}); err != nil {
			return nil, err
		}
	}
	for _, c := range guards {
		if err := must(c, game.Command{Kind: game.BackSide, Target: garrison.Goal, Asset: ledger.Provisions, Units: mm9First}); err != nil {
			return nil, err
		}
	}
	y := g.GoalOf(besiegers.Goal)
	beaten := func() bool {
		return !slices.ContainsFunc(fighters, func(c *game.Char) bool { return y.Progress.Get(c.C.ID) == 0 || c.Fight != nil })
	}
	turn := (start/sheets.TicksPerDay + 1) * sheets.TicksPerDay
	for raid.Outcome == "" || !beaten() || g.Tick() <= turn {
		if g.Tick()-start > mm9Days*sheets.TicksPerDay {
			return nil, fmt.Errorf("in %d days the raid was decided: %q, and every fighter counted a beat: %v", mm9Days, raid.Outcome, beaten())
		}
		for _, c := range fighters {
			if y.Progress.Get(c.C.ID) == 0 || c.Fight != nil || game.IsDown(c) {
				mm9Fight(s, c)
			}
		}
		for _, c := range guards {
			if raid.Outcome == "" {
				mm9Guard(s, c, raid.Hunt)
			}
		}
		if err := advance(); err != nil {
			return nil, err
		}
	}
	x := g.GoalOf(garrison.Goal)
	for _, c := range guards {
		if n := min(x.Left(c.C.ID), mm9Carry-mm9First); n > 0 && x.State == goal.Live {
			if err := must(c, game.Command{Kind: game.BackSide, Target: garrison.Goal, Asset: ledger.Provisions, Units: n}); err != nil {
				return nil, err
			}
		}
	}
	if err := advance(); err != nil {
		return nil, err
	}
	d, err := g.Digest()
	if err != nil {
		return nil, err
	}
	fx := &mm9Fixture{Label: "replay-mm9", Snapshot: snap, Ticks: g.Tick() - start, Commands: given, Digest: d.String()}
	for _, c := range guards {
		fx.Garrison = append(fx.Garrison, c.C.ID)
	}
	for _, c := range fighters {
		fx.Besiegers = append(fx.Besiegers, c.C.ID)
	}
	if err := mm9Shows(g, fx); err != nil {
		return nil, err
	}
	if bad := ledger.Audit(g.Ledger.Balances(), g.Holdings()); len(bad) > 0 {
		return nil, fmt.Errorf("audit: %v", bad)
	}
	return fx, nil
}

// mm9Fight gives a fighter one turn: crawl when down, press on the beat,
// or explore the tile it stands on.
func mm9Fight(s *harness.Script, c *game.Char) {
	switch {
	case game.IsDown(c):
		if c.Long == nil && c.Fight == nil {
			s.Act(c, game.Command{Kind: game.Crawl})
		}
	case c.Fight != nil:
		if v := s.G.Choose(c).Fight; v != nil {
			s.Act(c, game.Command{Kind: game.Press, Option: harness.Pick(v.Options, v.Beat == v.Beats-1)})
		}
	case c.Long == nil && s.G.CanExplore(c.C.At):
		s.Act(c, game.Command{Kind: game.Explore})
	}
}

// mm9Guard gives a guard one turn at the raid's band: crawl when down,
// else press it while it is in reach. Guards never leave the settlement
// the garrison's goods are brought to.
func mm9Guard(s *harness.Script, c *game.Char, hunt string) {
	if game.IsDown(c) {
		if c.Long == nil && c.Fight == nil {
			s.Act(c, game.Command{Kind: game.Crawl})
		}
		return
	}
	i := slices.IndexFunc(s.G.Hunts, func(x *game.Hunt) bool { return x.H.ID == hunt })
	if i < 0 || c.Long != nil || c.Fight != nil {
		return
	}
	x := s.G.Hunts[i]
	if x.H.Over || !game.InReach(c, x) {
		return
	}
	_, opts := s.G.HuntOptions(c, x)
	s.Act(c, game.Command{Kind: game.HuntPress, Target: x.H.ID, Option: harness.Pick(opts, false)})
}
