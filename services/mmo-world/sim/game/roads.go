package game

import (
	"maps"
	"slices"

	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/guild"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// Roads (GDD 3.4, 13.2): a tile walked enough becomes a road tile, which
// joins the road beside it or starts a named road of its own. An open road
// takes one tick to enter whatever the ground, a patrolled one is safer, a
// tolled one costs coin, and a raid cuts a region's roads for days. A road
// never fades; a cut only shuts it for a while.

// Facts of roads.
const (
	factRoadGrew     = "road.grew"
	factRoadCut      = "road.cut"
	factRoadTollPaid = "road.toll-paid"
	factRaided       = "faction.raided"
	factPatrolled    = "faction.patrolled"
)

// structural: the datum a road laid by a solved pattern carries, the why
// part a road's cost shows, and the ledger kind of a toll.
const (
	datumVia   = "via"
	viaPattern = "pattern"
	partRoad   = "road"
	tollKind   = "toll"
)

// roadHold is a hold a road can be put under: the fact that announces it
// ("" for a patrol, which announces nothing), how it keeps the later
// until, its default days cell, and whether it names the toll's coin.
type roadHold struct {
	kind string
	set  func(*emerge.RoadRec, int64)
	days func(emerge.Params) int64
	coin bool
}

var (
	holdToll = roadHold{
		kind: factRoadTolled,
		set:  func(r *emerge.RoadRec, u int64) { r.TollUntil = max(r.TollUntil, u) },
		days: func(p emerge.Params) int64 { return p.TollDays },
		coin: true,
	}
	holdCut = roadHold{
		kind: factRoadCut,
		set:  func(r *emerge.RoadRec, u int64) { r.CutUntil = max(r.CutUntil, u) },
		days: func(p emerge.Params) int64 { return p.CutDays },
	}
	holdPatrol = roadHold{
		set:  func(r *emerge.RoadRec, u int64) { r.PatrolUntil = max(r.PatrolUntil, u) },
		days: func(p emerge.Params) int64 { return p.PatrolDays },
	}
)

func init() {
	registerEmerge(emergeHook{
		Name:    "roads",
		Order:   roadsOrder,
		Kinds:   []string{factRaided, factPatrolled},
		Fact:    roadsFact,
		Instead: map[emerge.Type]func(*Game, *Promoting) (bool, error){emerge.Road: roadJoin},
		Promote: map[emerge.Type]func(*Game, *emerge.Promotion) error{emerge.Road: roadStart},
		Day:     roadsDay,
	})
}

// structural: roads run before the hooks that read them.
const roadsOrder = 10

// roadAt is the road a tile is part of, once the tile is a road.
func (g *Game) roadAt(h hex.Hex) (*emerge.RoadRec, bool) {
	if g.Emergence == nil {
		return nil, false
	}
	id := g.Emergence.Roads[h]
	if id == "" {
		return nil, false
	}
	if t := g.World.Tile(h); t == nil || t.Road < world.RoadTrack {
		return nil, false
	}
	rec := g.Emergence.RoadRecs[id]
	return rec, rec != nil
}

// tollDue reports whether a step onto the road pays a toll today.
func tollDue(rec *emerge.RoadRec, day int64) bool { return !rec.Cut(day) && rec.Tolled(day) }

// onRoad reports whether a tile is a road a step reads today: one the
// world holds and no raid has cut. A road with no record cannot be cut,
// and a world without emergence reads the tile alone.
func (g *Game) onRoad(h hex.Hex, day int64) bool {
	if t := g.World.Tile(h); t == nil || t.Road < world.RoadTrack {
		return false
	}
	if g.Emergence == nil {
		return true
	}
	rec := g.Emergence.RoadRecs[g.Emergence.Roads[h]]
	return rec == nil || !rec.Cut(day)
}

// roadPatrolled reports whether an open road tile is patrolled today.
func (g *Game) roadPatrolled(h hex.Hex, day int64) bool {
	rec, ok := g.roadAt(h)
	return ok && !rec.Cut(day) && rec.Patrolled(day)
}

// older reports whether road a was promoted before road b.
func (g *Game) older(a, b string) bool {
	pa, pb := g.Emergence.Promotion(a), g.Emergence.Promotion(b)
	if pa == nil || pb == nil {
		return pa != nil
	}
	return pa.Fact < pb.Fact
}

// roadFact writes a road's fact, dated no earlier than its cause, since a
// tick's journeys run before the clock moves.
func (g *Game) roadFact(kind string, h *hex.Hex, region int, subjects []fact.Ref, cause fact.ID, data ...fact.Datum) error {
	tick := g.Tick()
	var causes []fact.ID
	if f, ok := g.Log.Get(cause); ok && cause != 0 {
		tick = max(tick, f.Tick)
		causes = []fact.ID{cause}
	}
	ref := ""
	if region >= 0 {
		ref = world.RegionRef(region)
	}
	if h != nil {
		data = append(data, fact.At(*h)...)
	}
	f, err := g.r.weights.New(tick, kind, ref, subjects, causes, data...)
	if err != nil {
		return err
	}
	_, err = g.Log.Append(f)
	return err
}

// roadJoin takes a crossed road line over when the tile lies beside a
// road: it joins the oldest road beside it, and every other road there
// meets it and takes its name. A road the spiral lays is always its own.
func roadJoin(g *Game, p *Promoting) (bool, error) {
	if p.At == nil || datumOf(p.Data, datumVia) != "" {
		return false, nil
	}
	h := *p.At
	best := ""
	for _, n := range h.Neighbours() {
		if id := g.Emergence.Roads[n]; id != "" && g.Emergence.RoadRecs[id] != nil && (best == "" || g.older(id, best)) {
			best = id
		}
	}
	if best == "" {
		return false, nil
	}
	rec := g.Emergence.RoadRecs[best]
	g.layTile(h, rec, p.Cause)
	g.meet(h, rec)
	return true, g.roadFact(factRoadGrew, &h, g.World.RegionAt(h), []fact.Ref{promotionRef(best)}, p.Cause,
		fact.S("id", best), fact.S("name", g.promotionShown(best)))
}

// roadStart records a new road and lays its first tile.
func roadStart(g *Game, p *emerge.Promotion) error {
	rec := &emerge.RoadRec{ID: p.ID, Region: p.Region}
	g.Emergence.RoadRecs[p.ID] = rec
	if p.At != nil && g.Emergence.Roads[*p.At] == "" {
		g.layTile(*p.At, rec, p.Fact)
		g.meet(*p.At, rec)
	}
	return nil
}

// layTile makes a tile part of a road; the tile's road level is set when
// the world next advances.
func (g *Game) layTile(h hex.Hex, rec *emerge.RoadRec, cause fact.ID) {
	g.Emergence.Roads[h] = rec.ID
	rec.Tiles++
	g.Pending = append(g.Pending, world.Action{Kind: world.ActRoad, Hex: h, Units: world.RoadTrack, Cause: cause})
}

// meet joins h's road and every road beside it into the oldest of them,
// which keeps its name (GDD 13.2). Each younger road's tiles are found by
// walking it from h, so the cost is that road's length.
func (g *Game) meet(h hex.Hex, rec *emerge.RoadRec) {
	e := g.Emergence
	ids := []string{rec.ID}
	for _, n := range h.Neighbours() {
		if id := e.Roads[n]; id != "" && e.RoadRecs[id] != nil && !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	if len(ids) == 1 {
		return
	}
	keep := ids[0]
	for _, id := range ids[1:] {
		if g.older(id, keep) {
			keep = id
		}
	}
	into := e.RoadRecs[keep]
	for _, id := range ids {
		from := e.RoadRecs[id]
		if id == keep || from == nil {
			continue
		}
		into.Tiles += from.Tiles
		into.CutUntil = max(into.CutUntil, from.CutUntil)
		into.TollUntil = max(into.TollUntil, from.TollUntil)
		into.PatrolUntil = max(into.PatrolUntil, from.PatrolUntil)
		delete(e.RoadRecs, id)
		if e.Roads[h] == id {
			e.Roads[h] = keep
		}
		for walk := []hex.Hex{h}; len(walk) > 0; {
			at := walk[len(walk)-1]
			walk = walk[:len(walk)-1]
			for _, n := range at.Neighbours() {
				if e.Roads[n] == id {
					e.Roads[n] = keep
					walk = append(walk, n)
				}
			}
		}
	}
}

// layRoad lays a road along a path as one new road with its own promotion
// (GDD 4.13's road to the nearest settlement), named for the open
// settlement nearest its start. Tiles already on a road stay on theirs; the
// road stops where the path leaves the map.
func (g *Game) layRoad(path []hex.Hex, via string, cause fact.ID) error {
	e := g.Emergence
	if e == nil {
		return nil
	}
	if i := slices.IndexFunc(path, func(h hex.Hex) bool { return g.World.RegionAt(h) < 0 }); i >= 0 {
		path = path[:i]
	}
	free := slices.DeleteFunc(slices.Clone(path), func(h hex.Hex) bool { return e.Roads[h] != "" })
	if len(free) == 0 {
		return nil
	}
	at := free[0]
	pr := Promoting{Type: emerge.Road, Region: g.World.RegionAt(at), At: &at, Cause: cause, Data: []fact.Datum{fact.S(datumVia, via)}}
	if n, ok := g.nearestOpen(at); ok {
		pr.Places = []int{n}
	}
	p, err := g.promoteTrace(pr)
	if err != nil || p == nil {
		return err
	}
	for _, h := range free[1:] {
		rec := e.RoadRecs[e.Roads[at]]
		if rec == nil {
			return nil
		}
		g.layTile(h, rec, p.Fact)
		g.meet(h, rec)
	}
	return nil
}

// nearestOpen is the open settlement nearest a tile, the lowest index on a
// tie.
func (g *Game) nearestOpen(h hex.Hex) (int, bool) {
	best, far := -1, int64(0)
	for i, pl := range g.Places {
		if pl.Ruined != 0 {
			continue
		}
		if d := hex.Distance(pl.Hex, h); best < 0 || d < far {
			best, far = i, d
		}
	}
	return best, best >= 0
}

// patternRoad is the frontier spiral's opener: a road along the world's
// quickest walk from the pattern's centre toward the nearest open
// settlement, at most pattern-road-most tiles of it.
func (g *Game) patternRoad(b *Board, cause fact.ID) error {
	if g.Emergence == nil {
		return nil
	}
	n, ok := g.nearestOpen(b.Centre)
	if !ok {
		return nil
	}
	path, _, ok := g.World.Path(b.Centre, g.Places[n].Hex)
	if !ok {
		return nil
	}
	if most := g.r.Emerge.P.PatternRoadMost; int64(len(path)) > most {
		path = path[:most]
	}
	return g.layRoad(path, viaPattern, cause)
}

// toll charges a character stepping onto a tolled road tile, once a world
// day a road (GDD 12.9): toll-coin to the tolls sink, else one unit of the
// first goods it carries into the tile's spoils pool, else nothing.
func (g *Game) toll(c *Char, h hex.Hex, t int64) error {
	if g.Emergence == nil {
		return nil
	}
	day := t / sheets.TicksPerDay
	rec, ok := g.roadAt(h)
	if !ok || !tollDue(rec, day) || !g.Emergence.PayToll(c.C.ID, rec.ID, day) {
		return nil
	}
	key := ledger.SubKey(tollKind, c.C.ID, rec.ID, i64(day))
	coin := g.r.Emerge.P.TollCoin
	var data []fact.Datum
	switch i := slices.IndexFunc(c.C.Goods, func(s item.Spoil) bool { return s.Qty > 0 }); {
	case c.C.Coin >= coin:
		if err := g.receive(c, ledger.Move(key, tollKind, t, ledger.Char(c.C.ID), ledger.ToTolls, ledger.Coin, coin)); err != nil {
			return err
		}
		data = []fact.Datum{fact.N("coin", coin)}
	case i >= 0:
		m := c.C.Goods[i].Material
		if err := g.receive(c, ledger.Move(key, tollKind, t, ledger.Char(c.C.ID), poolOf(h), ledger.Goods(m), 1)); err != nil {
			return err
		}
		data = []fact.Datum{fact.S("material", m), fact.N("units", 1)}
	default:
		return nil
	}
	_, err := g.fact(c, factRoadTollPaid, t, append([]fact.Datum{fact.S("id", rec.ID)}, data...)...)
	return err
}

// roadsFact cuts a raided region's roads for cut-days (GDD 4.10), and
// marks a region a faction patrols as patrolled until the next day turn.
func roadsFact(g *Game, f fact.Fact) error {
	region, ok := world.ParseRegionRef(f.Region)
	if !ok {
		return nil
	}
	day := f.Tick / sheets.TicksPerDay
	switch f.Kind {
	case factPatrolled:
		return g.holdRoads(region, holdPatrol, day, day+1, 0, nil)
	case factRaided:
		return g.holdRoads(region, holdCut, day, day+g.r.Emerge.P.CutDays, f.ID, nil)
	}
	return nil
}

// holdRoads puts every road recorded in a region under a hold until a day.
func (g *Game) holdRoads(region int, h roadHold, day, until int64, cause fact.ID, subjects []fact.Ref) error {
	return g.holdIDs(region, g.regionRoads(region), h, day, until, cause, subjects)
}

// holdIDs puts the given roads under a hold in the order given, announcing it.
func (g *Game) holdIDs(region int, ids []string, h roadHold, day, until int64, cause fact.ID, subjects []fact.Ref) error {
	for _, id := range ids {
		h.set(g.Emergence.RoadRecs[id], until)
		if h.kind == "" {
			continue
		}
		data := []fact.Datum{fact.S("id", id), fact.S("name", g.promotionShown(id)), fact.N("days", until-day)}
		if h.coin {
			data = append(data, fact.N("coin", g.r.Emerge.P.TollCoin))
		}
		if err := g.roadFact(h.kind, nil, region, append([]fact.Ref{promotionRef(id)}, subjects...), cause, data...); err != nil {
			return err
		}
	}
	return nil
}

// regionRoads are the ids of the roads recorded in a region, sorted.
func (g *Game) regionRoads(region int) []string {
	var out []string
	for _, id := range slices.Sorted(maps.Keys(g.Emergence.RoadRecs)) {
		if g.Emergence.RoadRecs[id].Region == region {
			out = append(out, id)
		}
	}
	return out
}

// roadsDay marks the roads of each region a guild's patrol work keeps as
// patrolled until the next day turn.
func roadsDay(g *Game, day, _ int64) error {
	e := g.Emergence
	if len(e.RoadRecs) == 0 {
		return nil
	}
	kept := map[int]bool{}
	for _, gd := range g.Guilds {
		for _, w := range gd.G.Works {
			if row := g.r.works[w.ID]; row != nil && row.Gives == guild.GivesThreat && row.By > 0 && w.Settlement < len(g.Places) {
				kept[g.World.RegionAt(g.SettlementHex(w.Settlement))] = true
			}
		}
	}
	if len(kept) == 0 {
		return nil
	}
	byRegion := map[int][]string{}
	for _, id := range slices.Sorted(maps.Keys(e.RoadRecs)) {
		if r := e.RoadRecs[id].Region; kept[r] {
			byRegion[r] = append(byRegion[r], id)
		}
	}
	for _, region := range slices.Sorted(maps.Keys(byRegion)) {
		if err := g.holdIDs(region, byRegion[region], holdPatrol, day, day+1, 0, nil); err != nil {
			return err
		}
	}
	return nil
}
