package game_test

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

var updateMM8 = flag.Bool("update-mm8", false, "record testdata/replay-mm8 again")

// mm8Fixture is a recorded game: a snapshot with a party of four at a
// dungeon's entrance and ten hunters beside the first settlement, every
// command given after it by tick, and the digest the game reaches a tick
// after the last.
type mm8Fixture struct {
	Label    string          `json:"label"`
	Dungeon  hex.Hex         `json:"dungeon"`
	Snapshot json.RawMessage `json:"snapshot"`
	Ticks    int64           `json:"ticks"`
	Commands []mm8Tick       `json:"commands"`
	Digest   string          `json:"digest"`
}

type mm8Tick struct {
	Tick     int64          `json:"tick"`
	Commands []game.Command `json:"commands"`
}

const (
	mm8File = "testdata/replay-mm8/party-and-hunt.json"
	// mm8Hunt is a tier-1 hunt ten knives bring down inside its window.
	mm8Hunt = "dust-runner-migration"
	// mm8Clock is the service's clock at the snapshot, and mm8TickMs the
	// time a tick stands for; a command's Now is read off them.
	mm8Clock  = 1_700_000_000_000
	mm8TickMs = 30_000
	// mm8Name is what the first slayers call the dungeon.
	mm8Name = "The Long Stair"
	// The recorder tries the mm8Search nearest dungeons within mm8Radius
	// of the first settlement for one the party reaches the bottom of,
	// playing each for at most mm8Days world days.
	mm8Search = 80
	mm8Radius = 60
	mm8Days   = 3
	// mm8Hunters press the hunt: mm8Green of them beside it from the
	// start, at the hunt's own tier, and the rest veterans of
	// mm8VeteranTier who walk in from mm8Walk tiles off and bring it down.
	mm8Hunters     = 10
	mm8Green       = 7
	mm8VeteranTier = 3
	mm8Walk        = 2
)

// TestReplayMM8 replays the recorded party and hunt twice from its
// snapshot: each replay takes every command, reaches the recorded digest,
// and shows what the fixture is for.
func TestReplayMM8(t *testing.T) {
	r := testkit.Rules(t, testkit.Book(t), keys.Throwaway("replay-mm8"))
	if *updateMM8 {
		recordMM8(t, r)
	}
	body, err := os.ReadFile(mm8File)
	if err != nil {
		t.Fatal(err)
	}
	var fx mm8Fixture
	if err := json.Unmarshal(body, &fx); err != nil {
		t.Fatal(err)
	}
	for run := range 2 {
		g := replayMM8(t, r, &fx)
		got, err := g.Digest()
		if err != nil {
			t.Fatal(err)
		}
		if got.String() != fx.Digest {
			t.Fatalf("replay %d reaches %s, recorded %s", run+1, got, fx.Digest)
		}
		if run == 0 {
			if err := mm8Shows(g, fx.Dungeon); err != nil {
				t.Fatal(err)
			}
		}
	}
}

// replayMM8 is a game from the fixture's snapshot given every command at
// its tick, a tick past the last.
func replayMM8(t *testing.T, r *game.Rules, fx *mm8Fixture) *game.Game {
	t.Helper()
	var g game.Game
	if err := json.Unmarshal(fx.Snapshot, &g); err != nil {
		t.Fatal(err)
	}
	g.Attach(r)
	at := 0
	for range fx.Ticks {
		if at < len(fx.Commands) && fx.Commands[at].Tick == g.Tick() {
			for _, cmd := range fx.Commands[at].Commands {
				if _, err := g.Act(cmd); err != nil {
					t.Fatalf("tick %d: %s %s: %v", g.Tick(), cmd.Char, cmd.Kind, err)
				}
			}
			at++
		}
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if at != len(fx.Commands) {
		t.Fatalf("%d recorded ticks of commands never came due", len(fx.Commands)-at)
	}
	return &g
}

// mm8Shows is nil when a game shows what the fixture is for: four
// through every floor of the dungeon with machines worked by several
// hands, and ten pressers whose parts sum to the roll.
func mm8Shows(g *game.Game, h hex.Hex) error {
	plan, _ := g.Plan(h)
	bottom, machines, pressers := false, 0, map[string]bool{}
	var slain []fact.Fact
	for _, f := range g.Log.Since(0) {
		switch f.Kind {
		case "dungeon.floor-cleared":
			if d, ok := f.Get("floor"); ok && d.N == plan.Floors {
				bottom = true
			}
		case "machine.armed":
			if d, ok := f.Get("seats"); ok && d.N > 1 {
				machines++
			}
		case "hunt.pressed":
			pressers[f.Subjects[0].ID] = true
		case "hunt.slain":
			slain = append(slain, f)
		}
	}
	if !bottom || machines == 0 {
		return fmt.Errorf("the party cleared the bottom of %d floors: %v, and worked %d machines together", plan.Floors, bottom, machines)
	}
	if len(pressers) != mm8Hunters || len(slain) != 1 {
		return fmt.Errorf("%d pressed the hunt, %d slew it", len(pressers), len(slain))
	}
	// The roll is minted into the hunt's pool and paid out of it whole,
	// so the parts sum to it.
	id, _ := slain[0].Get("hunt")
	rolled := 0
	for _, d := range slain[0].Data {
		mat, ok := strings.CutPrefix(d.Key, "rolled:")
		if !ok {
			continue
		}
		rolled++
		left, minted := g.Ledger.Of(ledger.HuntPool(id.S), ledger.Material(mat)), -g.Ledger.Of(ledger.FromHunt, ledger.Material(mat))
		if left != 0 || minted < d.N {
			return fmt.Errorf("%s: a roll of %d, %d minted, %d left unpaid", mat, d.N, minted, left)
		}
	}
	if rolled == 0 {
		return errors.New("the slain hunt rolled nothing")
	}
	return nil
}

// recordMM8 plays the scene at the nearest dungeon the party gets to the
// bottom of, and writes the fixture.
func recordMM8(t *testing.T, r *game.Rules) {
	t.Helper()
	probe, err := game.New(r)
	if err != nil {
		t.Fatal(err)
	}
	ds := harness.Dungeons(probe, probe.SettlementHex(0), mm8Radius, 3)
	for _, h := range ds[:min(len(ds), mm8Search)] {
		fx, ok := playMM8(t, r, h)
		if !ok {
			continue
		}
		body, err := json.MarshalIndent(fx, "", " ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Dir(mm8File), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(mm8File, append(body, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	t.Fatal("no dungeon near the first settlement that the party got to the bottom of")
}

// playMM8 plays the scene at one dungeon: a party of four set a tier
// above the bottom floor's, through the game's own commands, and ten
// hunters at a hunt beside the first settlement. False when the game does
// not show what the fixture is for.
func playMM8(t *testing.T, r *game.Rules, h hex.Hex) (*mm8Fixture, bool) {
	t.Helper()
	g, err := game.New(r)
	if err != nil {
		t.Fatal(err)
	}
	create := func(who string) *game.Char {
		res, err := g.Act(game.Command{Key: "mm8-new-" + who, Kind: game.Create, Option: "knife"})
		if err != nil {
			t.Fatal(err)
		}
		return res.Char
	}
	plan, _ := r.Gen.Dungeon(h)
	ready := min(int64(len(r.Book.FightTiers)), plan.SeedTier+(plan.Floors-1)/2+1)
	var given []mm8Tick
	s := &harness.Script{G: g, Clock: mm8Clock, Name: mm8Name, Label: "mm8", Given: func(cmd game.Command) {
		if len(given) == 0 || given[len(given)-1].Tick != g.Tick() {
			given = append(given, mm8Tick{Tick: g.Tick()})
		}
		given[len(given)-1].Commands = append(given[len(given)-1].Commands, cmd)
	}}
	for i := range 4 {
		c := create(fmt.Sprintf("delver-%d", i))
		c.C.At = h
		harness.Ready(r, c, ready, ready)
		s.Party = append(s.Party, c)
	}
	beside, ok := harness.Beside(g, g.SettlementHex(0))
	if !ok {
		t.Fatal("no land beside the first settlement")
	}
	var far []hex.Hex
	for _, n := range hex.Ring(beside, mm8Walk) {
		if r.Gen.Passable(r.Gen.Baseline(n).Terrain) && g.World.RegionAt(n) >= 0 {
			far = append(far, n)
		}
	}
	for i := range mm8Hunters {
		c := create(fmt.Sprintf("hunter-%d", i))
		c.C.At = beside
		tier := int64(1)
		if i >= mm8Green {
			tier, c.C.At = mm8VeteranTier, far[(i-mm8Green)%len(far)]
		}
		harness.Ready(r, c, tier, tier)
		s.Hunters = append(s.Hunters, c)
	}
	snap, err := json.Marshal(g)
	if err != nil {
		t.Fatal(err)
	}
	start := g.Tick()
	for _, c := range s.Party[1:] {
		s.Act(s.Party[0], game.Command{Kind: game.PartyInvite, Target: c.C.ID})
		s.Act(c, game.Command{Kind: game.PartyJoin, Target: s.Party[0].C.ID})
	}
	s.Act(nil, game.Command{Kind: game.HuntStart, Asset: mm8Hunt, To: &beside})
	out := func() bool {
		for _, c := range s.Party {
			if c.C.Floor > 0 || c.Fight != nil || c.Long != nil {
				return false
			}
		}
		return len(g.LiveHunts()) == 0
	}
	for !out() && g.Tick()-start < mm8Days*sheets.TicksPerDay {
		s.Delve()
		s.Hunt()
		if err := s.Err(); err != nil {
			t.Fatal(err)
		}
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
		s.Clock = max(s.Clock, mm8Clock+(g.Tick()-start)*mm8TickMs)
	}
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
	if err := mm8Shows(g, h); err != nil {
		t.Logf("%s (%s, %d floors): %v", h.Ref(), plan.Kind, plan.Floors, err)
		return nil, false
	}
	d, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	return &mm8Fixture{Label: "replay-mm8", Dungeon: h, Snapshot: snap, Ticks: g.Tick() - start, Commands: given, Digest: d.String()}, true
}
