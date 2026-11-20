package class

import (
	"testing"

	"jams.team/mmo-world/sim/sheets"
)

type char struct {
	levels, deeds, crafts map[string]int64
}

func (c char) Level(s string) int64  { return c.levels[s] }
func (c char) Deed(s string) int64   { return c.deeds[s] }
func (c char) Crafts(s string) int64 { return c.crafts[s] }

var p = Params{Active: 2, TierLevels: 5, Practice: [levelSteps]int64{12, 16, 20}}

var warden = sheets.Class{ID: "warden", Skill: "fight", Tag: "warden",
	Unlock: []sheets.Requirement{{Kind: "practice", ID: "fight", At: 8}, {Kind: "deed", ID: "hold-won", At: 40}}}

var tree = []sheets.Ability{{ID: "hold-fast", Class: "warden", Tier: 1}, {ID: "shield", Class: "warden", Tier: 1}, {ID: "braced", Class: "warden", Tier: 5}}

// TestUnlockNeedsEveryThreshold.
func TestUnlockNeedsEveryThreshold(t *testing.T) {
	c := char{levels: map[string]int64{"fight": 8}, deeds: map[string]int64{"hold-won": 39}}
	if Unlocked(&warden, c) {
		t.Fatal("unlocked a hold short")
	}
	c.deeds["hold-won"] = 40
	if !Unlocked(&warden, c) {
		t.Fatal("not unlocked at both thresholds")
	}
}

// TestLevelFollowsTheSkill: 1 at unlock, 5 at 12, 10 at 16, 15 at 20.
func TestLevelFollowsTheSkill(t *testing.T) {
	for fight, want := range map[int64]int64{8: 1, 10: 3, 12: 5, 14: 7, 16: 10, 20: 15} {
		if got := Level(&warden, char{levels: map[string]int64{"fight": fight}}, p); got != want {
			t.Errorf("fight %d: level %d, want %d", fight, got, want)
		}
	}
}

// TestTwoActiveAndOnePerTier; abilities of an inactive class are kept
// but give no tag.
func TestTwoActiveAndOnePerTier(t *testing.T) {
	s := State{Earned: []Earned{{ID: "warden"}, {ID: "smith"}, {ID: "reeve"}}}
	for _, id := range []string{"warden", "smith", "reeve"} {
		if err := s.Choose(id, p); err != nil {
			t.Fatal(err)
		}
	}
	if len(s.Active) != 2 || s.Active[0] != "smith" {
		t.Fatalf("active %v", s.Active)
	}
	if s.Take(&tree[0], 1, tree, p) == nil {
		t.Fatal("took from an inactive class")
	}
	choose := func(id string) {
		t.Helper()
		if err := s.Choose(id, p); err != nil {
			t.Fatal(err)
		}
	}
	choose("warden")
	if err := s.Take(&tree[0], 1, tree, p); err != nil {
		t.Fatal(err)
	}
	if s.Take(&tree[1], 1, tree, p) == nil || s.Take(&tree[2], 4, tree, p) == nil {
		t.Fatal("took a second ability from one tier, or from a closed tier")
	}
	classes := []sheets.Class{warden}
	if tags := s.Tags(classes, tree); len(tags) != 2 {
		t.Fatalf("tags %v", tags)
	}
	choose("smith")
	choose("reeve")
	if tags := s.Tags(classes, tree); len(tags) != 0 || len(s.Abilities) != 1 {
		t.Fatalf("an inactive class still gave %v", tags)
	}
}
