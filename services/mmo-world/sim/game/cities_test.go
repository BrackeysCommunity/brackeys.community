package game

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
)

// cityServer is the server whose guild the city tests' officer and
// members play in.
const cityServer = "city-srv"

// cityMember is a new member of the city tests' server guild standing at h.
func cityMember(t *testing.T, g *Game, h hex.Hex) *Char {
	t.Helper()
	res, err := g.Act(Command{Key: fmt.Sprintf("city-member-%d", len(g.Chars)), Kind: Create, Option: "hook", Server: cityServer, Note: "The Builders"})
	if err != nil {
		t.Fatal(err)
	}
	res.Char.C.At = h
	return res.Char
}

// cityGame is a new world with a place its server guild founded on a tile
// whose six neighbours a city may claim, one of which takes a pin, with
// the works a city stands on: an open wall and three stations a tier up.
// Its officer stands there.
func cityGame(t *testing.T) (*Game, *Char, *Place) {
	t.Helper()
	g := storyGame(t)
	officer := cityMember(t, g, g.SettlementHex(0))
	gd := g.GuildOf(officer.C.Guild)
	if gd == nil || !gd.G.IsOfficer(officer.C.ID) {
		t.Fatal("the first member of a server guild is not its officer")
	}
	designer := world.PinBy{Role: world.PinDesigner}
	var at hex.Hex
	found := false
	for r := int64(4); r <= 40 && !found; r++ {
		for _, h := range hex.Ring(g.SettlementHex(0), r) {
			p := &Place{N: len(g.Places), Hex: h}
			if !g.claimable(h, -1) {
				continue
			}
			if _, all := g.cityTiles(p); !all {
				continue
			}
			if slices.ContainsFunc(hexNeighbours(h), func(nb hex.Hex) bool { return g.World.CheckPin(nb, 1, pinFix(g, nb), designer, false) == nil }) {
				at, found = h, true
				break
			}
		}
	}
	if !found {
		t.Fatal("no tile near the first settlement could hold a city")
	}
	p := &Place{N: len(g.Places), Hex: at, Lattice: -1, Name: "Testbury", Guild: gd.G.ID, Founded: g.Tick()}
	for _, row := range settle.Charter(g.r.Book.Structures) {
		p.Raise(row, g.Tick(), g.r.Settle)
	}
	for _, kind := range []string{structureWall, "still"} {
		p.Raise(g.r.structures[kind], g.Tick(), g.r.Settle)
	}
	for _, kind := range []string{"forge", "bench", "still"} {
		p.Get(kind).Tier = g.sp("city-station-tier")
	}
	g.Places = append(g.Places, p)
	if g.Market != nil {
		g.Market.Trader = append(g.Market.Trader, 0)
	}
	officer.C.At = at
	return g, officer, p
}

func hexNeighbours(h hex.Hex) []hex.Hex {
	out := make([]hex.Hex, hex.Directions)
	for d := range out {
		out[d] = h.Neighbour(d)
	}
	return out
}

// pinFix is a reserve a designer may stage on h.
func pinFix(g *Game, h hex.Hex) tile.Fix {
	if a := g.r.Gen.Archetypes(h); len(a) > 0 {
		return tile.Fix{Lead: a[len(a)-1]}
	}
	return tile.Fix{}
}

// cityUsers makes n characters active and visiting place n now.
func cityUsers(t *testing.T, g *Game, n int, count int64) []*Char {
	t.Helper()
	var out []*Char
	for i := range count {
		c := mustCreate(t, g, fmt.Sprintf("city-user-%d-%d", n, i), "knife")
		c.Acted = g.Tick()
		c.Visits = append(c.Visits, Visit{Settlement: n, Tick: g.Tick()})
		out = append(out, c)
	}
	return out
}

// setProsper sets a region's prosperity streak.
func setProsper(g *Game, r int, days int64) {
	i, ok := slices.BinarySearchFunc(g.Story.Streaks, r, streakRegion)
	if !ok {
		g.Story.Streaks = slices.Insert(g.Story.Streaks, i, Streak{Region: r})
	}
	g.Story.Streaks[i].Prosper = days
}

// fundTreasury moves coin into a place's treasury as an operator would.
func fundTreasury(t *testing.T, g *Game, n int, coin int64) {
	t.Helper()
	key := fmt.Sprintf("city-fund-%d-%d", n, g.Ledger.Posted)
	if err := g.post(ledger.Move(key, "test", g.Tick(), ledger.FromOperator, TreasuryPool(n), ledger.Coin, coin)); err != nil {
		t.Fatal(err)
	}
}

// cityLinesOf are a project's goals.
func cityLinesOf(g *Game, project string) []*Goal {
	var out []*Goal
	for _, x := range g.Goals {
		if x.Build != nil && x.Build.Project == project {
			out = append(out, x)
		}
	}
	return out
}

// deliverCity has a member bring every line of the project at place p.
func deliverCity(t *testing.T, g *Game, p *Place, project string) {
	t.Helper()
	d := cityMember(t, g, p.Hex)
	for i, x := range cityLinesOf(g, project) {
		m := materialTagged(t, g, x.Cond.Tag)
		dirGive(t, g, d, ledger.Material(m), x.Cond.Count)
		if _, err := g.Act(Command{Key: fmt.Sprintf("city-deliver-%d", i), Char: d.C.ID, Kind: DeliverGoal, Target: x.ID, Material: m, Units: x.Cond.Count}); err != nil {
			t.Fatal(err)
		}
	}
	dirTick(t, g)
	for _, x := range cityLinesOf(g, project) {
		if x.State != goal.Done {
			t.Fatalf("city line %s for %s is %s after its delivery", x.ID, x.Cond.Tag, x.State)
		}
	}
}

func materialTagged(t *testing.T, g *Game, tag string) string {
	t.Helper()
	for _, m := range g.r.Book.Materials {
		if slices.Contains(m.Tags, tag) {
			return m.ID
		}
	}
	t.Fatalf("no material tagged %s", tag)
	return ""
}

func raiseCity(g *Game, c *Char, key string) error {
	return g.cityRaise(c, Command{Key: key, Char: c.C.ID, Kind: CityRaise})
}

// refusedCity raises a city that must be refused with code, changing
// nothing; it returns the refusal's message.
func refusedCity(t *testing.T, g *Game, c *Char, code string) string {
	t.Helper()
	before := digestOf(t, g)
	err := raiseCity(g, c, fmt.Sprintf("city-refused-%d", g.Log.Len()))
	var r *Refused
	if !errors.As(err, &r) || r.Code != code {
		t.Fatalf("a city raise gave %v, not %s", err, code)
	}
	if digestOf(t, g) != before {
		t.Fatalf("a city raise refused %s changed the game", code)
	}
	return r.Msg
}

// readyCity is cityGame with the project posted and met, the visitors,
// the prosperity and the coin a city needs: everything but the day it
// lands.
func readyCity(t *testing.T) (*Game, *Char, *Place, string) {
	t.Helper()
	g, officer, p := cityGame(t)
	if err := raiseCity(g, officer, "city-raise"); err != nil {
		t.Fatal(err)
	}
	project := g.cityProject(p.N)
	if project == "" || len(cityLinesOf(g, project)) != 3 || len(factsOf(g, "city.project")) != 1 {
		t.Fatalf("the city project is %q with %d lines", project, len(cityLinesOf(g, project)))
	}
	cityUsers(t, g, p.N, g.sp("city-users"))
	setProsper(g, g.World.RegionAt(p.Hex), g.sp("city-prosperity-days"))
	fundTreasury(t, g, p.N, g.sp("city-coin"))
	return g, officer, p, project
}

// TestCityLandsOnlyWithAllFive: the city waits for its goods, then for
// each of its visitors, its region's prosperity, its works, its coin and
// its tiles in turn, and lands the day all hold: the coin is paid into
// the works, the tiles are claimed and its stations rise past a
// settlement's tier.
func TestCityLandsOnlyWithAllFive(t *testing.T) {
	g, officer, p, project := readyCity(t)
	n := p.N
	day := g.Tick() / sheets.TicksPerDay
	landed := func() bool {
		t.Helper()
		if err := g.citiesDay(day); err != nil {
			t.Fatal(err)
		}
		return p.City != nil
	}
	if landed() {
		t.Fatal("a city landed before its goods came")
	}
	deliverCity(t, g, p, project)
	users := g.storyView().placeUsers()[n]
	var away []*Char
	for _, c := range g.Chars {
		if int64(len(away)) > users-g.sp("city-users") {
			break
		}
		if c.visitIndex(n) >= 0 {
			away = append(away, c)
		}
	}
	nb := p.Hex.Neighbour(0)
	breaks := []struct {
		need    string
		off, on func()
	}{
		{NeedSize, func() {
			for _, c := range away {
				c.Visits = slices.DeleteFunc(c.Visits, func(v Visit) bool { return v.Settlement == n })
			}
		}, func() {
			for _, c := range away {
				c.Visits = append(c.Visits, Visit{Settlement: n, Tick: g.Tick()})
			}
		}},
		{NeedStanding, func() { setProsper(g, g.World.RegionAt(p.Hex), g.sp("city-prosperity-days")-1) },
			func() { setProsper(g, g.World.RegionAt(p.Hex), g.sp("city-prosperity-days")) }},
		{NeedWorks, func() { p.Get(structureWall).Condition = 0 }, func() { p.Get(structureWall).Condition = g.r.Settle.ConditionMax }},
		{NeedCoin, func() {
			if err := g.post(ledger.Move("city-take", "test", g.Tick(), TreasuryPool(n), ledger.ToOperator, ledger.Coin, 1)); err != nil {
				t.Fatal(err)
			}
		}, func() { fundTreasury(t, g, n, 1) }},
		{NeedTiles, func() { g.Places = append(g.Places, &Place{N: len(g.Places), Hex: nb, Lattice: -1}) },
			func() { g.Places = g.Places[:len(g.Places)-1] }},
	}
	for _, b := range breaks {
		b.off()
		for _, nd := range g.CityCheck(n) {
			if nd.Met == (nd.ID == b.need) {
				t.Fatalf("with %s broken, %s reads met=%v (%d of %d)", b.need, nd.ID, nd.Met, nd.Have, nd.Need)
			}
		}
		if landed() {
			t.Fatalf("a city landed short of its %s", b.need)
		}
		b.on()
	}
	treasury, built := g.Ledger.Of(TreasuryPool(n), ledger.Coin), g.Ledger.Of(ledger.ToBuild, ledger.Coin)
	if !landed() {
		t.Fatalf("a city with every need met did not land: %+v", g.CityCheck(n))
	}
	coin := g.sp("city-coin")
	if g.Ledger.Of(TreasuryPool(n), ledger.Coin) != treasury-coin || g.Ledger.Of(ledger.ToBuild, ledger.Coin) != built+coin {
		t.Fatal("the city's coin did not go from the treasury into the works")
	}
	if len(p.City.Tiles) != hex.Directions || p.City.Project != project || len(factsOf(g, "city.raised")) != 1 {
		t.Fatalf("the city landed as %+v", p.City)
	}
	if ps := g.storyAt(n); ps == nil || !ps.Kept {
		t.Fatal("a city its visitors filled is not kept")
	}
	if g.cityProject(n) != "" || !g.isCity(n) || g.bookShare(n) != g.sp("city-book-share") {
		t.Fatal("a landed city still has a project, or reads as no city")
	}
	tier, _, ok := p.Next(g.r.structures["forge"], g.r.Settle)
	if !ok || tier != g.r.Settle.CityStationCap {
		t.Fatalf("a city's forge rises to tier %d (%v), not its cap %d", tier, ok, g.r.Settle.CityStationCap)
	}
	refusedCity(t, g, officer, AlreadyCity)
	audit(t, g)
}

// TestCityRaiseRefusals: a city's raise is refused, changing nothing, to
// anyone but an officer, short of works or tiles (a settlement, a pinned
// slot or a pattern's point beside it), on a ruin, on a city, and with a
// project open.
func TestCityRaiseRefusals(t *testing.T) {
	g, officer, p := cityGame(t)
	member := cityMember(t, g, p.Hex)
	before := digestOf(t, g)
	var r *Refused
	if err := raiseCity(g, member, "city-member-raise"); !errors.As(err, &r) || digestOf(t, g) != before {
		t.Fatalf("a member raised a city: %v", err)
	}
	if !g.CityCheck(p.N)[5].Met {
		t.Fatal("the test place's tiles are not all free")
	}
	nbs := hexNeighbours(p.Hex)
	g.Places = append(g.Places, &Place{N: len(g.Places), Hex: nbs[0], Lattice: -1})
	if msg := refusedCity(t, g, officer, CityNotReady); !strings.Contains(msg, "tiles 5 of 6") {
		t.Fatalf("a settlement beside it is refused as %q", msg)
	}
	g.Places = g.Places[:len(g.Places)-1]
	designer := world.PinBy{Role: world.PinDesigner}
	i := slices.IndexFunc(nbs, func(nb hex.Hex) bool { return g.World.CheckPin(nb, 1, pinFix(g, nb), designer, false) == nil })
	pin, err := g.World.Reserve(g.Log, nbs[i], 1, pinFix(g, nbs[i]), designer)
	if err != nil {
		t.Fatal(err)
	}
	if msg := refusedCity(t, g, officer, CityNotReady); !strings.Contains(msg, "tiles 5 of 6") {
		t.Fatalf("a pinned slot beside it is refused as %q", msg)
	}
	if _, err := g.World.Withdraw(g.Log, pin.ID); err != nil {
		t.Fatal(err)
	}
	g.Story.Patterns = append(g.Story.Patterns, &Board{ID: "placed-test", Points: []hex.Hex{nbs[1]}})
	refusedCity(t, g, officer, CityNotReady)
	g.Story.Patterns = nil
	wall := p.Get(structureWall)
	wall.Condition = 0
	if msg := refusedCity(t, g, officer, CityNotReady); !strings.Contains(msg, "works") {
		t.Fatalf("a closed wall is refused as %q", msg)
	}
	wall.Condition = g.r.Settle.ConditionMax
	p.Ruined = g.Tick() + 1
	refusedCity(t, g, officer, Ruined)
	p.Ruined = 0
	p.City = &settle.City{}
	refusedCity(t, g, officer, AlreadyCity)
	p.City = nil
	if err := raiseCity(g, officer, "city-raise"); err != nil {
		t.Fatal(err)
	}
	refusedCity(t, g, officer, ProjectOpen)
	// A project withdrawn ends every line, and a new one may be posted.
	lines := cityLinesOf(g, g.cityProject(p.N))
	if err := g.withdrawGoal(officer, Command{Key: "city-withdraw", Char: officer.C.ID, Kind: WithdrawGoal, Target: lines[0].ID}); err != nil {
		t.Fatal(err)
	}
	for _, x := range lines {
		if x.State != goal.Ended {
			t.Fatalf("a withdrawn city line %s is %s", x.ID, x.State)
		}
	}
	if g.cityProject(p.N) != "" {
		t.Fatal("a withdrawn project still runs")
	}
	if err := raiseCity(g, officer, "city-raise-again"); err != nil {
		t.Fatal(err)
	}
	audit(t, g)
}

// TestCityFallsBack: a city whose visitors never reached city-keep in a
// season falls back at its close: stations past a settlement's tier drop
// to it, nothing is refunded and the tiles go free; a kept city stays,
// and starts the next season unkept.
func TestCityFallsBack(t *testing.T) {
	g, _, p, project := readyCity(t)
	n := p.N
	deliverCity(t, g, p, project)
	if err := g.landCity(n, g.Tick()/sheets.TicksPerDay, g.storyView().placeUsers()); err != nil || p.City == nil {
		t.Fatalf("the city did not land: %v", err)
	}
	forge := p.Get("forge")
	forge.Tier = g.r.Settle.CityStationCap
	g.placeStory(n).Kept = true
	if err := g.citiesClose(); err != nil {
		t.Fatal(err)
	}
	if p.City == nil || g.storyAt(n).Kept {
		t.Fatal("a kept city fell back, or stayed kept into the next season")
	}
	built := g.Ledger.Of(ledger.ToBuild, ledger.Coin)
	treasury := g.Ledger.Of(TreasuryPool(n), ledger.Coin)
	if err := g.seasonClose(g.Tick()); err != nil {
		t.Fatal(err)
	}
	if p.City != nil || len(factsOf(g, "city.fell-back")) != 1 {
		t.Fatal("an unkept city did not fall back at the season's close")
	}
	if forge.Tier != settle.Cap(g.r.structures["forge"], g.r.Settle) {
		t.Fatalf("the forge stands at tier %d after the fall", forge.Tier)
	}
	if g.Ledger.Of(ledger.ToBuild, ledger.Coin) != built || g.Ledger.Of(TreasuryPool(n), ledger.Coin) != treasury {
		t.Fatal("a city falling back refunded something")
	}
	if g.isCity(n) || !g.CityCheck(n)[5].Met || g.cityProject(n) != "" {
		t.Fatal("a fallen city still reads as one, holds its tiles or keeps its old project")
	}
	audit(t, g)
}
