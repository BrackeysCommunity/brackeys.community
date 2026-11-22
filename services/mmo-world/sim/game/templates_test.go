package game

import (
	"fmt"
	"slices"
	"sort"
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// Each world, finale and region template end to end (GDD 12.9): the state
// its predicate reads is set, the director casts the candidate the
// predicate finds, and every stage is played three ways on fresh worlds:
// the first side wins each stage, the second does, or each runs out its
// days. Every stage's facts and weights, marks and escrow, pay to both
// sides, standing, and the world actions its won or lapse effects queue,
// applied the tick after, are checked against the sheet rows, and the
// ledger audits clean.

// The weights the design gives the director's own facts.
var tplWeights = map[string]int64{
	"arc.cast": 60, "arc.stage-began": 40, "arc.stage-ended": 80, "arc.ended": 70,
	"side.backed": 5, "character.marked": 20, "trouble.started": 65,
	"holding.fell": 90, "region.gauge-moved": 30, "faction.split": 90,
	"notable.loyalty-moved": 20, "faction.peace": 70, "faction.grudge": 50, "core.sealed": 80,
}

// The kinds the story's world actions write.
var tplWorldKinds = []string{"faction.fortified", "holding.fell", "region.gauge-moved", "faction.split", "notable.promoted",
	"notable.loyalty-moved", "notable.defected", "faction.peace", "faction.grudge"}

// tplSpec is one template's test: the state its predicate needs, which of
// the predicate's candidates to cast, what that candidate must look like,
// and checks of its own after each stage.
type tplSpec struct {
	id    string
	by    string
	setup func(t *testing.T, g *Game)
	pick  func(g *Game, c arc.Candidate) bool
	want  func(t *testing.T, g *Game, c arc.Candidate)
	after func(t *testing.T, g *Game, end tplEnd)
	// before runs before a stage is played.
	before func(t *testing.T, g *Game, a *Arc)
}

// tplEnd is what one stage left behind.
type tplEnd struct {
	a      *Arc
	stage  int
	won    string
	ended  fact.Fact
	cited  []fact.Fact // facts the tick after naming the end as a cause
	backed []*tplBacker
}

// tplBacker is one test character backing a side.
type tplBacker struct {
	c     *Char
	side  string
	goal  string
	units int64
	coin  int64 // before the stage was decided
	worth int64 // the coin's worth its backing should accrue
}

// The ways a template is played: the side at that index wins every stage,
// or every stage lapses.
const tplLapse = -1

// tplGame is a fresh world a tick on.
func tplGame(t *testing.T) *Game {
	t.Helper()
	g := guardGame(t)
	dirTick(t, g)
	return g
}

// tplQuiet rests every place from troubles of its own, so nothing but the
// arc under test touches them; a trouble an effect casts ignores the rest.
func tplQuiet(g *Game) {
	for n := range g.Places {
		r := ScopeRest{Scope: arc.Settlement, Ref: arc.SettlementRef(n), Until: 1 << 50}
		i, found := slices.BinarySearchFunc(g.Story.Rests, r, cmpRest)
		if !found {
			g.Story.Rests = slices.Insert(g.Story.Rests, i, r)
		}
	}
}

func tplGauge(t *testing.T, g *Game, r int, gauge string, v int64) {
	t.Helper()
	gi, ok := g.World.GaugeOf(gauge)
	if !ok {
		t.Fatalf("no gauge %s", gauge)
	}
	g.World.Regions[r].Gauge[gi] = v
}

func tplLine(t *testing.T, g *Game, r int, line string) {
	t.Helper()
	li := slices.IndexFunc(g.r.Book.GaugeLines, func(l sheets.GaugeLine) bool { return l.ID == line })
	if li < 0 {
		t.Fatalf("no gauge line %s", line)
	}
	g.World.Regions[r].Active[li] = true
}

func tplColdStreak(g *Game, r int, cold int64) {
	s := g.Story
	i, found := slices.BinarySearchFunc(s.Streaks, r, streakRegion)
	if !found {
		s.Streaks = slices.Insert(s.Streaks, i, Streak{Region: r})
	}
	s.Streaks[i].Cold = cold
}

// tplRemember writes a world fact and puts it in the story's memory, as the
// tick's end would.
func tplRemember(t *testing.T, g *Game, h hex.Hex, kind string, subjects []fact.Ref, data ...fact.Datum) fact.ID {
	t.Helper()
	first := fact.ID(g.Log.Len())
	id, err := g.worldFact(h, kind, subjects, nil, data...)
	if err != nil {
		t.Fatal(err)
	}
	g.noteStory(g.Log.Since(first))
	if !slices.ContainsFunc(g.Story.Memory, func(m arc.Memory) bool { return m.Fact == id }) {
		t.Fatalf("the story does not tplRemember %s", kind)
	}
	return id
}

// tplOnlyHolds leaves faction f holding region r alone.
func tplOnlyHolds(g *Game, f, r int) {
	for i := range g.World.Regions {
		if i != r && g.World.Regions[i].Holder == f {
			tplHold(g, i, -1, 0)
		}
	}
}

// tplHold gives region r to faction f at a defence.
func tplHold(g *Game, r, f int, defence int64) {
	g.World.Regions[r].Holder = f
	g.World.Regions[r].Defence = defence
}

// tplCast casts the predicate's candidate the spec picks through the
// director's own path.
func tplCast(t *testing.T, g *Game, s tplSpec) *Arc {
	t.Helper()
	tpl, ok := g.template(s.id)
	if !ok {
		t.Fatalf("no template %s", s.id)
	}
	var c arc.Candidate
	found := false
	for _, x := range tpl.When(g.storyView(), tpl.Row, g.r.Story) {
		if s.pick == nil || s.pick(g, x) {
			c, found = x, true
			break
		}
	}
	if !found {
		t.Fatalf("%s's predicate %s finds no candidate", s.id, tpl.Row.When)
	}
	if s.want != nil {
		s.want(t, g, c)
	}
	a, err := g.castFrom(tpl, c, s.by, g.Tick())
	if err != nil {
		t.Fatal(err)
	}
	f := tplFact(t, g, a.Fact)
	if f.Kind != "arc.cast" || !slices.Equal(f.Causes, c.Causes) || !slices.Contains(f.Subjects, arcRef(a.ID)) {
		t.Fatalf("%s's cast fact %+v, causes %v", s.id, f, c.Causes)
	}
	if a.By != s.by || a.Scope != tpl.Row.Scope || !slices.Equal(a.Regions, c.Regions) || a.Seat != c.Seat {
		t.Fatalf("%s cast as %+v from %+v", s.id, a, c)
	}
	return a
}

func tplFact(t *testing.T, g *Game, id fact.ID) fact.Fact {
	t.Helper()
	for _, f := range g.Log.Since(id - 1) {
		if f.ID == id {
			return f
		}
	}
	t.Fatalf("no fact %d", id)
	return fact.Fact{}
}

func tplWeighed(t *testing.T, f fact.Fact) {
	t.Helper()
	if w, ok := tplWeights[f.Kind]; ok && w >= 0 && f.Weight != w {
		t.Fatalf("%s weighs %d, the design gives %d", f.Kind, f.Weight, w)
	}
}

// tplRun plays a template each way on its own fresh world.
func tplRun(t *testing.T, s tplSpec) {
	for _, mode := range []int{0, 1, tplLapse} {
		name := "lapse"
		if mode >= 0 {
			name = fmt.Sprintf("side-%d-wins", mode)
		}
		t.Run(name, func(t *testing.T) {
			g := tplGame(t)
			s.setup(t, g)
			tplQuiet(g)
			a := tplCast(t, g, s)
			tplPlay(t, g, a, s, mode)
		})
	}
}

// tplPlay plays every stage of an arc one way, then checks its end.
func tplPlay(t *testing.T, g *Game, a *Arc, s tplSpec, mode int) []tplEnd {
	t.Helper()
	var ends []tplEnd
	var everyone []*tplBacker
	for !a.over() {
		if s.before != nil {
			s.before(t, g, a)
		}
		end := tplStage(t, g, a, mode)
		everyone = append(everyone, end.backed...)
		if s.after != nil {
			s.after(t, g, end)
		}
		ends = append(ends, end)
		if len(ends) > g.stages(a) {
			t.Fatalf("%s ran %d stages of %d", a.ID, len(ends), g.stages(a))
		}
	}
	if len(ends) != g.stages(a) || len(a.Stages) != g.stages(a) {
		t.Fatalf("%s ran %d stages of %d", a.ID, len(ends), g.stages(a))
	}
	last := ends[len(ends)-1]
	if want := tplOr(last.won, outcomeLapsed); a.Outcome != want || a.Ended != last.ended.Tick {
		t.Fatalf("%s ended %q at %d, its last stage %q at %d", a.ID, a.Outcome, a.Ended, want, last.ended.Tick)
	}
	var endedF *fact.Fact
	for _, f := range factsOf(g, "arc.ended") {
		if hasDatum(f, "arc", a.ID) {
			endedF = &f
		}
	}
	if endedF == nil || !hasDatum(*endedF, "outcome", a.Outcome) || !slices.Equal(endedF.Causes, []fact.ID{last.ended.ID}) {
		t.Fatalf("%s's end fact %+v", a.ID, endedF)
	}
	tplWeighed(t, *endedF)
	tplSeated(t, g, a, *endedF)
	for _, ref := range append([]fact.Ref{arcRef(a.ID), {Kind: scopeSubject, ID: a.Scope}}, tplRegionRefs(a.Regions)...) {
		if !slices.Contains(endedF.Subjects, ref) {
			t.Fatalf("%s's end names no %s: %v", a.ID, ref, endedF.Subjects)
		}
	}
	if n, _ := endedF.Get("lapsed"); (n.N == 1) != (last.won == "") {
		t.Fatalf("%s's end says lapsed %d", a.ID, n.N)
	}
	for _, b := range everyone {
		i := slices.IndexFunc(b.c.C.Conditions, func(x char.Condition) bool { return x.Tag == char.ArcMarked })
		if i >= 0 && b.c.C.Conditions[i].Ends == 0 {
			t.Fatalf("%s is still marked after %s ended", b.c.C.ID, a.ID)
		}
	}
	audit(t, g)
	return ends
}

func tplRegionRefs(rs []int) []fact.Ref {
	out := make([]fact.Ref, len(rs))
	for i, r := range rs {
		out[i] = arc.RegionRef(r)
	}
	return out
}

func tplOr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// tplStage plays the arc's current stage: with a winner, its mark met by
// two characters while each other side is half filled by one; lapsing,
// every side half filled and the days run out.
func tplStage(t *testing.T, g *Game, a *Arc, mode int) tplEnd {
	t.Helper()
	stage := a.Stage
	st := &a.Stages[stage]
	row, _ := g.stageRow(a, stage)
	began := tplFact(t, g, st.Fact)
	wantKind := "arc.stage-began"
	if stage == 0 {
		wantKind = "arc.cast"
	}
	if began.Kind != wantKind || !hasDatum(began, "arc", a.ID) || !hasDatum(began, "stageId", row.ID) {
		t.Fatalf("%s stage %d began with %+v", a.ID, stage, began)
	}
	tplWeighed(t, began)
	tplSeated(t, g, a, began)
	if stage > 0 && !slices.Equal(began.Causes, []fact.ID{a.Stages[stage-1].Fact}) {
		t.Fatalf("%s stage %d's start cites %v", a.ID, stage, began.Causes)
	}
	if len(st.Sides) != len(row.Sides) {
		t.Fatalf("%s stage %d runs %d sides of %d", a.ID, stage, len(st.Sides), len(row.Sides))
	}
	minted := int64(0)
	for i, sr := range st.Sides {
		x := g.GoalOf(sr.Goal)
		sd := row.Sides[i]
		if x == nil || sr.Side != sd.ID || x.Cond.Verb != goal.Back || x.Cond.Count != sr.Mark || x.Mode != goal.Pooled || x.Lifetime != goal.Ephemeral {
			t.Fatalf("%s stage %d side %+v, goal %+v", a.ID, stage, sr, x)
		}
		if sr.Mark < sd.Per*g.r.Story.MarkFloorCharacters || sr.Mark%sd.Per != 0 {
			t.Fatalf("%s side %s marks %d, not a multiple of %d past the floor", a.ID, sr.Side, sr.Mark, sd.Per)
		}
		if d, _ := began.Get("mark:" + sr.Side); d.N != sr.Mark {
			t.Fatalf("%s's start says side %s marks %d, not %d", a.ID, sr.Side, d.N, sr.Mark)
		}
		if pool := g.Ledger.Of(goalPool(x.ID), ledger.Coin); pool != x.Reward {
			t.Fatalf("%s side %s holds %d of its %d escrow", a.ID, sr.Side, pool, x.Reward)
		}
		if x.Issuer != (goal.Ref{Kind: goal.ByFaction, ID: itoa(sr.Sponsor)}) || x.Expires != st.Due+1 {
			t.Fatalf("%s side %s issued %+v, expires %d (due %d)", a.ID, sr.Side, x.Issuer, x.Expires, st.Due)
		}
		minted += x.Reward
	}
	if stage == 0 && minted <= 0 {
		t.Fatalf("%s's first stage minted no escrow", a.ID)
	}
	snap := tplSnapshot(g)
	var backed []*tplBacker
	won := ""
	if mode >= 0 {
		won = st.Sides[mode].Side
	}
	for i, sr := range st.Sides {
		if i != mode {
			backed = append(backed, tplFill(t, g, a, sr, max(sr.Mark/2, 1), 1)...)
		}
	}
	if mode >= 0 {
		backed = append(backed, tplFill(t, g, a, st.Sides[mode], st.Sides[mode].Mark, 2)...)
		dirTick(t, g)
		if !st.over() || st.Won != won || st.Ended != g.Tick() {
			t.Fatalf("%s stage %d met by %s: %+v", a.ID, stage, won, *st)
		}
	} else {
		due := st.Due
		for i := int64(0); !st.over() && i <= due; i++ {
			dirTick(t, g)
		}
		if !st.over() || !st.Lapsed || st.Won != "" || st.Ended != due {
			t.Fatalf("%s stage %d due %d: %+v at %d", a.ID, stage, due, *st, g.Tick())
		}
	}
	ended := tplStageEnded(t, g, a, stage)
	tplWeighed(t, ended)
	tplSeated(t, g, a, ended)
	if !hasDatum(ended, "side", tplOr(won, outcomeLapsed)) || !slices.Equal(ended.Causes, []fact.ID{st.Fact}) {
		t.Fatalf("%s stage %d ended with %+v", a.ID, stage, ended)
	}
	var units int64
	who := map[string]bool{}
	for _, b := range backed {
		units += b.units
		who[b.c.C.ID] = true
	}
	if d, _ := ended.Get("units"); d.N != units {
		t.Fatalf("%s stage %d says %d units, the backers gave %d", a.ID, stage, d.N, units)
	}
	if d, _ := ended.Get("backers"); d.N != int64(len(who)) {
		t.Fatalf("%s stage %d says %d backers, %d backed", a.ID, stage, d.N, len(who))
	}
	tplPay(t, g, a, st, won, backed)
	sd, isSide := sideRow(row, won)
	effects := row.Lapse
	var winner *SideRun
	if isSide {
		effects = sd.Won
		winner = &st.Sides[mode]
	}
	tplStanding(t, g, a, st, effects, winner, backed)
	tplRivals(t, g, winner, backed, ended)
	expected := tplExpect(t, g, a, effects)
	if !a.over() {
		if a.Stage != stage+1 || a.Stages[a.Stage].Began != ended.Tick {
			t.Fatalf("%s's next stage did not begin as stage %d ended", a.ID, stage)
		}
	} else if a.Scope == arc.Region {
		for _, r := range a.Regions {
			if !g.storyView().Busy(arc.Region, arc.RegionRef(r)) {
				t.Fatalf("region %d does not rest after %s", r, a.ID)
			}
		}
	}
	dirTick(t, g)
	end := tplEnd{a: a, stage: stage, won: won, ended: ended, backed: backed}
	for _, f := range g.Log.Since(ended.ID) {
		if slices.Contains(f.Causes, ended.ID) {
			end.cited = append(end.cited, f)
		}
	}
	var got []string
	for _, f := range end.cited {
		if slices.Contains(tplWorldKinds, f.Kind) {
			tplWeighed(t, f)
			got = append(got, tplSig(f))
		}
	}
	sort.Strings(got)
	sort.Strings(expected)
	if !slices.Equal(got, expected) {
		t.Fatalf("%s stage %d (%s): the world did %v, the sheet's effects ask %v", a.ID, stage, tplOr(won, outcomeLapsed), got, expected)
	}
	tplStoryEffects(t, g, a, effects, winner, end, snap)
	return end
}

// tplSeated: an arc's own facts are located at its seat.
func tplSeated(t *testing.T, g *Game, a *Arc, f fact.Fact) {
	t.Helper()
	if h, ok := fact.HexOf(f); !ok || h != a.Seat || f.Region != world.RegionRef(g.World.RegionAt(a.Seat)) {
		t.Fatalf("%s at %s, %v: %s's seat is %v", f.Kind, f.Region, h, a.ID, a.Seat)
	}
}

func tplStageEnded(t *testing.T, g *Game, a *Arc, stage int) fact.Fact {
	t.Helper()
	for _, f := range factsOf(g, "arc.stage-ended") {
		if d, _ := f.Get("stage"); hasDatum(f, "arc", a.ID) && d.N == int64(stage) {
			return f
		}
	}
	t.Fatalf("%s stage %d wrote no arc.stage-ended", a.ID, stage)
	return fact.Fact{}
}

// tplAsset is the goods a side's tag takes.
func tplAsset(t *testing.T, g *Game, tag string) (string, string) {
	t.Helper()
	if tag == "" || tag == ledger.Provisions {
		return ledger.Provisions, ledger.Provisions
	}
	for _, m := range g.r.Book.Materials {
		if slices.Contains(m.Tags, tag) {
			return ledger.Material(m.ID), m.ID
		}
	}
	t.Fatalf("no material tagged %s", tag)
	return "", ""
}

// tplFill backs a side with units shared by n fresh characters, each
// where the side is served.
func tplFill(t *testing.T, g *Game, a *Arc, sr SideRun, units int64, n int) []*tplBacker {
	t.Helper()
	x := g.GoalOf(sr.Goal)
	s, ok := g.sideOf(x)
	if !ok {
		t.Fatalf("%s is not a side", sr.Goal)
	}
	if s.wants == arc.WantReach {
		n = int(units)
	}
	var out []*tplBacker
	left := units
	for i := range n {
		part := units / int64(n)
		if i == n-1 {
			part = left
		}
		left -= part
		if part <= 0 {
			continue
		}
		c := mustCreate(t, g, fmt.Sprintf("tpl-%d", len(g.Chars)), "knife")
		b := &tplBacker{c: c, side: sr.Side, goal: x.ID, units: part, coin: c.C.Coin}
		key := fmt.Sprintf("tpl-%s-%d", c.C.ID, g.Log.Len())
		switch s.wants {
		case arc.WantGoods:
			h, ok := g.refHex(sr.At)
			if !ok {
				t.Fatalf("goods for %s land nowhere: %q", sr.Side, sr.At)
			}
			c.C.At = h
			asset, material := tplAsset(t, g, s.tag)
			dirGive(t, g, c, asset, part)
			dirBack(t, g, c, x.ID, asset, part)
			b.worth = part * g.r.Values.Asset(material)
		case arc.WantBeats:
			c.C.At = tplBeatHex(t, g, a)
			if _, err := g.Act(Command{Key: key + "-declare", Char: c.C.ID, Kind: BackSide, Target: x.ID}); err != nil {
				t.Fatal(err)
			}
			first := fact.ID(g.Log.Len())
			if _, err := g.factWith(c, nil, "beat.won", g.Tick(), fact.S("encounter", "e"), fact.N("beat", 1), fact.S("option", "strike"), fact.N("score", part)); err != nil {
				t.Fatal(err)
			}
			if err := g.creditGoals(first, key); err != nil {
				t.Fatal(err)
			}
			b.worth = part * g.r.Story.BeatCoin
		case arc.WantReach:
			h, ok := g.refHex(sr.At)
			if !ok {
				t.Fatalf("%s is reached nowhere: %q", sr.Side, sr.At)
			}
			c.C.At = h
			first := fact.ID(g.Log.Len())
			if _, err := g.factWith(c, nil, "travel.entered", g.Tick(), append(fact.At(h), fact.N("ticks", 1))...); err != nil {
				t.Fatal(err)
			}
			if err := g.creditGoals(first, key); err != nil {
				t.Fatal(err)
			}
			b.worth = g.r.Story.BeatCoin
		default:
			t.Fatalf("no template here wants %s", s.wants)
		}
		for _, kind := range []string{"side.backed", "character.marked"} {
			for _, f := range factsOf(g, kind) {
				if slices.Contains(f.Subjects, char.Ref(c.C.ID)) {
					tplWeighed(t, f)
				}
			}
		}
		if got := x.Progress.Get(c.C.ID); got != part {
			t.Fatalf("%s gave %d to %s, which counts %d", c.C.ID, part, sr.Side, got)
		}
		if bk, ok := g.backingIn(c.C.ID, a.ID, a.Stage); !ok || bk.Side != sr.Side {
			t.Fatalf("%s is not recorded backing %s", c.C.ID, sr.Side)
		}
		if a.Scope == arc.ScopeWorld && !c.C.Has(char.ArcMarked, g.Tick()) {
			t.Fatalf("%s backs a world arc unmarked", c.C.ID)
		}
		out = append(out, b)
	}
	return out
}

// tplBeatHex is where beats for an arc are fought: its seat when inside its
// regions, else its first region's centre.
func tplBeatHex(t *testing.T, g *Game, a *Arc) hex.Hex {
	t.Helper()
	if g.inRegions(a.Seat, a.Regions) {
		return a.Seat
	}
	for _, r := range a.Regions {
		if h := g.regionHex(r); g.World.RegionAt(h) == r {
			return h
		}
	}
	t.Fatalf("%s's regions %v have no tile to fight in", a.ID, a.Regions)
	return hex.Hex{}
}

// tplPay: the side met paid its whole escrow by what each gave; every
// other side paid side-pay-other of its share, scaled by how far it
// filled, by contribution; no pool keeps anything.
func tplPay(t *testing.T, g *Game, a *Arc, st *StageRun, won string, backed []*tplBacker) {
	t.Helper()
	for _, sr := range st.Sides {
		x := g.GoalOf(sr.Goal)
		if left := g.Ledger.Of(goalPool(x.ID), ledger.Coin); left != 0 || x.Open() {
			t.Fatalf("%s side %s still holds %d (%s)", a.ID, sr.Side, left, x.State)
		}
		var paid int64
		owed := splitOf(x, sr.Mark, g.r.Story.SidePayOther)
		for _, b := range backed {
			if b.side != sr.Side {
				continue
			}
			got := b.c.C.Coin - b.coin
			paid += got
			switch {
			case sr.Side == won && got < x.Reward*b.units/sr.Mark:
				t.Fatalf("%s gave %d of %s's %d and was paid %d of %d", b.c.C.ID, b.units, sr.Side, sr.Mark, got, x.Reward)
			case sr.Side != won && got != owed[b.c.C.ID]:
				t.Fatalf("%s gave %d of %s's %d and was paid %d, owed %d", b.c.C.ID, b.units, sr.Side, sr.Mark, got, owed[b.c.C.ID])
			}
		}
		if sr.Side == won && paid != x.Reward {
			t.Fatalf("%s's winners were paid %d of %d", sr.Side, paid, x.Reward)
		}
	}
}

// tplStanding: each backer's standing is +1 with its side's sponsor per
// standing-for of what it gave, −1 with an opponent per standing-against,
// and a won standing effect adds to the winners'.
func tplStanding(t *testing.T, g *Game, a *Arc, st *StageRun, effects []sheets.StoryEffect, winner *SideRun, backed []*tplBacker) {
	t.Helper()
	p := g.r.Story
	for _, b := range backed {
		x := g.GoalOf(b.goal)
		s, _ := g.sideOf(x)
		key := standingKey(s.sr.Sponsor, g.sideHex(s))
		if got := b.c.BackWorth.Get(key); got != b.worth {
			t.Fatalf("%s gave %d's worth to %s, %d accrued", b.c.C.ID, b.worth, b.side, got)
		}
		want := b.worth / p.StandingFor
		if winner != nil && b.side == winner.Side {
			for _, e := range effects {
				if e.Kind == effStanding {
					want += tplStandingFrom(t, g, a, e, key)
				}
			}
		}
		if got := b.c.C.Standing.Get(key); got != want {
			t.Fatalf("%s's standing with %s's sponsor is %d, want %d", b.c.C.ID, b.side, got, want)
		}
		if s.sr.Opponent < 0 || s.sr.Opponent == s.sr.Sponsor {
			continue
		}
		against := standingKey(s.sr.Opponent, g.sideHex(s))
		if got := b.c.C.Standing.Get(against); got != -(b.worth / p.StandingAgainst) {
			t.Fatalf("%s's standing with %s's opponent is %d after %d's worth", b.c.C.ID, b.side, got, b.worth)
		}
	}
}

// tplRivals: each backer of a side that won against a faction is
// queued the rival thread against it (GDD 12.8).
func tplRivals(t *testing.T, g *Game, winner *SideRun, backed []*tplBacker, ended fact.Fact) {
	t.Helper()
	for _, b := range backed {
		queued := slices.ContainsFunc(g.Story.Pending, func(p arc.Pending) bool {
			return p.Kind == arc.PendRival && p.Char == b.c.C.ID && p.Fact == ended.ID
		})
		against := winner != nil && b.side == winner.Side && winner.Opponent >= 0 && winner.Opponent != winner.Sponsor
		if queued != against {
			t.Fatalf("%s backed %s: rival queued %v, want %v", b.c.C.ID, b.side, queued, against)
		}
		if against && !slices.ContainsFunc(g.Story.Pending, func(p arc.Pending) bool {
			return p.Char == b.c.C.ID && p.Ref == arc.FactionRef(winner.Opponent)
		}) {
			t.Fatalf("%s's rival is not %d", b.c.C.ID, winner.Opponent)
		}
	}
}

// tplStandingFrom is what a standing effect adds under key: its amount when
// its role's faction is the key's.
func tplStandingFrom(t *testing.T, g *Game, a *Arc, e sheets.StoryEffect, key string) int64 {
	t.Helper()
	ref, ok := a.Cast.Get(e.Role)
	if !ok || ref.Kind != kindFaction {
		t.Fatalf("a standing effect on role %q, which casts no faction", e.Role)
	}
	fi, _ := arc.RefIndex(ref)
	if factionOwner(fi) == key {
		return e.Amount
	}
	return 0
}

// tplRegionsOf are the regions an effect on a role should land in: every
// region of the arc, a region's own, a faction's or a notable's seat, a
// settlement's or a tile's region.
func tplRegionsOf(t *testing.T, g *Game, a *Arc, role string) []int {
	t.Helper()
	if role == sheets.RoleRegions {
		return a.Regions
	}
	ref, ok := a.Cast.Get(role)
	if !ok {
		t.Fatalf("%s casts no role %q", a.Template, role)
	}
	n, _ := arc.RefIndex(ref)
	switch ref.Kind {
	case kindRegion, kindHolding:
		return []int{n}
	case kindFaction:
		return []int{g.World.Factions[n].Seat}
	case kindNotable:
		fi, _ := g.notableFaction(ref.ID)
		if fi < 0 {
			return nil
		}
		return []int{g.World.Factions[fi].Seat}
	case kindSettlement:
		return []int{g.World.RegionAt(g.SettlementHex(n))}
	case kindTile:
		h, _ := hex.ParseRef(ref.ID)
		return []int{g.World.RegionAt(h)}
	}
	t.Fatalf("role %q binds %s", role, ref)
	return nil
}

func tplNotable(t *testing.T, a *Arc, role string) string {
	t.Helper()
	ref, ok := a.Cast.Get(role)
	if !ok || ref.Kind != kindNotable {
		t.Fatalf("%s's role %q is not a notable", a.Template, role)
	}
	return ref.ID
}

// tplExpect is the world facts a stage's effects should write, as the
// world stands when they are queued.
func tplExpect(t *testing.T, g *Game, a *Arc, es []sheets.StoryEffect) []string {
	t.Helper()
	lhd := sheets.IntParam(g.r.Book.FactionParams, "last-holding-damage")
	cut := func(holder int, by int64) int64 {
		if by < 0 && len(g.heldRegions(holder)) == 1 {
			return -fixed.PercentOf(-by, lhd)
		}
		return by
	}
	var out []string
	for _, e := range es {
		switch e.Kind {
		case effGauge:
			for _, r := range tplRegionsOf(t, g, a, e.Role) {
				out = append(out, fmt.Sprintf("region.gauge-moved@%s %s %+d", world.RegionRef(r), e.Gauge, e.Amount))
			}
		case effFortify:
			r := tplRegionsOf(t, g, a, e.Role)[0]
			if h := g.World.Regions[r].Holder; h >= 0 {
				out = append(out, fmt.Sprintf("faction.fortified@%s %+d", world.RegionRef(r), cut(h, e.Amount)))
			}
		case effFalls:
			r := tplRegionsOf(t, g, a, e.Role)[0]
			h := g.World.Regions[r].Holder
			switch {
			case h < 0:
			case len(g.heldRegions(h)) <= 1:
				out = append(out, fmt.Sprintf("faction.fortified@%s %+d", world.RegionRef(r), cut(h, -e.Amount)))
			default:
				out = append(out, "holding.fell@"+world.RegionRef(r))
			}
		case effLoyalty:
			out = append(out, fmt.Sprintf("notable.loyalty-moved %s %+d", tplNotable(t, a, e.Role), e.Amount))
		case effAppoint:
			id := tplNotable(t, a, e.Role)
			if fi, k := g.notableFaction(id); fi >= 0 && g.World.Factions[fi].Notables[k].Role != world.RoleLeader {
				out = append(out, "notable.promoted "+id)
			}
		case effSplit:
			fi, _ := g.notableFaction(tplNotable(t, a, e.Role))
			if len(g.heldRegions(fi)) >= splitLeast {
				out = append(out, "faction.split")
				break
			}
			for _, b := range a.Cast {
				if b.Ref.Kind == kindNotable {
					out = append(out, fmt.Sprintf("notable.loyalty-moved %s %+d", b.Ref.ID, -e.Amount))
				}
			}
		case effDefect:
			out = append(out, "notable.defected "+tplNotable(t, a, e.Role))
		case effPeace:
			out = append(out, "faction.peace")
		case effGrudge:
			out = append(out, "faction.grudge")
		}
	}
	return out
}

// tplSig is a world story fact as tplExpect names it.
func tplSig(f fact.Fact) string {
	num := func(k string) int64 { d, _ := f.Get(k); return d.N }
	str := func(k string) string { d, _ := f.Get(k); return d.S }
	notable := func() string {
		for _, s := range f.Subjects {
			if s.Kind == kindNotable {
				return s.ID
			}
		}
		return ""
	}
	switch f.Kind {
	case "region.gauge-moved":
		return fmt.Sprintf("%s@%s %s %+d", f.Kind, f.Region, str("gauge"), num("by"))
	case "faction.fortified":
		return fmt.Sprintf("%s@%s %+d", f.Kind, f.Region, num("by"))
	case "holding.fell":
		return f.Kind + "@" + f.Region
	case "notable.loyalty-moved":
		return fmt.Sprintf("%s %s %+d", f.Kind, notable(), num("by"))
	case "notable.promoted", "notable.defected":
		return f.Kind + " " + notable()
	}
	return f.Kind
}

// tplSnap is what the story effects outside the world change, before.
type tplSnap struct {
	clock    int64
	ringOpen int64
}

func tplSnapshot(g *Game) tplSnap {
	s := tplSnap{}
	if c, ok := g.clock(); ok {
		s.clock = c.N
	}
	if g.Story.Ring != nil {
		s.ringOpen = g.Story.Ring.Open
	}
	return s
}

// tplStoryEffects checks the effects that act on the story, places and
// characters: troubles cast, the core sealed or kept open, a cache split.
func tplStoryEffects(t *testing.T, g *Game, a *Arc, es []sheets.StoryEffect, winner *SideRun, end tplEnd, snap tplSnap) {
	t.Helper()
	for _, e := range es {
		switch e.Kind {
		case effTrouble:
			regions := tplRegionsOf(t, g, a, e.Role)
			for n, p := range g.Places {
				if p.Ruined != 0 || !slices.Contains(regions, g.World.RegionAt(p.Hex)) {
					continue
				}
				i := slices.IndexFunc(g.Story.Arcs, func(x *Arc) bool {
					return x.Template == e.Ref && x.Place == goal.SettlementRef(n) && x.By == ByEffect && slices.Contains(x.Cause, end.ended.ID)
				})
				if i < 0 {
					t.Fatalf("%s's %s cast no %s at place %d", a.ID, tplOr(end.won, outcomeLapsed), e.Ref, n)
				}
				started := tplFact(t, g, g.Story.Arcs[i].Fact)
				tplWeighed(t, started)
				if started.Kind != "trouble.started" {
					t.Fatalf("an effect's trouble began with %s", started.Kind)
				}
			}
		case effSeal:
			ring := g.Story.Ring
			sealed := slices.ContainsFunc(end.cited, func(f fact.Fact) bool { return f.Kind == "core.sealed" })
			if ring == nil || ring.Open != 0 || sealed != (snap.ringOpen != 0) {
				t.Fatalf("the seal left the ring %+v (sealed fact %v)", ring, sealed)
			}
		case effKeepOpen:
			ring := g.Story.Ring
			if snap.ringOpen != 0 && (ring.Open == 0 || ring.Until < snap.clock+max(e.Amount, 1)) {
				t.Fatalf("keep-open %d left the ring %+v in season %d", e.Amount, ring, snap.clock)
			}
		case effCache:
			tplCache(t, g, e, winner, end)
		}
	}
}

// tplCache: a won side's cache is minted and split among its backers by
// what each gave, to the goods.
func tplCache(t *testing.T, g *Game, e sheets.StoryEffect, winner *SideRun, end tplEnd) {
	t.Helper()
	i := slices.IndexFunc(g.r.Book.Caches, func(c sheets.Cache) bool { return c.ID == e.Ref })
	if i < 0 || winner == nil {
		t.Fatalf("cache %q with winner %v", e.Ref, winner)
	}
	for _, line := range g.r.Book.Caches[i].Goods {
		var got int64
		for _, b := range end.backed {
			if b.side != winner.Side {
				continue
			}
			n := goodsOf(b.c, line.Material) + g.Ledger.Of(ledger.WaitPool(end.a.Seat.Ref(), b.c.C.ID), ledger.Goods(line.Material))
			got += n
		}
		if got != line.Quantity {
			t.Fatalf("cache %s gave %s's backers %d %s of %d", e.Ref, winner.Side, got, line.Material, line.Quantity)
		}
	}
}

// --- the world templates ---

// tplSiegeState: the militant compact (faction 1) holds a region beside a
// second, weaker holding of faction 0's, which holds two.
func tplSiegeState(t *testing.T, g *Game) {
	t.Helper()
	if !slices.Contains(g.World.Regions[19].Neighbours, 20) || !slices.Contains(g.World.Regions[20].Neighbours, 21) {
		t.Fatal("the guard world's regions are not where the siege needs them")
	}
	if g.World.Regions[19].Holder != 0 || g.World.Regions[10].Holder != 1 {
		t.Fatal("faction 0 must hold region 19 and the compact region 10")
	}
	tplHold(g, 20, 0, 40)
	tplHold(g, 21, 1, 80)
}

var tplSiege = tplSpec{
	id: "the-siege", by: ByDirector, setup: tplSiegeState,
	want: func(t *testing.T, g *Game, c arc.Candidate) {
		for role, ref := range map[string]fact.Ref{"besieger": arc.FactionRef(1), "holder": arc.FactionRef(0), "holding": arc.HoldingRef(20)} {
			if got, _ := c.Cast.Get(role); got != ref {
				t.Fatalf("the siege casts %s as %s, want %s", role, got, ref)
			}
		}
		if c.Pressure != 40 {
			t.Fatalf("the siege's pressure is the defence gap, %d", c.Pressure)
		}
	},
}

func TestTemplateSiege(t *testing.T) { tplRun(t, tplSiege) }

// TestTemplateSiegeNeverTakesALastHolding: the predicate never besieges a
// faction's last holding, and a storm that falls on a holding that has
// become its holder's last cuts its defence instead, and the holder keeps
// it.
func TestTemplateSiegeNeverTakesALastHolding(t *testing.T) {
	g := tplGame(t)
	tplHold(g, 20, 1, 200)
	tpl, _ := g.template("the-siege")
	for _, c := range tpl.When(g.storyView(), tpl.Row, g.r.Story) {
		if ref, _ := c.Cast.Get("holder"); ref == arc.FactionRef(0) {
			t.Fatalf("the siege besieges faction 0's last holding: %+v", c.Cast)
		}
	}

	g = tplGame(t)
	tplSiegeState(t, g)
	tplQuiet(g)
	a := tplCast(t, g, tplSiege)
	s := tplSiege
	s.before = func(t *testing.T, g *Game, a *Arc) {
		if a.Stage == len(a.Stages)-1 && a.Stage == g.stages(a)-1 {
			tplOnlyHolds(g, 0, 20)
			if got := g.heldRegions(0); !slices.Equal(got, []int{20}) {
				t.Fatalf("faction 0 should hold only the besieged region, holds %v", got)
			}
		}
	}
	tplPlay(t, g, a, s, tplLapse)
	if g.World.Regions[20].Holder != 0 {
		t.Fatalf("the siege took faction 0's last holding: held by %d", g.World.Regions[20].Holder)
	}
	if fell := factsOf(g, "holding.fell"); len(fell) != 0 {
		t.Fatalf("a last holding fell to the story: %+v", fell)
	}
}

// tplSuccessionState: faction 0's leader died within leader-died-days, and
// the faction holds holdings regions.
func tplSuccessionState(holdings int) func(t *testing.T, g *Game) {
	return func(t *testing.T, g *Game) {
		t.Helper()
		f := &g.World.Factions[0]
		if f.Notables[0].Role != world.RoleLeader {
			t.Fatal("faction 0's first notable does not lead")
		}
		if holdings > 1 {
			tplHold(g, 20, 0, 60)
		}
		f.Notables[0].Dead = true
		tplRemember(t, g, g.regionHex(f.Seat), "notable.died", []fact.Ref{{Kind: kindNotable, ID: notableID(f.Notables[0].ID)}, arc.FactionRef(0)})
	}
}

func tplSuccession(holdings int) tplSpec {
	return tplSpec{id: "the-succession", by: ByDirector, setup: tplSuccessionState(holdings),
		pick: func(g *Game, c arc.Candidate) bool {
			ref, _ := c.Cast.Get("faction")
			return ref == arc.FactionRef(0)
		},
		want: func(t *testing.T, g *Game, c arc.Candidate) {
			f := g.World.Factions[0]
			a, _ := c.Cast.Get("claimant-a")
			b, _ := c.Cast.Get("claimant-b")
			if a.ID != notableID(f.Notables[2].ID) || b.ID != notableID(f.Notables[1].ID) || len(c.Causes) != 1 {
				t.Fatalf("the succession is between %s (most loyal) and %s (least), caused by %v", a.ID, b.ID, c.Causes)
			}
		}}
}

func TestTemplateSuccession(t *testing.T) {
	s := tplSuccession(2)
	s.after = func(t *testing.T, g *Game, end tplEnd) {
		if end.stage != 2 || end.won != "" {
			return
		}
		if !slices.ContainsFunc(end.cited, func(f fact.Fact) bool { return f.Kind == "faction.split" }) || len(g.World.Factions) != 4 {
			t.Fatalf("a lapsed claim splits faction 0: %d factions", len(g.World.Factions))
		}
		b := tplNotable(t, end.a, "claimant-b")
		if fi, _ := g.notableFaction(b); fi != 3 || g.World.Factions[3].Notables[0].Role != world.RoleLeader {
			t.Fatalf("claimant-b should lead the new faction, serves %d", fi)
		}
	}
	tplRun(t, s)
}

// TestTemplateSuccessionNeverSplitsASmallFaction: a lapsed claim in a
// faction holding fewer than two regions costs both claimants loyalty and
// splits nothing.
func TestTemplateSuccessionNeverSplitsASmallFaction(t *testing.T) {
	g := tplGame(t)
	s := tplSuccession(1)
	s.before = func(t *testing.T, g *Game, a *Arc) { tplOnlyHolds(g, 0, g.World.Factions[0].Seat) }
	s.setup(t, g)
	tplQuiet(g)
	a := tplCast(t, g, s)
	tplPlay(t, g, a, s, tplLapse)
	if len(g.World.Factions) != 3 || len(factsOf(g, "faction.split")) != 0 {
		t.Fatalf("a one-holding faction split: %d factions", len(g.World.Factions))
	}
}

// tplColdState: three regions have frozen cold-days running, region 0's
// longest.
func tplColdState(t *testing.T, g *Game) {
	t.Helper()
	p := g.r.Story
	if p.ColdRegions != 3 {
		t.Fatalf("cold-regions is %d", p.ColdRegions)
	}
	for i, r := range []int{0, 1, 2} {
		tplColdStreak(g, r, p.ColdDays+int64(2-i))
	}
}

func TestTemplateLongCold(t *testing.T) {
	tplRun(t, tplSpec{id: "the-long-cold", by: ByDirector, setup: tplColdState,
		want: func(t *testing.T, g *Game, c arc.Candidate) {
			if front, _ := c.Cast.Get("front"); front != arc.RegionRef(0) || !slices.Equal(c.Regions, []int{0, 1, 2}) {
				t.Fatalf("the long cold's front %s over %v", front, c.Regions)
			}
		}})
}

// tplCoreTile is a passable tile beside the first settlement.
func tplCoreTile(t *testing.T, g *Game) hex.Hex {
	t.Helper()
	for _, h := range g.SettlementHex(0).Neighbours() {
		if b := g.r.Gen.Baseline(h); g.r.Gen.Passable(b.Terrain) && !g.IsSettlement(h) {
			return h
		}
	}
	t.Fatal("the first settlement has no open neighbour")
	return hex.Hex{}
}

func tplOpenCore(t *testing.T, g *Game) {
	t.Helper()
	core := tplCoreTile(t, g)
	g.Story.Ring = &Ring{Core: core, Open: g.Tick()}
	tplRemember(t, g, core, "core.opened", []fact.Ref{arc.TileRef(core)}, fact.At(core)...)
}

func TestTemplateOpening(t *testing.T) {
	tplRun(t, tplSpec{id: "the-opening", by: ByOpening, setup: tplOpenCore,
		want: func(t *testing.T, g *Game, c arc.Candidate) {
			core := g.Story.Ring.Core
			r := g.World.RegionAt(core)
			if ref, _ := c.Cast.Get("core"); ref != arc.TileRef(core) || !slices.Contains(c.Regions, r) || len(c.Causes) != 1 {
				t.Fatalf("the opening casts %+v over %v", c.Cast, c.Regions)
			}
		}})
}

// --- the finales ---

func TestTemplateLastStand(t *testing.T) {
	tplRun(t, tplSpec{id: "the-last-stand", by: ByFinale,
		setup: func(t *testing.T, g *Game) { tplGauge(t, g, 3, "threat", 900) },
		pick: func(g *Game, c arc.Candidate) bool {
			ref, _ := c.Cast.Get("front")
			return ref == arc.RegionRef(3)
		},
		want: func(t *testing.T, g *Game, c arc.Candidate) {
			v := g.storyView()
			if c.Pressure < 900-v.LineFrom("threat") {
				t.Fatalf("region 3's pressure is %d", c.Pressure)
			}
		},
		after: func(t *testing.T, g *Game, end tplEnd) {
			cl, _, _ := g.Season()
			if end.won == "" && end.ended.Tick != (cl.Start)*sheets.TicksPerDay {
				t.Fatalf("a finale lapses at its season's close, not at %d", end.ended.Tick)
			}
		}})
}

func TestTemplateReckoning(t *testing.T) {
	tplRun(t, tplSpec{id: "the-reckoning", by: ByFinale,
		setup: func(t *testing.T, g *Game) {
			g.World.Factions[1].Grudge[0] = 10
			g.World.Factions[2].Grudge[0] = 4
		},
		want: func(t *testing.T, g *Game, c arc.Candidate) {
			f, _ := c.Cast.Get("faction")
			w, _ := c.Cast.Get("wronged")
			if f != arc.FactionRef(0) || w != arc.FactionRef(1) || c.Pressure != 14 {
				t.Fatalf("the reckoning of %s by %s at %d", f, w, c.Pressure)
			}
		},
		after: func(t *testing.T, g *Game, end tplEnd) {
			switch end.won {
			case "broker":
				if g.World.Factions[0].Grudge[1] != 0 || g.World.Factions[1].Grudge[0] != 0 {
					t.Fatal("the broker's peace left a grudge")
				}
			case "":
				i := slices.IndexFunc(end.cited, func(f fact.Fact) bool { return f.Kind == "faction.grudge" })
				if d, _ := end.cited[max(i, 0)].Get("days"); i < 0 || d.N < 14 || !slices.Equal(end.cited[i].Subjects, []fact.Ref{arc.FactionRef(0), arc.FactionRef(1)}) {
					t.Fatalf("the reckoning's lapse grudges %+v", end.cited)
				}
			}
		}})
}

func TestTemplateRebuilding(t *testing.T) {
	var before int64
	tplRun(t, tplSpec{id: "the-rebuilding", by: ByFinale,
		setup: func(t *testing.T, g *Game) {
			ps := g.placeStory(0)
			ps.Lost = 2
			g.Places[0].Damage(structureMarket, 40)
			before = g.Places[0].Get(structureMarket).Condition
		},
		want: func(t *testing.T, g *Game, c arc.Candidate) {
			if ref, _ := c.Cast.Get("place"); ref != arc.SettlementRef(0) || c.Pressure != 2*g.r.Story.FinaleLossWeight {
				t.Fatalf("the rebuilding of %s at %d", ref, c.Pressure)
			}
		},
		after: func(t *testing.T, g *Game, end tplEnd) {
			got := g.Places[0].Get(structureMarket).Condition
			if end.won == "rebuild" && got != min(before+25, g.r.Settle.ConditionMax) {
				t.Fatalf("the rebuild mended the market from %d to %d", before, got)
			}
			// Keepers mend a day's worth at each day turn, so only a stage
			// decided before the first is free of their mending.
			if end.won != "rebuild" && end.ended.Tick < sheets.TicksPerDay && got != before {
				t.Fatalf("the market mended without a rebuild: %d to %d", before, got)
			}
		}})
}

// --- the region templates ---

func TestTemplateCorruptionFront(t *testing.T) {
	p := guardGame(t).r.Story
	tplRun(t, tplSpec{id: "the-corruption-front", by: ByDirector,
		setup: func(t *testing.T, g *Game) {
			for r, v := range map[int]int64{1: 800, 2: 600, 4: 600} {
				tplGauge(t, g, r, "corruption", v)
				tplLine(t, g, r, "corruption-spreads")
			}
		},
		want: func(t *testing.T, g *Game, c arc.Candidate) {
			if src, _ := c.Cast.Get("source"); src != arc.RegionRef(1) || !slices.Contains(c.Regions, 0) || !slices.Contains(c.Regions, 11) {
				t.Fatalf("the front's source %s over %v", src, c.Regions)
			}
		},
		after: func(t *testing.T, g *Game, end tplEnd) {
			if end.won != "" {
				return
			}
			i := slices.IndexFunc(g.Story.Spreads, func(s Spread) bool { return s.Arc == end.a.ID })
			if i < 0 || g.Story.Spreads[i].Region != 1 {
				t.Fatalf("the lapsed front does not spread: %+v", g.Story.Spreads)
			}
			ns := g.World.Regions[1].Neighbours
			count := func() int {
				n := 0
				for _, f := range g.Log.Since(end.ended.ID) {
					r, _ := world.ParseRegionRef(f.Region)
					if d, _ := f.Get("by"); f.Kind == "region.gauge-moved" && hasDatum(f, "gauge", "corruption") && d.N == p.FrontSpread && slices.Contains(ns, r) {
						n++
					}
				}
				return n
			}
			tplDays(t, g, p.FrontSpreadDays+1)
			if got := count(); int64(got) != p.FrontSpreadDays {
				t.Fatalf("the front spread %d times, not front-spread-days %d", got, p.FrontSpreadDays)
			}
			if slices.ContainsFunc(g.Story.Spreads, func(s Spread) bool { return s.Arc == end.a.ID }) {
				t.Fatal("a spread outlives its days")
			}
		}})
}

func tplDays(t *testing.T, g *Game, days int64) {
	t.Helper()
	for range days * sheets.TicksPerDay {
		dirTick(t, g)
	}
}

// tplRivalState: two guild-run places of different guilds near each other,
// each raising a structure lately; the first settlement is keeper-run and
// raised one too, and takes no part.
func tplRivalState(t *testing.T, g *Game) {
	t.Helper()
	from := g.SettlementHex(0)
	var sites []hex.Hex
	for _, h := range hex.DiscAt(from, 6) {
		b := g.r.Gen.Baseline(h)
		if hex.Distance(h, from) < 3 || b.Site != "" || !g.r.Gen.Passable(b.Terrain) || g.IsSettlement(h) {
			continue
		}
		if len(sites) == 0 || hex.Distance(sites[0], h) >= 3 {
			sites = append(sites, h)
		}
		if len(sites) == 2 {
			break
		}
	}
	if len(sites) < 2 {
		t.Fatal("no two free tiles near the first settlement")
	}
	for i, h := range sites {
		p := &Place{N: len(g.Places), Hex: h, Lattice: -1, Founded: g.Tick(), Guild: fmt.Sprintf("g-rival-%d", i), Name: fmt.Sprintf("Rival %d", i)}
		for j, st := range g.r.Book.Starting {
			if i == 1 && j > 2 {
				break
			}
			p.Structures = append(p.Structures, tplStructure(g, st.Structure, st.Tier))
		}
		g.Places = append(g.Places, p)
	}
	g.Places[0].Structures[0].Built = g.Tick()
}

func TestTemplateRivalSeat(t *testing.T) {
	tplRun(t, tplSpec{id: "the-rival-seat", by: ByDirector, setup: tplRivalState,
		want: func(t *testing.T, g *Game, c arc.Candidate) {
			a, _ := c.Cast.Get("seat-a")
			b, _ := c.Cast.Get("seat-b")
			if a != arc.SettlementRef(1) || b != arc.SettlementRef(2) {
				t.Fatalf("the rival seat casts %s against %s", a, b)
			}
		}})
}

// TestTemplateRivalSeatNeedsTwoGuilds: a keeper-run place, a ruin or two
// places of one guild are never rivals.
func TestTemplateRivalSeatNeedsTwoGuilds(t *testing.T) {
	g := tplGame(t)
	tplRivalState(t, g)
	tpl, _ := g.template("the-rival-seat")
	busy := func() []arc.Candidate { return tpl.When(g.storyView(), tpl.Row, g.r.Story) }
	for _, c := range busy() {
		for _, b := range c.Cast {
			if b.Ref == arc.SettlementRef(0) {
				t.Fatalf("a keeper-run place is cast as a rival: %+v", c.Cast)
			}
		}
	}
	g.Places[2].Guild = g.Places[1].Guild
	if cs := busy(); len(cs) != 0 {
		t.Fatalf("one guild's two places are rivals: %+v", cs)
	}
	g.Places[2].Guild = "g-other"
	g.Places[2].Ruined = g.Tick()
	if cs := busy(); len(cs) != 0 {
		t.Fatalf("a ruin is a rival: %+v", cs)
	}
}

func TestTemplateDefector(t *testing.T) {
	tplRun(t, tplSpec{id: "the-defector", by: ByDirector,
		setup: func(t *testing.T, g *Game) {
			g.World.Factions[0].Notables[1].Loyalty = 20
			g.World.Factions[2].Disposition[0] = -30
		},
		pick: func(g *Game, c arc.Candidate) bool {
			ref, _ := c.Cast.Get("faction")
			return ref == arc.FactionRef(0)
		},
		want: func(t *testing.T, g *Game, c arc.Candidate) {
			n, _ := c.Cast.Get("notable")
			rival, _ := c.Cast.Get("rival")
			if n.ID != notableID(g.World.Factions[0].Notables[1].ID) || rival != arc.FactionRef(2) {
				t.Fatalf("the defector casts %s toward %s", n, rival)
			}
		},
		after: func(t *testing.T, g *Game, end tplEnd) {
			if end.won != "shelter-them" {
				return
			}
			if fi, _ := g.notableFaction(tplNotable(t, end.a, "notable")); fi != 2 {
				t.Fatalf("the sheltered notable serves %d, not the rival", fi)
			}
		}})
}

func TestTemplateGrudge(t *testing.T) {
	tplRun(t, tplSpec{id: "the-grudge", by: ByDirector,
		setup: func(t *testing.T, g *Game) {
			g.World.Factions[0].Grudge[1] = 20
			tplRemember(t, g, g.regionHex(g.World.Factions[1].Seat), "faction.betrayed", []fact.Ref{arc.FactionRef(1), arc.FactionRef(0)})
		},
		want: func(t *testing.T, g *Game, c arc.Candidate) {
			b, _ := c.Cast.Get("betrayer")
			w, _ := c.Cast.Get("wronged")
			if b != arc.FactionRef(1) || w != arc.FactionRef(0) || c.Pressure != 20 || len(c.Causes) != 1 {
				t.Fatalf("the grudge of %s against %s at %d", w, b, c.Pressure)
			}
		},
		after: func(t *testing.T, g *Game, end tplEnd) {
			if end.won == "broker-peace" && g.World.Factions[0].Grudge[1] != 0 {
				t.Fatal("the brokered peace left the grudge")
			}
		}})
}

func TestTemplateOverrun(t *testing.T) {
	tplRun(t, tplSpec{id: "the-overrun", by: ByDirector,
		setup: func(t *testing.T, g *Game) {
			tplGauge(t, g, 1, "threat", 950)
			tplLine(t, g, 1, "threat-overrun")
		},
		want: func(t *testing.T, g *Game, c arc.Candidate) {
			if front, _ := c.Cast.Get("front"); front != arc.RegionRef(1) || !slices.Contains(c.Regions, 0) {
				t.Fatalf("the overrun's front %s over %v", front, c.Regions)
			}
		}})
}

func TestTemplateDrySeam(t *testing.T) {
	tplRun(t, tplSpec{id: "the-dry-seam", by: ByDirector,
		setup: func(t *testing.T, g *Game) {
			tplGauge(t, g, 0, "scarcity", 750)
			tplLine(t, g, 0, "scarcity-yields")
		},
		want: func(t *testing.T, g *Game, c arc.Candidate) {
			if front, _ := c.Cast.Get("front"); front != arc.RegionRef(0) {
				t.Fatalf("the dry seam's front is %s", front)
			}
			if seat, _ := c.Cast.Get(seatRole); seat != arc.SettlementRef(0) {
				t.Fatalf("the dry seam's seat is %s", seat)
			}
		}})
}

// TestTemplatesCastByTheDirector: with no hand on it, the director casts
// the siege as the season's world arc in the rising band, and the overrun
// into a free region slot, from their predicates' state.
func TestTemplatesCastByTheDirector(t *testing.T) {
	g := tplGame(t)
	tplSiegeState(t, g)
	tplGauge(t, g, 1, "threat", 950)
	tplLine(t, g, 1, "threat-overrun")
	tplQuiet(g)
	var siege, overrun *Arc
	for day := 0; day < 12 && (siege == nil || overrun == nil); day++ {
		tplDays(t, g, 1)
		tplGauge(t, g, 1, "threat", 950)
		tplLine(t, g, 1, "threat-overrun")
		for _, a := range g.Story.Arcs {
			switch {
			case a.Template == "the-siege" && siege == nil:
				siege = a
			case a.Template == "the-overrun" && overrun == nil:
				overrun = a
			}
		}
	}
	if siege == nil || siege.By != ByDirector {
		t.Fatalf("the director cast no siege: %+v", siege)
	}
	if _, tb, _ := g.Season(); tb.At(siege.Began/sheets.TicksPerDay+1).Band != "rising" {
		t.Fatalf("the siege was cast outside the rising band, at %d", siege.Began)
	}
	if front, _ := overrun.Cast.Get("front"); overrun.By != ByDirector || front != arc.RegionRef(1) {
		t.Fatalf("the director cast no overrun: %+v", overrun)
	}
	audit(t, g)
}

func tplStructure(g *Game, kind string, tier int64) settle.Structure {
	return settle.Structure{Kind: kind, Tier: tier, Condition: g.r.Settle.ConditionMax, Built: g.Tick(), Used: g.Tick()}
}
