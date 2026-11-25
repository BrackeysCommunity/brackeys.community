package game

import (
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
)

// nilEmergenceDigest is the digest testdata/pre-mm9 reaches without
// emergence after a season-start, an operator's grant and play through its
// season's close and one day on.
const nilEmergenceDigest = "c70e2ce9523092fddcdc8f1b9dbb103ba76debc68dae2d574d2334a1c6d6c2be"

// loadPreMM9 is testdata/pre-mm9 attached to its rules, and the digest it
// was saved at.
func loadPreMM9(t *testing.T) (*Game, string) {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	r, err := NewRules(b, keys.Throwaway("pre-mm9"))
	if err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile("testdata/pre-mm9/snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	saved, err := os.ReadFile("testdata/pre-mm9/digest.txt")
	if err != nil {
		t.Fatal(err)
	}
	var g Game
	if err := json.Unmarshal(body, &g); err != nil {
		t.Fatal(err)
	}
	g.Attach(r)
	return &g, strings.TrimSpace(string(saved))
}

// reload is g saved and loaded again, as a store does.
func reload(t *testing.T, g *Game) *Game {
	t.Helper()
	body, err := json.Marshal(g)
	if err != nil {
		t.Fatal(err)
	}
	var back Game
	if err := json.Unmarshal(body, &back); err != nil {
		t.Fatal(err)
	}
	back.Attach(g.r)
	return &back
}

// A world from before emergence loads without it, and plays a season's
// close and a day on to the digest it reached before emergence existed:
// no emergence rule runs, no draw is taken, nothing is stamped.
func TestEmergenceNilIsMM9(t *testing.T) {
	g, saved := loadPreMM9(t)
	if d := digestOf(t, g); d.String() != saved {
		t.Fatalf("the pre-MM9 snapshot digests %s, saved as %s", d, saved)
	}
	if g.Emergence != nil || g.r.Fight.D.Found != nil || g.r.Values.Found != nil {
		t.Fatal("attaching a world from before emergence gave it emergence")
	}
	if _, err := g.Act(Command{Key: SeasonStart, Kind: SeasonStart}); err != nil {
		t.Fatal(err)
	}
	if _, err := g.Act(Command{Key: "grant", Char: g.Chars[0].C.ID, Kind: Grant, Asset: "rad-goat", Note: "nil emergence"}); err != nil {
		t.Fatal(err)
	}
	days := sheets.IntParam(g.r.Book.WorldParams, "season-days")
	end := (g.World.Day/days + 1) * days
	from := fact.ID(g.Log.Len())
	for g.World.Day <= end {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	for _, f := range g.Log.Since(from) {
		if f.StagedBy != nil || f.Kind == factPromotion || f.Kind == factSeasonAdded || f.Kind == factEmergenceStarted {
			t.Fatalf("a world without emergence wrote %+v", f)
		}
	}
	if g.Emergence != nil {
		t.Fatal("play gave the world emergence")
	}
	if d := digestOf(t, g); d.String() != nilEmergenceDigest {
		t.Fatalf("played to %s, before emergence it reached %s", d, nilEmergenceDigest)
	}
}

// emergence-start gives an old world its state once, stamped with today
// and the season, writes emergence.started, survives a save, and is
// refused (changing nothing) once a world has emergence, a new one
// included.
func TestEmergenceStartOnce(t *testing.T) {
	g, _ := loadPreMM9(t)
	if _, err := g.Act(Command{Key: SeasonStart, Kind: SeasonStart}); err != nil {
		t.Fatal(err)
	}
	if !Operator(EmergenceStart) || !WorldLevel(EmergenceStart) {
		t.Fatal("emergence-start is not a world-level operator command")
	}
	res, err := g.Act(Command{Key: EmergenceStart, Kind: EmergenceStart})
	if err != nil {
		t.Fatal(err)
	}
	day := g.Tick() / sheets.TicksPerDay
	e := g.Emergence
	if e == nil || e.Season != g.season() || len(e.Weeks) != 1 || e.Weeks[0].From != day {
		t.Fatalf("emergence-start on day %d of season %d gave %+v", day, g.season(), e)
	}
	if g.Log.Stage == nil || g.r.Fight.D.Found == nil || g.r.Values.Found == nil {
		t.Fatal("emergence-start left the log unstamped or the found materials unwired")
	}
	if res.Char != nil || len(res.Facts) != 1 || res.Facts[0].Kind != factEmergenceStarted || res.Facts[0].StagedBy != nil {
		t.Fatalf("emergence-start wrote %+v", res.Facts)
	}
	if d, ok := res.Facts[0].Get("day"); !ok || d.N != day {
		t.Fatalf("emergence.started names day %+v, want %d", d, day)
	}
	refuseStart := func(g *Game, what string) {
		t.Helper()
		before := digestOf(t, g)
		if _, err := g.Act(Command{Key: "again", Kind: EmergenceStart}); !refusedAs(err, BadArgs) {
			t.Fatalf("%s: %v, want %s", what, err, BadArgs)
		}
		if digestOf(t, g) != before {
			t.Fatalf("%s was refused but changed the game", what)
		}
	}
	refuseStart(g, "a second emergence-start")
	for range sheets.TicksPerDay {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	back := reload(t, g)
	if digestOf(t, back) != digestOf(t, g) || back.Emergence == nil || back.Log.Stage == nil {
		t.Fatal("a saved world with emergence loads changed")
	}
	refuseStart(back, "emergence-start after a save")
	refuseStart(guardGame(t), "emergence-start on a new world")
}

// A season's close fades every trace that never reached a line, keeps
// what was promoted and the found materials, keeps the season's counts,
// and season.added names what the season gave players (GDD 13.4, 12.6).
func TestSeasonFadesTraces(t *testing.T) {
	g := guardGame(t)
	e, rules := g.Emergence, g.r.Emerge
	c, _, ok := g.Season()
	if !ok || c.N != 0 || e.Season != 0 {
		t.Fatalf("a new world is in season %+v, emergence stamped %d", c, e.Season)
	}
	day := int64(1)
	h := g.SettlementHex(0).Neighbour(0)
	line := rules.Lines[string(emerge.Road)]
	sp := &emerge.Spot{Hex: h}
	e.Passage[h] = sp
	sp.Count.Add(day, e.Season, 5, rules.Decay[emerge.Passage])
	sp.Window.Add(day, e.Season, 5, line.WindowDays)
	sp.Who.See("c-1", day, e.Season, line.Distinct)
	e.Touch(day, emerge.DueKey{Trace: emerge.Passage, Hex: &h})

	key := emerge.StyleKey{Region: g.World.RegionAt(h), Style: "edge+keen"}
	st := &emerge.StyleTrace{Key: key, Lead: "edge", Resisted: "keen"}
	e.Styles[key] = st
	st.Count.Add(day, e.Season, 3, rules.Decay[emerge.Reliance])
	style, err := g.promoteTrace(Promoting{Type: emerge.Style, Region: key.Region, At: &h, Of: key.Style})
	if err != nil || style == nil {
		t.Fatalf("promoting a style: %v", err)
	}
	st.Done = style.ID
	base := g.r.Book.Materials[0]
	found, ok := rules.Found(base, rules.Adapt[0].ID)
	if !ok || !g.foundMaterial(found) || g.foundMaterial(found) {
		t.Fatal("a found material did not register once")
	}
	if _, err := g.promoteTrace(Promoting{Type: emerge.Material, Region: -1, Of: found.ID}); err != nil {
		t.Fatal(err)
	}
	if !g.knownMaterial(found.ID) || !g.knownMaterial(base.ID) || g.knownMaterial("no-such") {
		t.Fatal("knownMaterial misreads the sheet or the found materials")
	}

	closeDay := c.Start + c.Days
	var facts []fact.Fact
	for g.World.Day <= closeDay {
		fs, err := g.Advance()
		if err != nil {
			t.Fatal(err)
		}
		facts = append(facts, fs...)
	}
	now := g.World.Day
	if e.Season != 1 || g.season() != 1 {
		t.Fatalf("after the close emergence is stamped %d, the season is %d", e.Season, g.season())
	}
	if v := sp.Count.At(now, e.Season, rules.Decay[emerge.Passage]); v != 0 || sp.Window.Sum(now, e.Season, line.WindowDays) != 0 || sp.Who.Within(now, e.Season, line.WindowDays) != 0 {
		t.Fatalf("an unpromoted trace still reads %v after the close", v)
	}
	if e.Styles[key] == nil || e.Promotion(style.ID) == nil || !g.knownMaterial(found.ID) {
		t.Fatal("the close let a promoted record or a found material go")
	}
	if _, ok := g.r.Fight.D.Material(found.ID); !ok {
		t.Fatal("the item rules no longer read the found material")
	}
	if len(e.Seasons) != 1 || e.Seasons[0].Season != 0 || e.Seasons[0].Promotions[emerge.Style] != 1 || e.Seasons[0].Promotions[emerge.Material] != 1 {
		t.Fatalf("the closed season's counts are %+v", e.Seasons)
	}
	if e.Now.Season != 1 || len(e.Now.Promotions) != 0 || len(e.Lines) != 0 {
		t.Fatalf("the new season starts with %+v and lines %v", e.Now, e.Lines)
	}
	i := slices.IndexFunc(facts, func(f fact.Fact) bool { return f.Kind == factSeasonAdded })
	if i < 0 {
		t.Fatal("no season.added at the new season")
	}
	added := facts[i]
	for k, want := range map[string]int64{"season": 0, "styles": 1, "variants": 0, "materials": 1, "classes": 0} {
		if d, ok := added.Get(k); !ok || d.N != want {
			t.Errorf("season.added %s = %+v, want %d", k, d, want)
		}
	}
	if d, ok := added.Get("first"); !ok || d.S != style.Name {
		t.Errorf("season.added names %q first, want the style %q", d.S, style.Name)
	}
	if j := slices.IndexFunc(facts, func(f fact.Fact) bool { return f.Kind == "season.began" }); j < 0 || j > i {
		t.Fatal("season.added came before season.began")
	}

	// Expiry lets the faded trace go once keep-days have passed untouched;
	// the promoted style stays.
	for g.World.Day <= day+rules.P.KeepDays {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if e.Passage[h] != nil || e.Styles[key] == nil {
		t.Fatalf("after keep-days the faded spot is %v and the style %v", e.Passage[h], e.Styles[key])
	}
}

// Hooks run in (Order, Name) order whatever order they register in: the
// fact hooks of a kind after the core's counts, and the day hooks at the
// day turn. A name registers once.
func TestEmergeHooksInOrder(t *testing.T) {
	hooks, kinds := slices.Clone(emergeHooks), emergeKinds
	defer func() { emergeHooks, emergeKinds = hooks, kinds }()
	g := guardGame(t)
	var calls []string
	hook := func(name string, order int) emergeHook {
		return emergeHook{Name: name, Order: order, Kinds: []string{factKindDiscovered, factKindDiscovered},
			Fact: func(g *Game, f fact.Fact) error {
				if g.Emergence.Weeks[len(g.Emergence.Weeks)-1].Kinds == 0 {
					t.Error("a hook ran before the core counted the fact")
				}
				calls = append(calls, "fact:"+name)
				return nil
			},
			Day: func(*Game, int64, int64) error { calls = append(calls, "day:"+name); return nil }}
	}
	registerEmerge(hook("zz-late", 1))
	registerEmerge(hook("bb-early", 0))
	registerEmerge(hook("aa-late", 1))
	func() {
		defer func() {
			if recover() == nil {
				t.Error("a hook name registered twice")
			}
		}()
		registerEmerge(hook("aa-late", 0))
	}()
	f, err := g.r.weights.New(g.Tick(), factKindDiscovered, "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := g.noteTraces([]fact.Fact{f}); err != nil {
		t.Fatal(err)
	}
	if err := g.emergenceDay(sheets.TicksPerDay); err != nil {
		t.Fatal(err)
	}
	want := []string{"fact:bb-early", "fact:aa-late", "fact:zz-late", "day:bb-early", "day:aa-late", "day:zz-late"}
	if !slices.Equal(calls, want) {
		t.Fatalf("hooks ran %v, want %v", calls, want)
	}
}
