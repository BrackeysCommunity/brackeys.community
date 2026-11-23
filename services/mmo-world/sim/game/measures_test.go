package game

import (
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// logged writes a fact of kind through the log, so the stage hook marks
// it as play would.
func logged(t *testing.T, g *Game, kind string, subjects []fact.Ref, causes []fact.ID) fact.Fact {
	t.Helper()
	f, err := g.r.weights.New(g.Tick(), kind, world.RegionRef(0), subjects, causes)
	if err != nil {
		t.Fatal(err)
	}
	if f.ID, err = g.Log.Append(f); err != nil {
		t.Fatal(err)
	}
	got, _ := g.Log.Get(f.ID)
	return got
}

// The four measures (GDD 13.5) read as defined: new kinds per active
// character a week, promotions this season against one per 500 active,
// heavy facts with a player in their causes, and each region's largest
// style's share of its reliance.
func TestMeasures(t *testing.T) {
	g := guardGame(t)
	e, p := g.Emergence, g.r.Emerge.P
	cs := []*Char{mustCreate(t, g, "m-a", "knife"), mustCreate(t, g, "m-b", "knife"), mustCreate(t, g, "m-c", "knife")}
	heavy, light := "hunt.slain", "hunt.pressed"
	if w := g.r.weights[heavy]; w < p.RenownWeight {
		t.Fatalf("%s weighs %d, under the renown line %d", heavy, w, p.RenownWeight)
	}
	if w := g.r.weights[light]; w >= p.RenownWeight {
		t.Fatalf("%s weighs %d, at the renown line", light, w)
	}
	world0 := g.Log.Len()
	e.Now.Heavy, e.Now.HeavyPlayer = 0, 0

	var fs []fact.Fact
	fs = append(fs, logged(t, g, factKindDiscovered, []fact.Ref{char.Ref(cs[0].C.ID)}, nil))
	fs = append(fs, logged(t, g, factKindDiscovered, []fact.Ref{char.Ref(cs[1].C.ID)}, nil))
	named := logged(t, g, heavy, []fact.Ref{char.Ref(cs[0].C.ID)}, nil)
	g.ownCmd = true
	own := logged(t, g, heavy, nil, nil)
	g.ownCmd = false
	caused := logged(t, g, heavy, nil, []fact.ID{own.ID})
	plain := logged(t, g, heavy, nil, nil)
	plain2 := logged(t, g, heavy, nil, []fact.ID{plain.ID})
	lightOne := logged(t, g, light, []fact.Ref{char.Ref(cs[0].C.ID)}, nil)
	g.stagedBy = &fact.Ref{Kind: stampOperator, ID: Grant}
	staged := logged(t, g, heavy, []fact.Ref{char.Ref(cs[1].C.ID)}, nil)
	g.stagedBy = nil
	fs = append(fs, named, own, caused, plain, plain2, lightOne, staged)
	if staged.StagedBy == nil || own.StagedBy != nil {
		t.Fatalf("stamps: staged %v, own %v", staged.StagedBy, own.StagedBy)
	}
	g.keepNews(fs)
	if err := g.takeTraceErr(); err != nil {
		t.Fatal(err)
	}
	if g.Log.Len() != world0+len(fs) {
		t.Fatal("counting the measures wrote facts")
	}
	// Both new kinds are heavy and name their makers.
	if e.Now.Heavy != 7 || e.Now.HeavyPlayer != 5 {
		t.Fatalf("heavy %d, with a player %d; want 7 and 5 (two kinds, named, own, caused by own)", e.Now.Heavy, e.Now.HeavyPlayer)
	}
	if len(g.playerFacts) != 0 {
		t.Fatal("the batch's player facts outlived it")
	}

	week := e.Weeks[len(e.Weeks)-1]
	if week.Kinds != 2 {
		t.Fatalf("the week counts %d new kinds, want 2", week.Kinds)
	}
	// The week rolls on its seventh day with the characters active then.
	was := g.World.Tick
	g.World.Tick = weekDays * sheets.TicksPerDay
	if err := g.emergenceDay(g.World.Tick); err != nil {
		t.Fatal(err)
	}
	g.World.Tick = was
	if len(e.Weeks) != 2 || e.Weeks[0].Active != 3 || e.Weeks[0].Kinds != 2 || e.Weeks[1].From != weekDays {
		t.Fatalf("the week rolled to %+v", e.Weeks)
	}

	for _, ty := range emerge.Types {
		e.Now.Promotions[ty] = 1
	}
	region := 0
	decay := g.r.Emerge.Decay[emerge.Reliance]
	day, season := g.traceAt(g.Tick())
	tally := &emerge.RegionTally{Region: region}
	tally.Reliance.Add(day, season, 100, decay)
	e.Regions[region] = tally
	for id, n := range map[string]int64{"edge+keen": 30, "heat+warm": 20} {
		k := emerge.StyleKey{Region: region, Style: id}
		st := &emerge.StyleTrace{Key: k}
		st.Count.Add(day, season, n, decay)
		e.Styles[k] = st
	}
	d, ok := g.Measures()
	if !ok {
		t.Fatal("no dashboard with emergence on")
	}
	if d.Active != 3 || d.Need != 1 || !d.PromotionsHealthy || len(d.Promotions) != len(emerge.Types) {
		t.Fatalf("promotions: active %d need %d healthy %v %v", d.Active, d.Need, d.PromotionsHealthy, d.Promotions)
	}
	if d.Heavy != 7 || d.HeavyPlayer != 5 || !d.HeavyHealthy {
		t.Fatalf("heavy %d by players %d healthy %v", d.Heavy, d.HeavyPlayer, d.HeavyHealthy)
	}
	if len(d.KindsPerMille) != 2 || d.KindsPerMille[0] != 2*perMille/3 || !d.KindsHealthy {
		t.Fatalf("kinds per mille %v healthy %v", d.KindsPerMille, d.KindsHealthy)
	}
	if len(d.Pairing) != 1 || d.Pairing[0].Style != "edge+keen" || d.Pairing[0].Percent != 30 || !d.PairingHealthy {
		t.Fatalf("pairing %+v healthy %v", d.Pairing, d.PairingHealthy)
	}

	e.Now.Promotions[emerge.Haunt] = 0
	e.Styles[emerge.StyleKey{Region: region, Style: "edge+keen"}].Count.Add(day, season, 10, decay)
	e.Now.HeavyPlayer = 3
	e.Weeks[0].Kinds = 0
	d, _ = g.Measures()
	if d.PromotionsHealthy || d.PairingHealthy || d.Pairing[0].Percent != 40 || d.HeavyHealthy || d.KindsHealthy {
		t.Fatalf("unhealthy measures read healthy: %+v", d)
	}

	g.Emergence = nil
	if _, ok := g.Measures(); ok {
		t.Fatal("a dashboard with emergence off")
	}
}

// Renown counts each heavy fact on every item, notable and character it
// names (GDD 13.1); an item's heavy facts count per season, as an item
// legend reads them, and its renown outlives keep-days inside the season
// but not into the next.
func TestRenownItemLegendCount(t *testing.T) {
	g := guardGame(t)
	e, p := g.Emergence, g.r.Emerge.P
	c := mustCreate(t, g, "r-a", "knife")
	item := fact.Ref{Kind: renownItem, ID: "i-renown"}
	who := char.Ref(c.C.ID)
	key, ck := item.String(), who.String()
	heavy, light := "hunt.slain", "hunt.pressed"
	note := func(kind string, subjects ...fact.Ref) {
		t.Helper()
		g.keepNews([]fact.Fact{logged(t, g, kind, subjects, nil)})
		if err := g.takeTraceErr(); err != nil {
			t.Fatal(err)
		}
	}
	for range 3 {
		note(heavy, who, item)
	}
	note(light, who, item)
	g.stagedBy = &fact.Ref{Kind: stampOperator, ID: HuntStart}
	note(heavy, who, item)
	g.stagedBy = nil
	s := e.Renown[key]
	day := g.Tick() / sheets.TicksPerDay
	if s == nil || s.HeavyIn(0) != 3 || s.Count.At(day, 0, g.r.Emerge.Decay[emerge.Renown]) != fixed.FromInt(3) {
		t.Fatalf("the item's renown is %+v, want 3 heavy facts", s)
	}
	if e.Renown[ck] == nil || e.Renown[ck].HeavyIn(0) != 3 {
		t.Fatalf("the character's renown is %+v", e.Renown[ck])
	}

	// A new season counts afresh.
	e.Season = 1
	for range 2 {
		note(heavy, item)
	}
	if s.HeavyIn(1) != 2 || s.HeavyIn(0) != 0 {
		t.Fatalf("in the next season the item counts %d (and %d in the last)", s.HeavyIn(1), s.HeavyIn(0))
	}

	// Past keep-days untouched, the character's renown goes; the item's is
	// kept while its season's heavy facts still count.
	turn := func(d int64) {
		t.Helper()
		was := g.World.Tick
		g.World.Tick = d * sheets.TicksPerDay
		if err := g.emergenceDay(g.World.Tick); err != nil {
			t.Fatal(err)
		}
		g.World.Tick = was
	}
	later := day + p.KeepDays
	turn(later)
	if e.Renown[ck] != nil || e.Renown[key] == nil {
		t.Fatalf("after keep-days: character %v, item %v", e.Renown[ck], e.Renown[key])
	}
	e.Season = 2
	turn(later + p.KeepDays)
	if e.Renown[key] != nil {
		t.Fatal("an item's renown outlived its season")
	}
}
