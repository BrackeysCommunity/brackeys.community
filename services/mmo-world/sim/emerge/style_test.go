package emerge

import (
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

func styleBook() *sheets.Book {
	return &sheets.Book{
		Pairings: []sheets.Pairing{{ID: "edge-and-ember", TagA: "keen", TagB: "warm", Tag: "edge-and-ember"}},
		Traits:   []sheets.Trait{{ID: "keen", Tag: "keen"}, {ID: "braced", Tag: "braced-grip"}, {ID: "warm", Tag: "warm"}},
		Vocabulary: []sheets.Vocab{
			{ID: "metal", Kind: "substance"}, {ID: "hide", Kind: "substance"}, {ID: "light", Kind: "property"},
		},
	}
}

func TestStyleOfEachKeystone(t *testing.T) {
	s := NewStyleBook(styleBook())
	tg := func(ts ...string) []tags.Tag {
		out := make([]tags.Tag, len(ts))
		for i, x := range ts {
			out[i] = tags.Tag(x)
		}
		return out
	}
	for _, c := range []struct {
		name               string
		axis               string
		option, gear       []tags.Tag
		id, lead, resisted string
		ok                 bool
	}{
		{"pairing", "edge", tg("edge-led", "edge-and-ember"), tg("metal", "keen", "warm"), "edge-and-ember", "edge", "keen", true},
		{"trait in items.traits order", "heat", tg("heat-led"), tg("metal", "warm", "keen"), "heat+keen", "heat", "keen", true},
		{"trait over substance", "ward", tg("ward-led"), tg("hide", "braced-grip"), "ward+braced-grip", "ward", "braced-grip", true},
		{"substance", "weight", tg("weight-led"), tg("light", "metal", "hide"), "weight+metal", "weight", "metal", true},
		{"none", "reach", tg("reach-led"), tg("light"), "", "", "", false},
		{"no axis", "", tg("edge-and-ember"), tg("metal"), "", "", "", false},
	} {
		id, lead, res, ok := s.StyleOf(c.axis, c.option, c.gear)
		if id != c.id || lead != c.lead || res != c.resisted || ok != c.ok {
			t.Errorf("%s: %q %q %q %v, want %q %q %q %v", c.name, id, lead, res, ok, c.id, c.lead, c.resisted, c.ok)
		}
	}
	if k, pair := s.Keystone("edge-and-ember"); k != "edge-and-ember" || !pair {
		t.Errorf("pairing keystone: %q %v", k, pair)
	}
	if k, pair := s.Keystone("edge+keen"); k != "keen" || pair {
		t.Errorf("trait keystone: %q %v", k, pair)
	}
}

var testParams = Params{AdaptRate: 12, AdaptFade: 3, AdaptFloor: 20, ResistAt: 30, ResistBands: 1, VariantResistBands: 2}

func TestAdaptedReachesSixtyAndFades(t *testing.T) {
	a, days := int64(0), 0
	for a < 60 {
		a = Adapted(a, 70, testParams)
		days++
	}
	if days < 7 || days > 8 {
		t.Errorf("a 70%% share reached %d in %d days, want 60 in about 7", a, days)
	}
	for range 30 {
		a = Adapted(a, 100, testParams)
	}
	if a != 100 {
		t.Errorf("held at 100: %d", a)
	}
	if got := Adapted(50, 19, testParams); got != 47 {
		t.Errorf("under the floor: %d, want 47", got)
	}
	if got := Adapted(50, 0, testParams); got != 47 {
		t.Errorf("no wins: %d, want 47", got)
	}
	if got := Adapted(2, 0, testParams); got != 0 {
		t.Errorf("held at 0: %d", got)
	}
	if got := Adapted(50, 20, testParams); got != 52 {
		t.Errorf("at the floor rises: %d, want 52", got)
	}
}

func TestBands(t *testing.T) {
	for _, c := range []struct {
		adapt   int64
		variant bool
		want    int64
	}{{29, false, 0}, {30, false, 1}, {100, false, 1}, {0, true, 2}, {60, true, 2}} {
		if got := Bands(c.adapt, c.variant, testParams); got != c.want {
			t.Errorf("Bands(%d, %v) = %d, want %d", c.adapt, c.variant, got, c.want)
		}
	}
}

func TestCandidates(t *testing.T) {
	rows := []sheets.Adaptation{
		{ID: "plated", Resists: []string{"keen", "edge-led", "hooked"}},
		{ID: "rusted", Resists: []string{"metal", "heavy", "weight-led"}},
		{ID: "shod", Resists: []string{"keen"}},
	}
	if got := Candidates("keen", "edge", rows); !slices.Equal(got, []string{"plated", "shod"}) {
		t.Errorf("keen: %v", got)
	}
	if got := Candidates("timber", "weight", rows); !slices.Equal(got, []string{"rusted"}) {
		t.Errorf("the lead's tag when none resists the keystone: %v", got)
	}
	if got := Candidates("timber", "bond", rows); got != nil {
		t.Errorf("none: %v", got)
	}
}

var axes = []string{"edge", "weight", "flex", "conduct", "heat", "ward", "reach", "bond"}

// GDD 9.3: the wire-eel's treated hide becomes plated hide.
func TestDerivePlatedHide(t *testing.T) {
	hide := sheets.Material{ID: "stalker-hide", Tier: 1, Tags: []string{"hide"}, Vector: sheets.Vector{Flex: 18, Ward: 26}}
	plated := sheets.Adaptation{ID: "plated", Resists: []string{"keen"}, Up: "ward", UpPercent: 200, Down: "flex", DownPoints: 2}
	for _, c := range []struct {
		name    string
		base    sheets.Material
		step    int64
		maxTier int64
		want    sheets.Material
	}{
		{"treated hide", hide, 1, 4, sheets.Material{ID: "found.plated.stalker-hide", Tier: 2, Tags: []string{"hide", "plated"}, Vector: sheets.Vector{Flex: 16, Ward: 52}}},
		{"capped tier", sheets.Material{ID: "x", Tier: 4, Tags: []string{"metal"}, Vector: sheets.Vector{Edge: 9, Flex: 1, Ward: 3}}, 1, 4,
			sheets.Material{ID: "found.plated.x", Tier: 4, Tags: []string{"metal", "plated"}, Vector: sheets.Vector{Edge: 9, Ward: 6}}},
	} {
		got := Derive(c.base, plated, axes, c.step, c.maxTier)
		if got.ID != c.want.ID || got.Tier != c.want.Tier || got.Vector != c.want.Vector || !slices.Equal(got.Tags, c.want.Tags) {
			t.Errorf("%s: %+v, want %+v", c.name, got, c.want)
		}
	}
	if !slices.Equal(hide.Tags, []string{"hide"}) {
		t.Errorf("the base's tags changed: %v", hide.Tags)
	}
}

func TestCompileShippedBook(t *testing.T) {
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	r, err := Compile(b)
	if err != nil {
		t.Fatal(err)
	}
	if r.P.KeepDays != 15 || r.P.RoadPatrolRisk != -1 || r.P.MastersEase != 1 {
		t.Errorf("params: %+v", r.P)
	}
	listed := []string{}
	for _, p := range b.EmergenceParams {
		listed = append(listed, p.ID)
	}
	slices.Sort(listed)
	read := slices.Sorted(slices.Values(ParamIDs()))
	if !slices.Equal(read, listed) {
		t.Errorf("params read %v, the sheet lists %v", read, listed)
	}
	if l := r.Lines["road"]; l.Count != 60 || l.Distinct != 20 || l.WindowDays != 9 || l.Trace != Passage {
		t.Errorf("road line: %+v", l)
	}
	if l := r.Lines["style"]; l.PerCharacter != 10 || l.Distinct != 20 || l.WindowDays != 14 {
		t.Errorf("style line: %+v", l)
	}
	var hide sheets.Material
	for _, m := range b.Materials {
		if m.ID == "stalker-hide" {
			hide = m
		}
	}
	got, ok := r.Found(hide, "plated")
	if !ok || got.Tier != 2 || got.Vector.Ward != 52 || got.Vector.Flex != 16 {
		t.Errorf("plated hide from the shipped sheets: %+v", got)
	}
	if !slices.Equal(r.Axes, axes) {
		t.Errorf("axes: %v", r.Axes)
	}
}

func TestCompileRefusesMissingCells(t *testing.T) {
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	b.EmergenceParams = slices.DeleteFunc(slices.Clone(b.EmergenceParams), func(p sheets.Param) bool { return p.ID == "adapt-rate" })
	b.Promotions = slices.DeleteFunc(slices.Clone(b.Promotions), func(p sheets.PromotionRow) bool { return p.ID == "route" })
	_, err = Compile(b)
	if err == nil {
		t.Fatal("compiled with a missing param and line")
	}
	if !strings.Contains(err.Error(), "emergence.params: no adapt-rate") {
		t.Errorf("the missing param is not named: %v", err)
	}
}

// TestMaterialIDRoundTrip: a found material's id parses back to its row and
// base, and an id that is not one does not parse.
func TestMaterialIDRoundTrip(t *testing.T) {
	id := MaterialID("ember-hardened", "iron.ore")
	if row, base, ok := ParseMaterialID(id); !ok || row != "ember-hardened" || base != "iron.ore" {
		t.Fatalf("%q parsed to %q %q %v", id, row, base, ok)
	}
	for _, bad := range []string{"iron", "found.", "found.row", "found..iron", "found.row.", "lost.row.iron"} {
		if _, _, ok := ParseMaterialID(bad); ok {
			t.Errorf("%q parsed as a found material", bad)
		}
	}
}
