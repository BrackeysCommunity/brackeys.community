package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/class"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// lineOn holds a world.gauge-lines line on region r, with its gauge at v.
func lineOn(t *testing.T, g *Game, r int, id string, v int64) {
	t.Helper()
	li := slices.IndexFunc(g.r.Book.GaugeLines, func(l sheets.GaugeLine) bool { return l.ID == id })
	if li < 0 {
		t.Fatalf("no gauge line %q", id)
	}
	reg := &g.World.Regions[r]
	reg.Active[li] = true
	gaugeTo(t, g, r, g.r.Book.GaugeLines[li].Gauge, v)
}

func gaugeTo(t *testing.T, g *Game, r int, gauge string, v int64) {
	t.Helper()
	gi, ok := g.World.GaugeOf(gauge)
	if !ok {
		t.Fatalf("no gauge %q", gauge)
	}
	g.World.Regions[r].Gauge[gi] = v
}

func homeRegion(g *Game) int { return g.World.RegionAt(g.SettlementHex(0)) }

// predicateCast is what a trouble or occasion row's predicate finds at
// place n today.
func predicateCast(t *testing.T, g *Game, id string, n int) (arc.Template, arc.Candidate) {
	t.Helper()
	tpl, ok := g.template(id)
	if !ok {
		t.Fatalf("no template %q", id)
	}
	for _, c := range tpl.When(g.storyView(), tpl.Row, g.r.Story) {
		if c.Place == n {
			return tpl, c
		}
	}
	t.Fatalf("%s's predicate finds nothing at place %d", id, n)
	return tpl, arc.Candidate{}
}

// castTrouble casts what a trouble's predicate finds at place n.
func castTrouble(t *testing.T, g *Game, id string, n int) *Arc {
	t.Helper()
	tpl, c := predicateCast(t, g, id, n)
	a, err := g.castFrom(tpl, c, ByDirector, g.Tick())
	if err != nil {
		t.Fatal(err)
	}
	return a
}

// lastFact is the newest fact of a kind.
func lastFact(t *testing.T, g *Game, kind string) fact.Fact {
	t.Helper()
	fs := factsOf(g, kind)
	if len(fs) == 0 {
		t.Fatalf("no %s", kind)
	}
	return fs[len(fs)-1]
}

func datumS(f fact.Fact, key string) string {
	d, _ := f.Get(key)
	return d.S
}

// raiseWall builds the place's wall up to a tier.
func raiseWall(t *testing.T, g *Game, p *Place, tier int64) {
	t.Helper()
	row := g.r.structures[structureWall]
	for p.Get(structureWall) == nil || p.Get(structureWall).Tier < tier {
		if !p.Raise(row, g.Tick(), g.r.Settle) {
			t.Fatalf("the wall stops below tier %d", tier)
		}
	}
}

// troubleGuild is a guild of n characters at place 0, the founder holding
// ability of class cls when one is named.
func troubleGuild(t *testing.T, g *Game, n int, cls, ability string) (*Guild, []*Char) {
	t.Helper()
	cs := dirChars(t, g, n)
	gd := g.newGuild("", cs[0])
	for _, c := range cs[1:] {
		gd.G.Join(c.C.ID, g.Tick())
	}
	for _, c := range cs {
		c.C.Guild = gd.G.ID
	}
	if ability != "" {
		cs[0].C.Classes = class.State{Earned: []class.Earned{{ID: cls}}, Active: []string{cls}, Abilities: []string{ability}}
	}
	return gd, cs
}

// foundedPlace is a place the guild chartered on free ground near place 0.
func foundedPlace(t *testing.T, g *Game, gd *Guild) int {
	t.Helper()
	from := g.SettlementHex(0)
	for _, h := range hex.DiscAt(from, 8) {
		if hex.Distance(h, from) >= 4 && g.freeGround(h) && g.World.RegionAt(h) >= 0 {
			return charterAt(g, gd, h)
		}
	}
	t.Fatal("no free ground near the first settlement")
	return -1
}

// placeIn is a place the guild chartered on free ground in region r.
func placeIn(t *testing.T, g *Game, gd *Guild, r int) int {
	t.Helper()
	for _, h := range g.r.Gen.RegionTiles(g.World.Regions[r].Lattice) {
		if g.freeGround(h) && g.World.RegionAt(h) == r && g.PlaceAt(h) == nil {
			return charterAt(g, gd, h)
		}
	}
	t.Fatalf("no free ground in region %d", r)
	return -1
}

func charterAt(g *Game, gd *Guild, h hex.Hex) int {
	n := len(g.Places)
	p := &Place{N: n, Hex: h, Lattice: -1, Name: "Testhold", Guild: gd.G.ID, Founded: g.Tick()}
	for _, row := range settle.Charter(g.r.Book.Structures) {
		p.Raise(row, g.Tick(), g.r.Settle)
	}
	g.Places = append(g.Places, p)
	g.Market.Trader = append(g.Market.Trader, 0)
	return n
}

// troubleKind is how one trouble is brought on at place 0.
type troubleKind struct {
	id    string
	setup func(t *testing.T, g *Game)
}

var troubleKinds = []troubleKind{
	{"raid", func(t *testing.T, g *Game) { lineOn(t, g, homeRegion(g), "threat-raid", 850) }},
	{"fire", func(t *testing.T, g *Game) { lineOn(t, g, homeRegion(g), "unrest-fire", 750) }},
	{"corruption", func(t *testing.T, g *Game) {
		r := homeRegion(g)
		ns := slices.DeleteFunc(slices.Clone(g.World.Regions[r].Neighbours), func(n int) bool { return n == r })
		if len(ns) == 0 {
			t.Fatal("the first settlement's region has no neighbour")
		}
		lineOn(t, g, ns[0], "corruption-spreads", 600)
	}},
	{"shortage", func(t *testing.T, g *Game) { lineOn(t, g, homeRegion(g), "scarcity-yields", 720) }},
	{"sickness", func(t *testing.T, g *Game) {
		r := homeRegion(g)
		g.growStreak(r).Wet = g.r.Story.WetDays
		gaugeTo(t, g, r, "scarcity", g.r.Story.WetScarcity+1)
	}},
	{"panic", func(t *testing.T, g *Game) {
		r := homeRegion(g)
		for i := range g.World.Regions {
			if g.World.Regions[i].Holder == 0 {
				g.World.Regions[i].Holder = -1
			}
		}
		g.World.Regions[r].Holder = 0
		// Down to one holding after losing one: a fall names its holder last.
		id, err := g.worldFact(g.regionHex(r), "holding.fell", []fact.Ref{arc.FactionRef(1), arc.FactionRef(0)}, nil, fact.S("cause", "raid"))
		if err != nil {
			t.Fatal(err)
		}
		f, _ := g.Log.Get(id)
		g.Story.Memory = append(g.Story.Memory, g.memoryOf(f))
	}},
}

// TestTroubleEachKind: each trouble is cast from its predicate at the
// place its state names, with a mark and a goal; held, it writes
// trouble.held and its held effects; lost, trouble.lost, the first of its
// damages standing open worn by its row's amount, and its stakes.
func TestTroubleEachKind(t *testing.T) {
	for _, k := range troubleKinds {
		t.Run(k.id, func(t *testing.T) {
			row := troubleRow(t, k.id)
			held := guardGame(t)
			k.setup(t, held)
			a := castTrouble(t, held, k.id, 0)
			hold := sideNamed(t, a, sideHold)
			if hold.Mark < 1 || held.GoalOf(hold.Goal) == nil || lastFact(t, held, "trouble.started").Tick != held.Tick() {
				t.Fatalf("%s cast without its side: %+v", k.id, hold)
			}
			if k.id == "corruption" {
				src, _ := a.Cast.Get(roleSource)
				if r, _ := arc.RefIndex(src); r == homeRegion(held) || !slices.Equal(a.Regions, []int{r}) {
					t.Fatalf("corruption counts next door, not in %v from %s", a.Regions, src)
				}
			}
			before := len(held.Pending)
			if err := held.endStage(a, sideHold, held.Tick()); err != nil {
				t.Fatal(err)
			}
			if held.storyAt(0).Held != 1 || a.Outcome != sideHold || len(factsOf(held, "trouble.held")) != 1 {
				t.Fatalf("%s held: %+v", k.id, a)
			}
			if got, want := gaugeActs(held.Pending[before:]), gaugeEffects(row.Held); got != want {
				t.Fatalf("%s held queues %d gauge moves, its row %d", k.id, got, want)
			}
			audit(t, held)

			lost := guardGame(t)
			k.setup(t, lost)
			a = castTrouble(t, lost, k.id, 0)
			p := lost.Places[0]
			want := ""
			for _, s := range row.Damages {
				if p.Open(s) {
					want = s
					break
				}
			}
			before = len(lost.Pending)
			lose(t, lost, a)
			f := lastFact(t, lost, "structure.damaged")
			got := datumS(f, "structure")
			if want != "" && got != want {
				t.Fatalf("%s lost wore the %s, not the first of %v standing (%s)", k.id, got, row.Damages, want)
			}
			if want == "" && !lost.r.structures[got].Station {
				t.Fatalf("%s lost with none of %v standing wore the %s, not a station", k.id, row.Damages, got)
			}
			points := lost.r.Settle.TroubleDamage
			if amt := damageAmount(row.Lost); amt > 0 {
				points = amt
			}
			if st := p.Get(got); st.Condition != max(lost.r.Settle.ConditionMax-points, 0) {
				t.Fatalf("%s lost left the %s at %d", k.id, got, st.Condition)
			}
			if lost.storyAt(0).Lost != 1 || len(factsOf(lost, "trouble.lost")) != 1 {
				t.Fatalf("%s lost is not counted", k.id)
			}
			if got, want := gaugeActs(lost.Pending[before:]), gaugeEffects(row.Lost); got != want {
				t.Fatalf("%s lost queues %d gauge moves, its row %d", k.id, got, want)
			}
			ps, now := lost.storyAt(0), lost.Tick()
			for _, e := range row.Lost {
				until := now + e.Amount*sheets.TicksPerDay
				switch e.Kind {
				case effFees:
					if ps.Fees != until {
						t.Fatalf("raid fees run to %d, not %d", ps.Fees, until)
					}
				case effOrdersStop:
					if ps.Orders != until {
						t.Fatalf("panic stops orders to %d, not %d", ps.Orders, until)
					}
				case effPrices:
					if ps.Prices != until {
						t.Fatalf("shortage cuts prices to %d, not %d", ps.Prices, until)
					}
				case effSick:
					if ps.Sick != until {
						t.Fatalf("sickness runs to %d, not %d", ps.Sick, until)
					}
				}
			}
			audit(t, lost)
		})
	}
}

func troubleRow(t *testing.T, id string) sheets.TroubleRow {
	t.Helper()
	g := guardGame(t)
	for _, r := range g.r.Book.Troubles {
		if r.ID == id {
			return r
		}
	}
	t.Fatalf("no trouble %q", id)
	return sheets.TroubleRow{}
}

func gaugeActs(as []world.Action) int {
	n := 0
	for _, a := range as {
		if a.Kind == world.ActGauge {
			n++
		}
	}
	return n
}

func gaugeEffects(es []sheets.StoryEffect) int {
	n := 0
	for _, e := range es {
		if e.Kind == effGauge {
			n++
		}
	}
	return n
}

func damageAmount(es []sheets.StoryEffect) int64 {
	for _, e := range es {
		if e.Kind == effDamage {
			return e.Amount
		}
	}
	return 0
}

// TestTroubleCastHonoursItsChance: the director casts a trouble its
// predicate finds only on a day its trouble.start draw passes.
func TestTroubleCastHonoursItsChance(t *testing.T) {
	g := guardGame(t)
	lineOn(t, g, homeRegion(g), "threat-raid", 850)
	row := troubleRow(t, "raid")
	pass, fail := int64(-1), int64(-1)
	for d := int64(1); d < 64 && (pass < 0 || fail < 0); d++ {
		if g.r.draw.Percent(row.Chance, troubleDraw, draw.Int(0), draw.Str(row.ID), draw.Int(d)) {
			pass = max(pass, d)
		} else if fail < 0 {
			fail = d
		}
	}
	if pass < 0 || fail < 0 {
		t.Fatalf("the raid's chance of %d%% never passes or never fails", row.Chance)
	}
	raids := func() int {
		n := 0
		for _, a := range g.openArcs(arc.Settlement) {
			if a.Template == "raid" && a.Place == goal.SettlementRef(0) {
				n++
			}
		}
		return n
	}
	if err := g.castSettlements(g.storyView(), fail*sheets.TicksPerDay); err != nil || raids() != 0 {
		t.Fatalf("a failed draw cast %d raids: %v", raids(), err)
	}
	g.Story.Arcs = nil
	if err := g.castSettlements(g.storyView(), pass*sheets.TicksPerDay); err != nil || raids() != 1 {
		t.Fatalf("a passed draw cast %d raids: %v", raids(), err)
	}
}

// TestTroubleRaidHeldWhenItsBandIsSlain: a raid opens the raid-band hunt
// at its place, and bringing the band down holds it at the next tick.
func TestTroubleRaidHeldWhenItsBandIsSlain(t *testing.T) {
	g := guardGame(t)
	lineOn(t, g, homeRegion(g), "threat-raid", 850)
	a := castTrouble(t, g, "raid", 0)
	i := slices.IndexFunc(g.Hunts, func(x *Hunt) bool { return x.H.ID == a.Hunt })
	if a.Hunt == "" || i < 0 || g.Hunts[i].H.Row != "raid-band" || g.Hunts[i].Why != WhyTrouble {
		t.Fatalf("the raid opened no raid-band hunt: %q", a.Hunt)
	}
	g.Hunts[i].H.Slain = true
	if err := g.stagesDue("", g.Tick()); err != nil {
		t.Fatal(err)
	}
	if a.Outcome != sideHold || g.storyAt(0).Held != 1 || g.storyAt(0).Followed != 0 {
		t.Fatalf("a slain band holds the raid: %+v", a)
	}
	audit(t, g)
}

// TestTroubleDamageByType: a lost raid wears its wall first, then its
// market, then its forge, and with all three closed a station drawn.
func TestTroubleDamageByType(t *testing.T) {
	g := guardGame(t)
	p := g.Places[0]
	raiseWall(t, g, p, 1)
	for _, want := range []string{structureWall, structureMarket, "forge", ""} {
		g.Story.Arcs = nil
		a := troubleAt(t, g, "raid")
		lose(t, g, a)
		got := datumS(lastFact(t, g, "structure.damaged"), "structure")
		switch {
		case want == "" && !g.r.structures[got].Station:
			t.Fatalf("with wall, market and forge closed the raid wore the %s, not a station", got)
		case want != "" && got != want:
			t.Fatalf("the raid wore the %s, want the %s", got, want)
		}
		if want != "" {
			p.Get(want).Condition = 0
		}
	}
	audit(t, g)
}

// TestTroubleStewardSavesTheStructure: a Steward in the running guild
// spares the place a lost trouble's damage; without one it is worn.
func TestTroubleStewardSavesTheStructure(t *testing.T) {
	for _, steward := range []bool{true, false} {
		g := guardGame(t)
		ability := ""
		if steward {
			ability = "steward"
		}
		gd, _ := troubleGuild(t, g, 1, "reeve", ability)
		g.Places[0].Guild = gd.G.ID
		market := g.Places[0].Get(structureMarket).Condition
		lose(t, g, troubleAt(t, g, "shortage"))
		damaged := len(factsOf(g, "structure.damaged"))
		if got := g.Places[0].Get(structureMarket).Condition; steward != (got == market) || steward != (damaged == 0) {
			t.Fatalf("steward %v: the market went %d to %d, %d damaged", steward, market, got, damaged)
		}
		if g.storyAt(0).Lost != 1 {
			t.Fatal("a stewarded place still lost its trouble")
		}
	}
}

// TestTroubleRaidMarkWallCut: a raid's mark is its defence per user cut
// by the wall's tiers; a Bulwark at the place counts the wall a tier
// higher, to its top; a stocked wall takes its defence off the mark.
func TestTroubleRaidMarkWallCut(t *testing.T) {
	g := guardGame(t)
	gd, cs := troubleGuild(t, g, 10, "", "")
	p := g.Places[0]
	p.Guild = gd.G.ID
	for _, c := range cs {
		c.Visits = []Visit{{Settlement: 0, Tick: g.Tick()}}
	}
	lineOn(t, g, homeRegion(g), "threat-raid", 850)
	sp := g.r.Story
	users := g.storyView().placeUsers()[0]
	row := g.r.structures[structureWall]
	mark := func() int64 {
		t.Helper()
		g.Story.Arcs = nil
		a := castTrouble(t, g, "raid", 0)
		return sideNamed(t, a, sideHold).Mark
	}
	if got, want := mark(), arc.DefenceMark(7, users, sp.MarkFloorCharacters, 0, row.Per); got != want {
		t.Fatalf("an unwalled raid's mark %d, want %d", got, want)
	}
	raiseWall(t, g, p, 2)
	walled := arc.DefenceMark(7, users, sp.MarkFloorCharacters, 2, row.Per)
	if got := mark(); got != walled || walled >= arc.DefenceMark(7, users, sp.MarkFloorCharacters, 0, row.Per) {
		t.Fatalf("a tier-2 wall's mark %d, want %d", got, walled)
	}
	cs[1].C.Classes = class.State{Earned: []class.Earned{{ID: "warden"}}, Active: []string{"warden"}, Abilities: []string{"bulwark-wall"}}
	bulwark := arc.DefenceMark(7, users, sp.MarkFloorCharacters, 3, row.Per)
	if got := mark(); got != bulwark {
		t.Fatalf("a Bulwark's mark %d, want the tier-3 %d", got, bulwark)
	}
	raiseWall(t, g, p, row.MaxTier)
	if got := mark(); got != arc.DefenceMark(7, users, sp.MarkFloorCharacters, row.MaxTier, row.Per) {
		t.Fatalf("a Bulwark lifts the wall past its top: mark %d", got)
	}
	if !gd.G.Start("stocked-wall", 0, cs[0].C.ID, g.Tick()) {
		t.Fatal("the stocked wall does not start")
	}
	gd.G.Work("stocked-wall", 0).Days = 1
	if got, want := mark(), max(arc.DefenceMark(7, users, sp.MarkFloorCharacters, row.MaxTier, row.Per)-sp.StockedWallDefence, 1); got != want {
		t.Fatalf("a stocked wall's mark %d, want %d", got, want)
	}
}

// TestTroubleFireFollowsARaidThatGotIn: a raid lost sets the place's
// followed mark, and the fire's predicate finds the place the next day
// though it rests, naming the lost raid; a fire lost closes a station.
func TestTroubleFireFollowsARaidThatGotIn(t *testing.T) {
	g := guardGame(t)
	dirTick(t, g)
	if tpl, _ := g.template("fire"); len(tpl.When(g.storyView(), tpl.Row, g.r.Story)) != 0 {
		t.Fatal("a fire with no unrest and no raid")
	}
	from := fact.ID(g.Log.Len())
	lose(t, g, troubleAt(t, g, "raid"))
	g.keepNews(g.Log.Since(from))
	lostRaid := lastFact(t, g, "trouble.lost").ID
	if !g.storyView().Busy(arc.Settlement, arc.SettlementRef(0)) {
		t.Fatal("a lost raid does not rest its place")
	}
	_, c := predicateCast(t, g, "fire", 0)
	if !slices.Contains(c.Causes, lostRaid) {
		t.Fatalf("the fire names %v, not the raid %d", c.Causes, lostRaid)
	}
	a := castTrouble(t, g, "fire", 0)
	lose(t, g, a)
	f := lastFact(t, g, "structure.damaged")
	if st := g.Places[0].Get(datumS(f, "structure")); st == nil || !st.Closed() || !g.r.structures[st.Kind].Station {
		t.Fatalf("a lost fire leaves the %s open", datumS(f, "structure"))
	}
	audit(t, g)
}

// TestRaidWearsTheWallEachDay: while its region's raid line holds, a
// place's wall loses raid-damage a world day, or a station drawn when no
// wall stands; no line, no wear.
func TestRaidWearsTheWallEachDay(t *testing.T) {
	g := guardGame(t)
	gd, _ := troubleGuild(t, g, 1, "", "")
	p := g.Places[0]
	p.Guild = gd.G.ID
	raiseWall(t, g, p, 1)
	day := g.Tick()/sheets.TicksPerDay + 1
	if err := g.troubleDay(day); err != nil || len(factsOf(g, "structure.damaged")) != 0 {
		t.Fatalf("a quiet region wore the place: %v", err)
	}
	lineOn(t, g, homeRegion(g), "threat-raid", 850)
	full := g.r.Settle.ConditionMax
	for i := int64(1); i <= 2; i++ {
		if err := g.troubleDay(day + i); err != nil {
			t.Fatal(err)
		}
		if got := p.Get(structureWall).Condition; got != full-i*g.r.Settle.RaidDamage {
			t.Fatalf("day %d of raids left the wall at %d", i, got)
		}
	}
	if f := lastFact(t, g, "structure.damaged"); datumS(f, "by") != raidPart || datumS(f, "structure") != structureWall {
		t.Fatalf("raid wear: %+v", f)
	}
	p.Get(structureWall).Condition = 0
	if err := g.troubleDay(day + 3); err != nil {
		t.Fatal(err)
	}
	if kind := datumS(lastFact(t, g, "structure.damaged"), "structure"); !g.r.structures[kind].Station {
		t.Fatalf("with the wall down a raid wore the %s, not a station", kind)
	}
}

// TestKeeperMendHoldsTheirPlace: the keepers of a place nobody runs mend
// keeper-mend a day, so a raid's daily wear is made good, and a closed
// structure they reopen is a fact. A guild's place is not mended.
func TestKeeperMendHoldsTheirPlace(t *testing.T) {
	g := guardGame(t)
	day := g.Tick()/sheets.TicksPerDay + 1
	p := g.Places[0]
	p.Get("loom").Condition = 0
	if err := g.troubleDay(day); err != nil {
		t.Fatal(err)
	}
	if loom := p.Get("loom"); loom.Condition != g.r.Story.KeeperMend || len(factsOf(g, "structure.repaired")) != 1 {
		t.Fatalf("the keepers leave the loom at %d", loom.Condition)
	}
	p.Get("loom").Condition = g.r.Settle.ConditionMax
	lineOn(t, g, homeRegion(g), "threat-raid", 850)
	for i := range int64(5) {
		if err := g.troubleDay(day + 1 + i); err != nil {
			t.Fatal(err)
		}
	}
	if raids := len(factsOf(g, "structure.damaged")); raids != 5 {
		t.Fatalf("%d raid days wore the keepers' place", raids)
	}
	for _, st := range p.Structures {
		if st.Condition != g.r.Settle.ConditionMax {
			t.Fatalf("the keepers let the %s fall to %d", st.Kind, st.Condition)
		}
	}

	gd, _ := troubleGuild(t, g, 1, "", "")
	p.Guild = gd.G.ID
	p.Get("bench").Condition = 50
	if err := g.troubleDay(day + 7); err != nil {
		t.Fatal(err)
	}
	if got := p.Get("bench").Condition; got > 50 {
		t.Fatalf("a guild's place was mended to %d", got)
	}
}

// TestTroubleKeeperRunPlaceNeverRuins: a starting settlement, nobody's or
// a guild's, stands however many troubles it loses.
func TestTroubleKeeperRunPlaceNeverRuins(t *testing.T) {
	g := guardGame(t)
	for range g.r.Story.RuinTroubles + 2 {
		g.Story.Arcs = nil
		lose(t, g, troubleAt(t, g, "shortage"))
	}
	day := g.Tick()/sheets.TicksPerDay + 1
	if err := g.troubleDay(day); err != nil || g.Places[0].Ruined != 0 {
		t.Fatalf("a keeper-run place ruined after %d losses: %v", g.storyAt(0).Lost, err)
	}
	gd, _ := troubleGuild(t, g, 1, "", "")
	g.Places[0].Guild = gd.G.ID
	if err := g.troubleDay(day + 1); err != nil || g.Places[0].Ruined != 0 {
		t.Fatalf("a chartered starting settlement ruined: %v", err)
	}
}

// TestTroubleCharteredPlaceRuinsOnItsThirdLoss: a place a guild founded
// stands its first two lost troubles and falls on the third; its
// treasury goes to the guild and the ledger stays clean.
func TestTroubleCharteredPlaceRuinsOnItsThirdLoss(t *testing.T) {
	g := guardGame(t)
	gd, _ := troubleGuild(t, g, 1, "", "")
	n := foundedPlace(t, g, gd)
	if err := g.post(ledger.Move("test-treasury", "test", g.Tick(), ledger.FromFaction, TreasuryPool(n), ledger.Coin, 500)); err != nil {
		t.Fatal(err)
	}
	pool := g.Ledger.Of(gd.Pool(), ledger.Coin)
	day := g.Tick()/sheets.TicksPerDay + 1
	r := g.World.RegionAt(g.SettlementHex(n))
	for i := range g.r.Story.RuinTroubles {
		g.Story.Arcs = nil
		lose(t, g, dirCast(t, g, "shortage", arc.Cast{{Role: rolePlace, Ref: arc.SettlementRef(n)}, {Role: roleSource, Ref: arc.RegionRef(r)}}))
		if err := g.troubleDay(day + i); err != nil {
			t.Fatal(err)
		}
		if ruined := g.Places[n].Ruined != 0; ruined != (i+1 == g.r.Story.RuinTroubles) {
			t.Fatalf("after %d losses ruined is %v", i+1, ruined)
		}
	}
	if g.Ledger.Of(TreasuryPool(n), ledger.Coin) != 0 || g.Ledger.Of(gd.Pool(), ledger.Coin) != pool+500 {
		t.Fatalf("the ruin's treasury: %d left, guild %d", g.Ledger.Of(TreasuryPool(n), ledger.Coin), g.Ledger.Of(gd.Pool(), ledger.Coin))
	}
	if err := g.troubleDay(day + 9); err != nil || g.Places[n].Ruined == 0 {
		t.Fatalf("a ruin stands again: %v", err)
	}
	audit(t, g)
}
