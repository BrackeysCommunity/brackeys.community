package game_test

import (
	"encoding/json"
	"errors"
	"os"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/season"
	"jams.team/mmo-world/sim/sheets"
)

// testdata/pre-mm9 is a game recorded before seasons had a clock: a guild
// of three, a season race that resets, an expired vow, a standing errand
// and a proposal short of its need, on world day 81.
const preMM9Dir = "testdata/pre-mm9/"

// seasonFacts runs a game day by day and keeps the season facts by kind,
// with the world day each was written on.
func seasonFacts(t *testing.T, g *game.Game, days int64) map[string][]int64 {
	t.Helper()
	out := map[string][]int64{}
	for range days * sheets.TicksPerDay {
		fs, err := g.Advance()
		if err != nil {
			t.Fatal(err)
		}
		for _, f := range fs {
			if strings.HasPrefix(f.Kind, "season.") {
				out[f.Kind] = append(out[f.Kind], f.Tick/sheets.TicksPerDay)
			}
		}
	}
	return out
}

func clockOf(t *testing.T, g *game.Game) season.Clock {
	t.Helper()
	c, _, ok := g.Season()
	if !ok {
		t.Fatal("the world keeps no season")
	}
	return c
}

func refusedWith(t *testing.T, g *game.Game, what, code string, cmd game.Command) {
	t.Helper()
	before, _ := g.Digest()
	_, err := g.Act(cmd)
	var ref *game.Refused
	if !errors.As(err, &ref) || ref.Code != code {
		t.Fatalf("%s: %v, want %s", what, err, code)
	}
	if after, _ := g.Digest(); after != before {
		t.Fatalf("%s was refused but changed the game", what)
	}
}

// A new world runs season zero for season-zero-days, then seasons of
// season-days: season 0 closes on day 14 and season 1 on day 56.
func TestSeasonZeroThenSeasonOne(t *testing.T) {
	g, err := game.New(rules(t))
	if err != nil {
		t.Fatal(err)
	}
	if c := clockOf(t, g); c != (season.Clock{N: 0, Start: 0, Days: 14}) {
		t.Fatalf("a new world's clock is %+v", c)
	}
	_, tb, _ := g.Season()
	if tb.FinaleFrom() != 13 || tb.StageEnds(2) != 12 {
		t.Fatalf("season zero's table %v", tb)
	}
	got := seasonFacts(t, g, 56)
	for kind, want := range map[string][]int64{
		"season.finale": {14, 56},
		"season.closed": {14, 56},
		"season.began":  {14, 56},
	} {
		if !slices.Equal(got[kind], want) {
			t.Errorf("%s on days %v, want %v", kind, got[kind], want)
		}
	}
	if c := clockOf(t, g); c != (season.Clock{N: 2, Start: 56, Days: 42}) {
		t.Fatalf("after day 56 the clock is %+v", c)
	}
	// Season zero's bands start on world days 2, 6, 9 and 12; season 1's on
	// 14, 21, 32, 42 and 52.
	bands := []int64{2, 6, 9, 12, 14, 21, 32, 42, 52, 56}
	if !slices.Equal(got["season.band"], bands) {
		t.Errorf("bands began on days %v, want %v", got["season.band"], bands)
	}
}

// Goals in flight at a close: a resetting Each race keeps the cap its
// claims left and counts from nothing, a proposal short of its need ends,
// and a side goal, which lives its stage, is left as it was.
func TestGoalsAcrossTheSeasonClose(t *testing.T) {
	g, ts := society(t, 3)
	c := clockOf(t, g)
	home := ts[0].c.C.At
	far, _ := richest(g, home, 3)
	race := proposal(t, g, ts, game.GoalSpec{Title: "The far-tile race", Issuer: goal.BySettlement, Mode: goal.Each, Cap: 10, Lifetime: goal.Season,
		Turnover: goal.Reset, Cond: goal.Condition{Verb: goal.Reach, Count: 1, At: "tile:" + far.Ref()}})
	for _, tr := range ts[1:] {
		tr.walk(far)
	}
	if len(race.Claims) != 2 {
		t.Fatalf("race claims %+v", race.Claims)
	}
	short := post(ts[0], game.GoalSpec{Title: "A bridge nobody funds", Issuer: goal.BySettlement, Mode: goal.Pooled, Lifetime: goal.Standing,
		Turnover: goal.Keep, Cond: goal.Condition{Verb: goal.Deliver, Count: 10, Tag: "timber", At: ts[0].c.C.Home}})
	ts[1].grant(ledger.Coin, 30)
	had := ts[1].c.C.Coin
	ts[1].must(game.Command{Kind: game.Pledge, Target: short.ID, Units: 30})

	advanceDays(t, g, c.Days-1-g.Tick()/sheets.TicksPerDay)
	n, _ := g.SettlementAt(home)
	region := g.World.RegionAt(home)
	cast := arc.Cast{{Role: "front", Ref: arc.RegionRef(region)}, {Role: "seat", Ref: arc.SettlementRef(n)}}
	if _, err := g.Act(game.Command{Key: "cast-overrun", Kind: game.ArcCast, Arc: &game.ArcCmd{Template: "the-overrun", Cast: cast}}); err != nil {
		t.Fatal(err)
	}
	a := g.Story.Arcs[len(g.Story.Arcs)-1]
	if a.Ended != 0 || len(a.Stages[a.Stage].Sides) == 0 || a.Stages[a.Stage].Due <= (c.Start+c.Days)*sheets.TicksPerDay {
		t.Fatalf("the overrun does not run across the close: %+v", a)
	}
	var sides []*game.Goal
	var before []string
	for _, s := range a.Stages[a.Stage].Sides {
		x := goalByID(g, s.Goal)
		if x == nil {
			t.Fatalf("side %s has no goal %s", s.Side, s.Goal)
		}
		sides = append(sides, x)
		body, _ := json.Marshal(x)
		before = append(before, string(body))
	}

	advanceDays(t, g, 1)
	if clockOf(t, g).N != c.N+1 {
		t.Fatalf("the season did not close on day %d", c.Start+c.Days)
	}
	if race.State != goal.Live || race.Cap != 8 || len(race.Claims) != 0 || race.Total() != 0 || race.Season != c.N+1 {
		t.Fatalf("the race after the close: %s cap %d, %d claims, season %d", race.State, race.Cap, len(race.Claims), race.Season)
	}
	if short.Open() || ts[1].c.C.Coin != had {
		t.Fatalf("the proposal is %s and its pledger holds %d of %d", short.State, ts[1].c.C.Coin, had)
	}
	for i, x := range sides {
		body, _ := json.Marshal(x)
		if string(body) != before[i] {
			t.Fatalf("side goal %s moved at the close:\n%s\nwas\n%s", x.ID, body, before[i])
		}
	}
	audit(t, g)
}

func goalByID(g *game.Game, id string) *game.Goal {
	for _, x := range g.Goals {
		if x.ID == id {
			return x
		}
	}
	return nil
}

func preMM9(t *testing.T) (*game.Rules, []byte, string) {
	t.Helper()
	r := testkit.Rules(t, testkit.Book(t), keys.Throwaway("pre-mm9"))
	body, err := os.ReadFile(preMM9Dir + "snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	saved, err := os.ReadFile(preMM9Dir + "digest.txt")
	if err != nil {
		t.Fatal(err)
	}
	return r, body, strings.TrimSpace(string(saved))
}

// A world saved before seasons had a clock loads at its digest, takes
// season-start once, lands in season day/42 as the weather counted it, and
// closes that season on the day its goals expected.
func TestPreMM9WorldStartsASeason(t *testing.T) {
	r, body, saved := preMM9(t)
	g := preLoad(t, r, body)
	if d, err := g.Digest(); err != nil || d.String() != saved {
		t.Fatalf("the pre-MM9 snapshot digests %s (%v), saved as %s", d, err, saved)
	}
	if g.Story != nil {
		t.Fatal("a world from before seasons loads with a story")
	}
	refusedWith(t, g, "an arc-cast before a season", game.NoSeason, game.Command{Key: "cast", Kind: game.ArcCast, Arc: &game.ArcCmd{Template: "the-overrun"}})
	refusedWith(t, g, "an epoch before a season", game.NoSeason, game.Command{Key: "epoch", Kind: game.SeasonEpoch, Epoch: &season.Epoch{From: "a", To: "b"}})
	if !game.Operator(game.SeasonStart) || !game.WorldLevel(game.SeasonStart) || !game.Operator(game.SeasonEpoch) || !game.Operator(game.ArcCast) {
		t.Fatal("the season commands are not world-level operator commands")
	}
	res, err := g.Act(game.Command{Key: game.SeasonStart, Kind: game.SeasonStart})
	if err != nil {
		t.Fatal(err)
	}
	days := sheets.IntParam(r.Book.WorldParams, "season-days")
	n := g.World.Day / days
	if want := (season.Clock{N: n, Start: n * days, Days: days, Legacy: true}); clockOf(t, g) != want || n != 1 {
		t.Fatalf("season-start on day %d gave %+v, want %+v", g.World.Day, clockOf(t, g), want)
	}
	if len(res.Facts) != 0 {
		t.Fatalf("season-start wrote %v", res.Facts)
	}
	refusedWith(t, g, "a second season-start", game.SeasonRunning, game.Command{Key: "again", Kind: game.SeasonStart})

	race := goalByID(g, "q-1")
	short := goalByID(g, "q-4")
	if race == nil || short == nil || race.Season != n || race.State != goal.Live || short.State != goal.Proposed {
		t.Fatalf("the fixture's goals: race %+v, proposal %+v", race, short)
	}
	end := (n + 1) * days
	got := seasonFacts(t, g, end-g.World.Day)
	if !slices.Equal(got["season.closed"], []int64{end}) {
		t.Fatalf("season.closed on days %v, want %d", got["season.closed"], end)
	}
	if c := clockOf(t, g); c != (season.Clock{N: n + 1, Start: end, Days: sheets.IntParam(r.Book.StoryParams, "season-days")}) {
		t.Fatalf("after the close the clock is %+v", c)
	}
	if race.Season != n+1 || race.State != goal.Live || short.Open() {
		t.Fatalf("after the close: race season %d %s, proposal %s", race.Season, race.State, short.State)
	}
	audit(t, g)
	out, err := json.Marshal(g)
	if err != nil {
		t.Fatal(err)
	}
	d, _ := g.Digest()
	if h := preLoad(t, r, out); clockOf(t, h) != clockOf(t, g) {
		t.Fatal("the clock did not survive a save")
	} else if d2, _ := h.Digest(); d2 != d {
		t.Fatalf("saved and loaded the game digests %s, %s before", d2, d)
	}
}

// season-epoch is taken only right after the tick that closed a season,
// once.
func TestSeasonEpochAtTheBoundary(t *testing.T) {
	g, err := game.New(rules(t))
	if err != nil {
		t.Fatal(err)
	}
	ep := func(key string) game.Command {
		return game.Command{Key: key, Kind: game.SeasonEpoch, Epoch: &season.Epoch{From: "old", To: "new", Sheets: 2}}
	}
	refusedWith(t, g, "an epoch before season zero ran", game.NotAtBoundary, ep("e0"))
	advanceDays(t, g, 5)
	refusedWith(t, g, "an epoch mid-season", game.NotAtBoundary, ep("e1"))
	c := clockOf(t, g)
	advanceDays(t, g, c.Start+c.Days-5)
	if clockOf(t, g).N != 1 {
		t.Fatalf("the clock after day %d: %+v", c.Days, clockOf(t, g))
	}
	refusedWith(t, g, "an epoch with no digests", game.BadArgs, game.Command{Key: "e2", Kind: game.SeasonEpoch})
	res, err := g.Act(ep("e3"))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Facts) != 1 || res.Facts[0].Kind != "season.epoch" || clockOf(t, g).Epoch != "new" {
		t.Fatalf("the epoch wrote %+v, clock %+v", res.Facts, clockOf(t, g))
	}
	for k, want := range map[string]fact.Datum{"from": fact.S("from", "old"), "to": fact.S("to", "new"), "sheets": fact.N("sheets", 2), "season": fact.N("season", 1)} {
		if d, ok := res.Facts[0].Get(k); !ok || d != want {
			t.Errorf("season.epoch %s is %+v, want %+v", k, d, want)
		}
	}
	refusedWith(t, g, "the same epoch twice", game.BadArgs, ep("e4"))
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
	refusedWith(t, g, "an epoch a tick after the close", game.NotAtBoundary, game.Command{Key: "e5", Kind: game.SeasonEpoch,
		Epoch: &season.Epoch{From: "new", To: "newer", Sheets: 1}})
	if clockOf(t, g).Epoch != "new" {
		t.Fatal("the epoch did not hold")
	}
}

// In season zero the opening, eligible from the first rising day, jumps
// the world queue; its stages end on the band ends, the last on the
// finale's first day, so the finale is cast then and closes with the
// season.
func TestWorldArcAndFinale(t *testing.T) {
	g, err := game.New(rules(t))
	if err != nil {
		t.Fatal(err)
	}
	c, tb, _ := g.Season()
	g.Story.Ring = &game.Ring{Core: g.SettlementHex(0).Neighbours()[0], Open: 1}
	i := slices.IndexFunc(tb, func(s season.Span) bool { return s.Band == season.Rising })
	rising := c.Start + tb[i].From - 1
	advanceDays(t, g, rising)
	var opening *game.Arc
	for _, a := range g.Story.Arcs {
		if a.Scope == arc.ScopeWorld {
			opening = a
		}
	}
	if opening == nil || opening.By != game.ByOpening || opening.Template != "the-opening" || opening.Began != rising*sheets.TicksPerDay {
		t.Fatalf("the first rising day cast %+v", opening)
	}
	for stage := range 3 {
		if g.Tick() < opening.Stages[opening.Stage].Due {
			if want := (c.Start + tb.StageEnds(opening.Stage)) * sheets.TicksPerDay; opening.Stages[opening.Stage].Due != want {
				t.Fatalf("stage %d is due at %d, want %d", stage, opening.Stages[opening.Stage].Due, want)
			}
		}
		advanceDays(t, g, (opening.Stages[opening.Stage].Due-g.Tick())/sheets.TicksPerDay)
		if opening.Ended != 0 {
			break
		}
	}
	finaleDay := c.Start + tb.FinaleFrom() - 1
	if opening.Ended != finaleDay*sheets.TicksPerDay || g.Tick() != finaleDay*sheets.TicksPerDay {
		t.Fatalf("the opening ended at %d, the finale starts at %d (now %d)", opening.Ended, finaleDay*sheets.TicksPerDay, g.Tick())
	}
	var finale *game.Arc
	for _, a := range g.Story.Arcs {
		if a.By == game.ByFinale {
			finale = a
		}
	}
	if finale == nil {
		t.Fatal("no finale was cast")
	}
	// Nothing else presses in a world nobody plays, so the opening's lapse
	// that same day is what casts the last stand.
	last := opening.Stages[len(opening.Stages)-1].Fact
	if finale.Template != "the-last-stand" || !slices.ContainsFunc(finale.Cause, func(id fact.ID) bool { return id > last }) {
		t.Fatalf("the finale is %s, caused by %v, not the opening's lapse after %d", finale.Template, finale.Cause, last)
	}
	if finale.Began != finaleDay*sheets.TicksPerDay || finale.Stages[0].Due != (c.Start+c.Days)*sheets.TicksPerDay {
		t.Fatalf("the finale %s began %d, due %d", finale.Template, finale.Began, finale.Stages[0].Due)
	}
	casts := 0
	for _, a := range g.Story.Arcs {
		if a.Scope == arc.ScopeWorld && a.By != game.ByFinale {
			casts++
		}
	}
	if casts != 1 {
		t.Fatalf("season zero cast %d world arcs besides its finale", casts)
	}
	var closing []fact.Fact
	for range (c.Start+c.Days)*sheets.TicksPerDay - g.Tick() {
		fs, err := g.Advance()
		if err != nil {
			t.Fatal(err)
		}
		closing = append(closing, fs...)
	}
	if finale.Ended != (c.Start+c.Days)*sheets.TicksPerDay {
		t.Fatalf("the finale ended at %d", finale.Ended)
	}
	i = slices.IndexFunc(closing, func(f fact.Fact) bool { return f.Kind == "season.finale" })
	if i < 0 {
		t.Fatal("no season.finale at the close")
	}
	if d, _ := closing[i].Get("template"); d.S != finale.Template {
		t.Fatalf("season.finale names %q, the finale was %s", d.S, finale.Template)
	}
	order := []string{}
	for _, f := range closing[i:] {
		if strings.HasPrefix(f.Kind, "season.") {
			order = append(order, f.Kind)
		}
	}
	if want := []string{"season.finale", "season.closed", "season.began", "season.band"}; !slices.Equal(order, want) {
		t.Fatalf("the close wrote %v, want %v", order, want)
	}
}
