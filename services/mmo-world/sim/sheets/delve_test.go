package sheets_test

import (
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/sheets"
)

func live(t *testing.T) *sheets.Book {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// The dungeon sheets hold four kinds, each with its forks, a creature at
// every tier and one guardian (GDD 4.9).
func TestDungeonSheets(t *testing.T) {
	b := live(t)
	if len(b.Dungeons) != 4 || len(b.Forks) < 12 || len(b.Depths) != 3 {
		t.Fatalf("%d kinds, %d forks, %d depths", len(b.Dungeons), len(b.Forks), len(b.Depths))
	}
	creatures := sheets.Lookup(b.Creatures)
	for _, k := range b.Dungeons {
		g, ok := sheets.GuardianOf(b.Hunts, k.ID)
		if !ok || len(g.Marks) == 0 || g.Family == "" {
			t.Errorf("%s: guardian %+v", k.ID, g)
		}
		for _, ft := range b.FightTiers {
			if !slices.ContainsFunc(k.Creatures, func(c string) bool { return creatures[c].Tier == ft.Tier }) {
				t.Errorf("%s: no creature at tier %d", k.ID, ft.Tier)
			}
		}
		if k.FloorsMin < 3 || k.FloorsMax > 7 {
			t.Errorf("%s: %d to %d floors", k.ID, k.FloorsMin, k.FloorsMax)
		}
	}
	relay := slices.IndexFunc(b.Dungeons, func(k sheets.DungeonKind) bool { return k.ID == "relay-tower" })
	if relay < 0 || b.Dungeons[relay].Place != "relay" || !b.Dungeons[relay].Up {
		t.Fatalf("relay-tower is not the relay places' kind")
	}
	for _, tier := range []int64{1, 2, 3, 4, 9} {
		d, ok := sheets.DepthAt(b.Depths, tier)
		if !ok || d.Tier != min(tier, 3) {
			t.Fatalf("tier %d reads depth %+v", tier, d)
		}
		if d.Weights[0].Floors != 3 || d.Weights[len(d.Weights)-1].Floors != 7 {
			t.Fatalf("%s: floors %+v", d.ID, d.Weights)
		}
	}
	if _, ok := sheets.DepthAt(b.Depths, 0); ok {
		t.Fatalf("tier 0 found a depth")
	}
	for _, h := range b.Hunts {
		switch h.ID {
		case "walking-factory":
			if h.SpawnChance != 10 || h.SpawnLine != 60 {
				t.Errorf("%s: %d/%d", h.ID, h.SpawnChance, h.SpawnLine)
			}
		case "dust-runner-migration":
			if h.SpawnChance != 15 || h.SpawnLine != 60 {
				t.Errorf("%s: %d/%d", h.ID, h.SpawnChance, h.SpawnLine)
			}
		}
	}
	for _, ft := range b.FightTiers {
		if len(ft.Haul) == 0 {
			t.Errorf("%s holds no haul material", ft.ID)
		}
	}
}

// Every family has a shape 0 and a shape 1 from level 3, and a party
// version; the party rows agree with the cells that name their sizes.
func TestPuzzleSheets(t *testing.T) {
	b := live(t)
	if len(b.PartyVersions) != 16 || len(b.PuzzleShapes) != 28 {
		t.Fatalf("%d party versions, %d shapes", len(b.PartyVersions), len(b.PuzzleShapes))
	}
	for _, f := range b.PuzzleFamilies {
		var shapes []int64
		for _, s := range b.PuzzleShapes {
			if s.Family == f.ID {
				shapes = append(shapes, s.Shape)
				if s.Shape == 1 && s.MinLevel != 3 {
					t.Errorf("%s: shape 1 from level %d", s.ID, s.MinLevel)
				}
			}
		}
		if !slices.Equal(shapes, []int64{0, 1}) {
			t.Errorf("%s: shapes %v", f.ID, shapes)
		}
		if !slices.ContainsFunc(b.PartyVersions, func(v sheets.PartyVersion) bool { return v.Family == f.ID && v.Weight > 0 }) {
			t.Errorf("%s: no party version", f.ID)
		}
	}
	versions := sheets.Lookup(b.PartyVersions)
	for id, cell := range map[string]string{"two-hand-lock": "two-hand-window", "relay-chain": "relay-chain-window"} {
		if got, want := versions[id].Window, sheets.IntParam(b.PuzzleParams, cell)*1000; got != want {
			t.Errorf("%s: window %d ms, %s %d ms", id, got, cell, want)
		}
	}
	if versions["big-rewire"].Size != sheets.IntParam(b.PuzzleParams, "big-rewire-wires") {
		t.Errorf("big-rewire's size is not big-rewire-wires")
	}
	if versions["competing"].Weight != 0 || versions["competing"].Family != "" {
		t.Errorf("competing is drawn or tied to a family")
	}
}

// The delve cells read as the design gives them.
func TestDelveCells(t *testing.T) {
	b := live(t)
	if got := sheets.ChoiceParam(b.FightParams, "fork-default"); got != "leave" {
		t.Fatalf("fork-default is %q", got)
	}
	for sheet, cells := range map[string]map[string]int64{
		"fights": {"party-size-max": 4, "party-invite-ticks": 6, "key-cost": 3, "deep-breath-floor": 4, "guardian-solve-bonus": 50},
		"map":    {"floor-beats-min": 3, "floor-beats-max": 6, "fork-machine-share": 50, "fork-machine-haul": 25},
		"tiles":  {"haunted-falls": 5, "haunted-days": 14, "floor-find-chance": 40},
	} {
		rows := map[string][]sheets.Param{"fights": b.FightParams, "map": b.MapParams, "tiles": b.TileParams}[sheet]
		for id, want := range cells {
			if got := sheets.IntParam(rows, id); got != want {
				t.Errorf("%s.params %s is %d, want %d", sheet, id, got, want)
			}
		}
	}
	triggers := sheets.Lookup(b.Triggers)
	if triggers["old-friends"].On != "party" || triggers["the-key"].On != "fork" {
		t.Fatalf("old-friends on %q, the-key on %q", triggers["old-friends"].On, triggers["the-key"].On)
	}
}

// Load refuses a book whose delve sheets do not hang together.
func TestDelveProblems(t *testing.T) {
	files, err := sheetfs.ReadSheetFiles(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct{ path, old, new, want string }{
		{"sheets/fights/hunts.json", `"kind": "bunker",`, ``, "map.dungeons bunker: no fights.hunts row guards it"},
		{"sheets/map/dungeons.json", `"share": 40,`, `"share": 41,`, "the dungeon kinds' shares do not sum to 100"},
		{"sheets/fights/params.json", `"choices": [`, `"choices": [ "stay",`, ""},
		{"sheets/fights/params.json", `"value": 0,
      "unit": "count",
      "choices"`, `"value": 2,
      "unit": "count",
      "choices"`, "fork-default: the value indexes none of its choices"},
		{"sheets/puzzles/shapes.json", `"shape": 0,`, `"shape": 1,`, "a second row for its family's shape"},
		{"sheets/fights/hunts.json", `"marks": [
        75,`, `"marks": [
        25,`, "marks fall from under 100 to over 0"},
	} {
		mutated := slices.Clone(files)
		found := false
		for i, f := range mutated {
			if f.Path == c.path && strings.Contains(string(f.Data), c.old) {
				mutated[i].Data = []byte(strings.Replace(string(f.Data), c.old, c.new, 1))
				found = true
			}
		}
		if !found {
			t.Fatalf("%s holds no %q", c.path, c.old)
		}
		_, err := sheets.Load(mutated)
		switch {
		case c.want == "" && err != nil:
			t.Errorf("%s: %v", c.new, err)
		case c.want != "" && (err == nil || !strings.Contains(err.Error(), c.want)):
			t.Errorf("want %q, got %v", c.want, err)
		}
	}
}

func TestChoiceParam(t *testing.T) {
	rows := []sheets.Param{{ID: "x", Value: fixed.FromInt(1), Unit: "count", Choices: []string{"a", "b"}}}
	if got := sheets.ChoiceParam(rows, "x"); got != "b" {
		t.Fatalf("got %q", got)
	}
	defer func() {
		if recover() == nil {
			t.Fatal("an index past the choices did not panic")
		}
	}()
	rows[0].Value = fixed.FromInt(2)
	sheets.ChoiceParam(rows, "x")
}
