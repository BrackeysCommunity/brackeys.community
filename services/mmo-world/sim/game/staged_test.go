package game

import (
	"fmt"
	"maps"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
)

// structural: how far from the first settlement a staging test looks for
// site tiles, and how long it lets a staged arc run.
const (
	stagedSearch  = 12
	stagedArcDays = 12
	stagedTries   = 10
	stagedTier    = 2
)

// traceSum is the canonical digest of every trace and promotion, renown
// on notables aside: the world's own factions name them in heavy facts
// whoever plays.
func traceSum(t *testing.T, g *Game) canon.Sum {
	t.Helper()
	e := g.Emergence
	renown := map[string]*emerge.Subject{}
	for _, k := range slices.Sorted(maps.Keys(e.Renown)) {
		if s := e.Renown[k]; s.Ref.Kind != renownNotable {
			renown[k] = s
		}
	}
	view := struct {
		Passage, Clearing, Loss emerge.Spots
		Pairs                   map[emerge.PairKey]*emerge.Pair
		RoadLoad                map[int]*emerge.RoadLoad
		Styles                  map[emerge.StyleKey]*emerge.StyleTrace
		Regions                 map[int]*emerge.RegionTally
		Masters                 map[emerge.MastersKey]*emerge.Recent
		Renown                  map[string]*emerge.Subject
		Promotions              []emerge.Promotion
	}{e.Passage, e.Clearing, e.Loss, e.Pairs, e.RoadLoad, e.Styles, e.Regions, e.Masters, renown, e.Promotions}
	s, err := canon.Digest(view)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// siteTiles are passable site tiles near the first settlement whose
// clearings would count, nearest first, each with a passable neighbour to
// step on from.
func siteTiles(g *Game, n int) [][2]hex.Hex {
	from := g.SettlementHex(0)
	seen := map[hex.Hex]bool{from: true}
	ring := []hex.Hex{from}
	var out [][2]hex.Hex
	passable := func(h hex.Hex) bool { return g.r.Gen.Passable(g.r.Gen.Baseline(h).Terrain) && g.World.RegionAt(h) >= 0 }
	for range stagedSearch {
		var next []hex.Hex
		for _, h := range ring {
			for _, x := range h.Neighbours() {
				if seen[x] {
					continue
				}
				seen[x] = true
				next = append(next, x)
				if !passable(x) || g.slot(x) == "" || g.IsDungeon(x) || g.IsSettlement(x) {
					continue
				}
				for _, y := range x.Neighbours() {
					if passable(y) && g.slot(y) == "" && !g.IsSettlement(y) {
						out = append(out, [2]hex.Hex{x, y})
						break
					}
				}
				if len(out) == n {
					return out
				}
			}
		}
		ring = next
	}
	return out
}

// crossAndClear steps c onto site from beside it, then has it win an
// encounter there, and returns the facts the arrival and the fight wrote.
func crossAndClear(t *testing.T, g *Game, c *Char, site, beside hex.Hex) []fact.Fact {
	t.Helper()
	if err := g.Teleport(c, beside); err != nil {
		t.Fatal(err)
	}
	advance(t, g)
	if _, err := g.Act(Command{Key: "cross-" + c.C.ID + "-" + site.Ref(), Char: c.C.ID, Kind: Step, Dir: beside.DirectionTo(site)}); err != nil {
		t.Fatal(err)
	}
	var out []fact.Fact
	for c.Long != nil {
		fs, err := g.Advance()
		if err != nil {
			t.Fatal(err)
		}
		for _, f := range fs {
			if slices.Contains(f.Subjects, fact.Ref{Kind: renownCharacter, ID: c.C.ID}) && c.C.At == site {
				out = append(out, f)
			}
		}
	}
	if c.C.At != site {
		t.Fatalf("%s did not reach %s", c.C.ID, site.Ref())
	}
	return append(out, winThere(t, g, c)...)
}

// winThere has c explore its tile and press the likeliest win until it
// wins an encounter there, and returns the facts its fights wrote.
func winThere(t *testing.T, g *Game, c *Char) []fact.Fact {
	t.Helper()
	var out []fact.Fact
	do := func(cmd Command) error {
		cmd.Key, cmd.Char, cmd.Now = fmt.Sprintf("win-%s-%d", c.C.ID, g.Log.Len()), c.C.ID, 1
		res, err := g.Act(cmd)
		out = append(out, res.Facts...)
		return err
	}
	for range stagedTries {
		c.C.Conditions = nil
		for _, in := range c.C.Pack {
			in.Repair()
		}
		if err := do(Command{Kind: Explore}); err != nil || c.Fight == nil {
			advance(t, g)
			continue
		}
		for c.Fight != nil {
			pick, band := wayOut, int64(-1)
			for _, o := range g.Choose(c).Fight.Options {
				if !o.Puzzle && o.Kind == fight.Win && o.Band > band {
					pick, band = o.ID, o.Band
				}
			}
			if err := do(Command{Kind: Press, Option: pick}); err != nil {
				t.Fatal(err)
			}
		}
		if slices.ContainsFunc(out, func(f fact.Fact) bool { return f.Kind == "encounter."+fight.Won }) {
			return out
		}
	}
	// Too hard a site for a starting character: the last encounter is won
	// by hand, closed as a press would close it.
	c.C.Conditions = nil
	explored(t, g, c)
	from := fact.ID(g.Log.Len())
	endFight(t, g, c, fight.Won, someHaul(g))
	return append(out, g.Log.Since(from)...)
}

// pressDown has hunters press a hunt until it is over, and returns the
// facts the presses wrote and the tick facts that name the hunt.
func pressDown(t *testing.T, g *Game, x *Hunt, cs []*Char, key string) []fact.Fact {
	t.Helper()
	var out []fact.Fact
	ref := fact.Ref{Kind: kindHunt, ID: x.H.ID}
	for n := 0; !x.H.Over; n++ {
		for _, c := range cs {
			if x.H.Over {
				break
			}
			for _, in := range c.C.Pack {
				in.Repair()
			}
			res, err := press(g, c, x, fmt.Sprintf("%s-%d-%s", key, n, c.C.ID))
			if err != nil && !refusedAs(err, DownCode) {
				t.Fatal(err)
			}
			out = append(out, res.Facts...)
		}
		fs, err := g.Advance()
		if err != nil {
			t.Fatal(err)
		}
		for _, f := range fs {
			if slices.Contains(f.Subjects, ref) {
				out = append(out, f)
			}
		}
	}
	return out
}

// Staged play feeds no trace (GDD 13.5, 14.5): an operator's hunt-start and
// its kills, an arc-cast and its stage facts, a crossing and a fight on
// admin-placed content, and a grant are each stamped StagedBy fact by fact,
// and the traces read the same before and after. The same play unstaged
// moves them.
func TestStagedFeedsNoTrace(t *testing.T) {
	g := guardGame(t)
	h := huntTile(t, g)
	cs := hunters(t, g, 10, h)
	sites := siteTiles(g, 2)
	if len(sites) < 2 {
		t.Fatalf("found %d site tiles near the first settlement, want 2", len(sites))
	}
	placed, plain := sites[0], sites[1]
	if err := g.Reach(placed[0]); err != nil {
		t.Fatal(err)
	}
	advance(t, g)
	content, ok := g.Content(placed[0])
	if !ok {
		t.Fatal("the placed tile holds no stored content")
	}
	content.Placed = &tile.Placed{By: tile.PlacedAdmins, Server: "srv-staged", Label: "Staged"}
	crosser := mustCreate(t, g, "crosser", "knife")
	ReadyAt(g.r, crosser, stagedTier, stagedTier)
	advance(t, g)
	before := traceSum(t, g)

	var staged []fact.Fact
	stamped := func(what string, fs []fact.Fact) {
		t.Helper()
		if len(fs) == 0 {
			t.Fatalf("%s wrote nothing to check", what)
		}
		for _, f := range fs {
			if f.StagedBy == nil {
				t.Fatalf("%s: %s (%d) is not stamped staged", what, f.Kind, f.ID)
			}
		}
		staged = append(staged, fs...)
		kinds := map[string]int{}
		for _, f := range fs {
			kinds[f.Kind]++
		}
		t.Logf("%s: %d facts stamped %v", what, len(fs), kinds)
	}

	res, err := g.Act(Command{Key: "staged-hunt", Kind: HuntStart, Asset: quickHunt, To: &h})
	if err != nil {
		t.Fatal(err)
	}
	stamped("hunt-start", res.Facts)
	x := g.Hunts[len(g.Hunts)-1]
	stamped("the staged hunt's presses and kill", pressDown(t, g, x, cs, "staged"))
	if !x.H.Slain {
		t.Fatal("the staged hunt was not brought down")
	}

	res, err = g.Act(Command{Key: "staged-raid", Kind: ArcCast, Arc: &ArcCmd{Template: "raid", Cast: arc.Cast{{Role: rolePlace, Ref: arc.SettlementRef(0)}}}})
	if err != nil {
		t.Fatal(err)
	}
	stamped("arc-cast", res.Facts)
	a := g.Story.Arcs[len(g.Story.Arcs)-1]
	if a.By != ByOperator {
		t.Fatalf("the cast arc is by %s", a.By)
	}
	var arcFacts []fact.Fact
	for range stagedArcDays * sheets.TicksPerDay {
		if a.over() {
			break
		}
		fs, err := g.Advance()
		if err != nil {
			t.Fatal(err)
		}
		for _, f := range fs {
			if slices.Contains(f.Subjects, arcRef(a.ID)) {
				arcFacts = append(arcFacts, f)
			}
		}
	}
	if !a.over() {
		t.Fatal("the staged raid did not end")
	}
	stamped("the staged raid's stage facts", arcFacts)

	stamped("a crossing and a fight on placed content", crossAndClear(t, g, crosser, placed[0], placed[1]))
	if e := g.Emergence; e.Passage[placed[0]] != nil || e.Clearing[placed[0]] != nil {
		t.Fatal("play on placed content fed a trace")
	}

	res, err = g.Act(Command{Key: "staged-grant", Char: cs[0].C.ID, Kind: Grant, Asset: "rad-goat", Note: "staged"})
	if err != nil {
		t.Fatal(err)
	}
	stamped("grant", res.Facts)
	for _, f := range res.Facts {
		if !g.Emergence.IsStaged(f.ID) {
			t.Fatalf("%s (%d) is stamped but not kept for what it causes", f.Kind, f.ID)
		}
	}
	if after := traceSum(t, g); after != before {
		t.Fatal("staged play moved the traces")
	}

	// The same play, unstaged.
	y, err := g.OpenHunt(quickHunt, h, g.Tick(), WhySpawn)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range pressDown(t, g, y, cs, "plain") {
		if f.StagedBy != nil {
			t.Fatalf("an unstaged hunt's %s is stamped %v", f.Kind, f.StagedBy)
		}
	}
	crossAndClear(t, g, crosser, plain[0], plain[1])
	e := g.Emergence
	if e.Passage[plain[0]] == nil || e.Clearing[plain[0]] == nil {
		t.Fatal("an unstaged crossing and clearing fed no trace")
	}
	if e.Renown[fact.Ref{Kind: renownCharacter, ID: cs[0].C.ID}.String()] == nil {
		t.Fatal("an unstaged kill gave its hunters no renown")
	}
	if traceSum(t, g) == before {
		t.Fatal("unstaged play left the traces as they were")
	}
}
