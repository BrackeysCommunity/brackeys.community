package game

import (
	"fmt"
	"slices"
	"strings"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
)

// CityRaise posts the project that raises the settlement an officer of
// its running guild stands in to a city (GDD 4.8).
const CityRaise = "city-raise"

// Refusals of a city's raise.
const (
	CityNotReady = "city-not-ready"
	AlreadyCity  = "already-city"
	ProjectOpen  = "project-open"
	Ruined       = "ruined"
)

// What a city needs, each read by CityCheck.
const (
	NeedSize      = "size"
	NeedStanding  = "standing"
	NeedWorks     = "works"
	NeedResources = "resources"
	NeedCoin      = "coin"
	NeedTiles     = "tiles"
)

// structural: the units CityCheck counts each need in, and how a city
// project's goals are named.
const (
	unitCharacters = "characters"
	unitDays       = "days"
	unitWorks      = "works"
	unitGoods      = "goods"
	unitCoin       = "coin"
	unitTiles      = "tiles"
	cityPrefix     = "city-"
	cityStructure  = "city"
	tagMetal       = "metal"
)

// CityNeed is one of the city's requirements as it stands.
type CityNeed struct {
	ID   string
	Have int64
	Need int64
	Unit string
	Met  bool
}

// cityRaise posts the city project: one pooled settlement goal for each of
// its timber, stone and metal, with an optional reward per goal from the
// treasury, as a raise is posted. The works and the outer tiles must
// already hold; size, standing, the goods and the coin are read when the
// city lands.
func (g *Game) cityRaise(c *Char, cmd Command) error {
	if p := g.PlaceAt(c.C.At); p != nil && p.Ruined != 0 {
		return refuse(Ruined, "nobody raises a city on a ruin")
	}
	_, p, err := g.officerHere(c, "raises a city")
	if err != nil {
		return err
	}
	switch {
	case p.City != nil:
		return refuse(AlreadyCity, "this settlement is already a city")
	case g.cityProject(p.N) != "":
		return refuse(ProjectOpen, "the city project here is already open")
	}
	var short []string
	for _, nd := range g.CityCheck(p.N) {
		if (nd.ID == NeedWorks || nd.ID == NeedTiles) && !nd.Met {
			short = append(short, fmt.Sprintf("%s %d of %d", nd.ID, nd.Have, nd.Need))
		}
	}
	if len(short) > 0 {
		return refuse(CityNotReady, "a city project waits on %s", strings.Join(short, ", "))
	}
	plan := &raisePlan{settlement: p.N, structure: cityStructure}
	for _, l := range g.cityLines() {
		x, err := g.draft(c, GoalSpec{Title: "City: " + l.Tag, Issuer: goal.ByAdmin, Mode: goal.Pooled, Lifetime: goal.Season, Turnover: goal.Keep,
			Cond: goal.Condition{Verb: goal.Deliver, Tag: l.Tag, Count: l.Quantity, At: goal.SettlementRef(p.N)}})
		if err != nil {
			return err
		}
		plan.drafts = append(plan.drafts, x)
	}
	if err := g.rewardRaise(c, plan, cmd.Price); err != nil {
		return err
	}
	project := ""
	for i, x := range plan.drafts {
		if err := g.open(c, x, ledger.SubKey(cmd.Key, itoa(i))); err != nil {
			return err
		}
		if project == "" {
			project = cityPrefix + x.ID
		}
		x.Build = &goal.Build{Settlement: p.N, Project: project}
	}
	_, err = g.factWith(c, []fact.Ref{arc.SettlementRef(p.N)}, "city.project", g.Tick(),
		append([]fact.Datum{fact.S("project", project), fact.N("settlement", int64(p.N))}, fact.At(p.Hex)...)...)
	return err
}

// cityLines are the goods a city project asks.
func (g *Game) cityLines() []sheets.CostLine {
	return []sheets.CostLine{{Tag: tagTimber, Quantity: g.sp("city-timber")}, {Tag: tagStone, Quantity: g.sp("city-stone")},
		{Tag: tagMetal, Quantity: g.sp("city-metal")}}
}

// isCityLine reports whether a goal is a line of a settlement's city
// project.
func isCityLine(x *Goal, n int) bool {
	return x.Build != nil && x.Build.Settlement == n && x.Build.Structure == "" && strings.HasPrefix(x.Build.Project, cityPrefix)
}

// cityProject is the city project running at place n: its newest, while
// none of its lines has ended and it has not landed; "" when none runs. A
// line's Build.Tier is 1 once its city has landed, so a city that fell
// back needs a new project.
func (g *Game) cityProject(n int) string {
	project := ""
	for _, x := range slices.Backward(g.Goals) {
		if isCityLine(x, n) {
			if x.Build.Tier == 0 {
				project = x.Build.Project
			}
			break
		}
	}
	if project == "" {
		return ""
	}
	for _, x := range g.Goals {
		if x.Build != nil && x.Build.Project == project && x.State == goal.Ended {
			return ""
		}
	}
	return project
}

// CityCheck is how place n stands on each of a city's needs: its active
// visitors, its region's prosperity streak, its wall and stations, the
// project's goods, the treasury's coin and the six outer tiles.
func (g *Game) CityCheck(n int) []CityNeed {
	if n < 0 || n >= len(g.Places) {
		return nil
	}
	return g.cityNeeds(n, g.storyView().placeUsers())
}

func (g *Game) cityNeeds(n int, users []int64) []CityNeed {
	p := g.Places[n]
	need := func(id, unit string, have, want int64) CityNeed {
		return CityNeed{ID: id, Have: have, Need: want, Unit: unit, Met: have >= want}
	}
	var u int64
	if n < len(users) {
		u = users[n]
	}
	var prosper int64
	if st := g.streakOf(g.World.RegionAt(p.Hex)); st != nil {
		prosper = st.Prosper
	}
	works := need(NeedWorks, unitWorks, g.cityWorks(p), 1+g.sp("city-stations"))
	goods := CityNeed{ID: NeedResources, Unit: unitGoods}
	project := g.cityProject(n)
	met := project != ""
	for _, l := range g.cityLines() {
		goods.Need += l.Quantity
	}
	for _, x := range g.Goals {
		if project == "" || x.Build == nil || x.Build.Project != project {
			continue
		}
		goods.Have += min(x.Total(), x.Cond.Count)
		met = met && x.State == goal.Done
	}
	goods.Met = met
	tiles, _ := g.cityTiles(p)
	return []CityNeed{
		need(NeedSize, unitCharacters, u, g.sp("city-users")),
		need(NeedStanding, unitDays, prosper, g.sp("city-prosperity-days")),
		works,
		goods,
		need(NeedCoin, unitCoin, g.Ledger.Of(TreasuryPool(n), ledger.Coin), g.sp("city-coin")),
		need(NeedTiles, unitTiles, int64(len(tiles)), int64(hex.Directions)),
	}
}

// cityWorks counts the works a city stands on, up to what it needs: an open
// wall of the city's tier, and open stations at the city's station tier.
func (g *Game) cityWorks(p *Place) int64 {
	var n int64
	if w := p.Get(structureWall); w != nil && !w.Closed() && w.Tier >= g.sp("city-wall-tier") {
		n++
	}
	var stations int64
	for _, st := range p.Structures {
		if row := g.r.structures[st.Kind]; row != nil && row.Station && !st.Closed() && st.Tier >= g.sp("city-station-tier") {
			stations++
		}
	}
	return n + min(stations, g.sp("city-stations"))
}

// cityTiles are a place's neighbours a city may claim, and whether all six
// are: free, passable ground that is no settlement, ruin, pattern point,
// pinned slot or other city's.
func (g *Game) cityTiles(p *Place) ([]hex.Hex, bool) {
	var out []hex.Hex
	for d := range hex.Directions {
		if h := p.Hex.Neighbour(d); g.claimable(h, p.N) {
			out = append(out, h)
		}
	}
	return out, len(out) == hex.Directions
}

// claimable reports whether a tile is free for a city of place n to claim
// or a faction city to stand on: a ruin keeps its place, so it is a
// settlement too.
func (g *Game) claimable(h hex.Hex, n int) bool {
	if !g.freeGround(h) || g.IsSettlement(h) || g.World.ReserveAt(h) != nil {
		return false
	}
	if g.Story != nil && slices.ContainsFunc(g.Story.Patterns, func(b *Board) bool { return slices.Contains(b.Points, h) }) {
		return false
	}
	return !slices.ContainsFunc(g.Places, func(q *Place) bool { return q.N != n && q.City != nil && slices.Contains(q.City.Tiles, h) })
}

// citiesDay lands each city whose five needs and tiles all hold today, the
// treasury paying the city's coin into the works, and notes each city that
// kept its visitors today.
func (g *Game) citiesDay(day int64) error {
	if g.Story == nil {
		return nil
	}
	users := g.storyView().placeUsers()
	for n, p := range g.Places {
		if p.Ruined != 0 || p.Faction != nil {
			continue
		}
		if p.City == nil {
			if err := g.landCity(n, day, users); err != nil {
				return err
			}
		}
	}
	g.keepDay()
	return nil
}

// keepDay notes each standing city that kept its visitors today.
func (g *Game) keepDay() {
	users := g.storyView().placeUsers()
	for n, p := range g.Places {
		if p.Ruined != 0 || p.Faction != nil || p.City == nil || n >= len(users) || users[n] < g.sp("city-keep") {
			continue
		}
		if ps := g.placeStory(n); ps != nil {
			ps.Kept = true
		}
	}
}

// landCity raises place n to a city if its project is met and every need
// holds.
func (g *Game) landCity(n int, day int64, users []int64) error {
	project := g.cityProject(n)
	if project == "" {
		return nil
	}
	for _, nd := range g.cityNeeds(n, users) {
		if !nd.Met {
			return nil
		}
	}
	p := g.Places[n]
	tiles, _ := g.cityTiles(p)
	coin := g.sp("city-coin")
	if err := g.post(ledger.Move(ledger.SubKey("city", i64(day), itoa(n)), "city", g.Tick(), TreasuryPool(n), ledger.ToBuild, ledger.Coin, coin)); err != nil {
		return err
	}
	p.City = &settle.City{Raised: g.Tick(), Tiles: tiles, Project: project}
	for _, x := range g.Goals {
		if x.Build != nil && x.Build.Project == project {
			x.Build.Tier = 1
		}
	}
	_, err := g.worldFact(p.Hex, "city.raised", []fact.Ref{arc.SettlementRef(n)}, nil,
		append([]fact.Datum{fact.S("project", project), fact.N("coin", coin), fact.N("settlement", int64(n))}, fact.At(p.Hex)...)...)
	return err
}

// citiesClose turns back each city whose visitors never reached city-keep
// on any day of the closing season: stations above a settlement's tier
// drop to it, nothing is refunded and the tiles go free. Every city starts
// the next season unkept.
func (g *Game) citiesClose() error {
	if g.Story == nil {
		return nil
	}
	for n, p := range g.Places {
		if p.City == nil || p.Ruined != 0 {
			continue
		}
		if ps := g.storyAt(n); ps != nil && ps.Kept {
			continue
		}
		for i := range p.Structures {
			st := &p.Structures[i]
			if row := g.r.structures[st.Kind]; row != nil && row.Station {
				st.Tier = min(st.Tier, settle.Cap(row, g.r.Settle))
			}
		}
		if err := g.holdDen(n, g.Tick()); err != nil {
			return err
		}
		p.City = nil
		if _, err := g.worldFact(p.Hex, "city.fell-back", []fact.Ref{arc.SettlementRef(n)}, nil,
			append([]fact.Datum{fact.N("settlement", int64(n))}, fact.At(p.Hex)...)...); err != nil {
			return err
		}
	}
	for i := range g.Story.At {
		g.Story.At[i].Kept = false
	}
	return nil
}

// isCity reports whether place n is a standing city: raised by its guild,
// or a faction's own.
func (g *Game) isCity(n int) bool {
	if n < 0 || n >= len(g.Places) {
		return false
	}
	p := g.Places[n]
	return p.Ruined == 0 && (p.City != nil || p.Faction != nil)
}

// bookShare is the percent of its usual kinds place n's market book holds:
// a city's is wider.
func (g *Game) bookShare(n int) int64 {
	if g.isCity(n) {
		return g.sp("city-book-share")
	}
	return fixed.Hundredths
}
