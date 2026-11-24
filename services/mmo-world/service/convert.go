package service

import (
	"slices"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/render"
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// structural: what a score part and a region gauge count in.
const (
	unitPts   = "pts"
	unitGauge = "gauge"
)

// charName is a character's name as others see it.
func charName(g *game.Game, id string) string { return g.OwnerName(ledger.Char(id)) }

// heldGoods are the goods among an account's balances; coin is not one.
func heldGoods(held []ledger.Balance) []api.Goods {
	out := []api.Goods{}
	for _, h := range held {
		if m, ok := ledger.GoodsOf(h.Asset); ok {
			out = append(out, api.Goods{Material: m, Units: h.Units})
		}
	}
	return out
}

func apiLines(lines []sheets.CostLine) []api.CostLine {
	var out []api.CostLine
	for _, l := range lines {
		out = append(out, api.CostLine{Tag: l.Tag, Quantity: l.Quantity})
	}
	return out
}

func apiHex(h hex.Hex) api.Hex { return api.Hex{Q: h.Q, R: h.R} }
func simHex(h api.Hex) hex.Hex { return hex.Hex{Q: h.Q, R: h.R} }

func apiFloor(f market.Floor) api.Floor {
	return api.Floor{Durability: f.Durability, Trait: f.Trait, Level: f.Level}
}

func simFloor(f api.Floor) market.Floor {
	return market.Floor{Durability: f.Durability, Trait: f.Trait, Level: f.Level}
}

func apiParts(ps []game.Part) api.Why {
	out := api.Why{Parts: make([]api.Part, len(ps))}
	for i, p := range ps {
		out.Parts[i] = api.Part{Label: p.Label, Value: p.Value, Unit: p.Unit}
	}
	return out
}

// fightWhy is an option's why with its bands by name: the parts of its
// score, the rules that fired, and the band before and after them.
func fightWhy(g *game.Game, w fight.Why) api.Why {
	out := api.Why{BandFrom: g.BandName(w.BandFrom), BandTo: g.BandName(w.BandTo), Notes: w.Notes}
	for _, p := range w.Parts {
		out.Parts = append(out.Parts, api.Part{Label: p.Label, Value: p.Value, Unit: unitPts})
	}
	for _, s := range w.Rules.Steps {
		out.Rules = append(out.Rules, s.Rule)
	}
	return out
}

// apiOption is an option as a preview shows it: band and risk, never the
// chance behind the band or a roll.
func apiOption(g *game.Game, o fight.Option) api.Option {
	return api.Option{ID: o.ID, Verb: o.Verb, Kind: o.Kind, Band: g.BandName(o.Band), Risk: o.Risk, RiskSize: o.RiskSize,
		Puzzle: o.Puzzle, Why: fightWhy(g, o.Why)}
}

func apiLong(l *game.Long) *api.Long {
	if l == nil {
		return nil
	}
	out := &api.Long{Kind: l.Kind, Due: l.Due, Ends: l.Ends, Material: l.Material, Left: l.Left}
	for _, h := range l.Route {
		out.Route = append(out.Route, apiHex(h))
	}
	return out
}

func apiCharacter(g *game.Game, c *game.Char) api.Character {
	ch := c.C
	out := api.Character{ID: ch.ID, Version: c.Version, At: apiHex(ch.At), Coin: ch.Coin, Provisions: ch.Provisions,
		Goods: apiGoods(ch.Goods), Practice: []api.Skill{}, Long: apiLong(c.Long), InFight: c.Fight != nil,
		Walked: ch.Walked, Banned: c.Banned}
	out.Conditions = conditions(g, c)
	for _, s := range ch.Practice {
		out.Practice = append(out.Practice, api.Skill{ID: s.ID, Level: s.Level})
	}
	if m := ch.In(char.Mount, 0); m != nil {
		out.Mount = &api.Mount{ID: m.ID, Kind: m.Mount, Level: m.Level}
	}
	out.Titles, out.Pouches, out.Armed, out.Floor = g.Titles(c), int64(len(c.Pouches)), c.Armed != nil, ch.Floor
	v := newVictims(g, c)
	out.Alignment, out.Hot, out.Wanted, out.Stopped = apiAlignment(g, c), hotGoods(g, c, v), apiWanted(g, c, v), apiStopped(g, c)
	return out
}

// structural: the listings a purse shows.
const purseListings = 5

// cheapest are a settlement's cheapest gear listings, as a character
// sees them.
func cheapest(g *game.Game, c *game.Char, n, most int) []api.Listing {
	out := []api.Listing{}
	for _, l := range g.CheapestListings(n, most) {
		out = append(out, apiListing(g, c, l))
	}
	return out
}

func apiListing(g *game.Game, c *game.Char, l market.Listing) api.Listing {
	in := l.Item
	out := api.Listing{ID: l.ID, Kind: in.Kind, Name: g.KindName(in.Kind), Level: in.Level, Picks: int64(len(in.Picks)), Durability: in.Durability,
		Max: in.MaxDurability, Maker: in.Maker, Seller: g.OwnerName(l.Seller), Price: l.Price, Value: g.ItemValue(in), Mine: l.Seller == ledger.Char(c.C.ID)}
	if k, ok := g.Kinds.Kind(in.Kind); ok {
		out.Slot = k.Slot
	}
	return out
}

func apiGoods(goods []item.Spoil) []api.Goods {
	out := make([]api.Goods, 0, len(goods))
	for _, s := range goods {
		out = append(out, api.Goods{Material: s.Material, Units: s.Qty})
	}
	return out
}

func conditions(g *game.Game, c *game.Char) []string {
	out := []string{}
	for _, t := range c.C.ConditionTags(g.Tick()) {
		out = append(out, string(t))
	}
	return out
}

func apiOptions(g *game.Game, c *game.Char) api.Options {
	ch := g.Choose(c)
	out := api.Options{CharacterID: c.C.ID, Version: c.Version, Tick: g.Tick(), At: apiHex(c.C.At), Conditions: conditions(g, c),
		Moves: []api.Move{}, Materials: ch.Materials,
		GatherMin: ch.GatherMin, GatherMax: ch.GatherMax, Rest: ch.Rest, Explore: ch.Explore, Cancel: ch.CanCancel, Long: apiLong(ch.Long)}
	if out.Materials == nil {
		out.Materials = []string{}
	}
	if called := g.Called(c); called || c.Carrying != "" || c.CarriedBy != "" {
		out.Rescue = &api.Rescue{Called: called, Home: g.PlaceName(g.SettlementHex(g.HomeOf(c))), Carrying: c.Carrying, CarriedBy: c.CarriedBy}
		if d := g.Char(c.Carrying); d != nil {
			out.Rescue.CarryingHome = g.PlaceName(g.SettlementHex(g.HomeOf(d)))
		}
	}
	for _, m := range ch.Moves {
		out.Moves = append(out.Moves, api.Move{Dir: m.Dir, To: apiHex(m.To), Open: m.Open, Ticks: m.Ticks, Why: apiParts(m.Why)})
	}
	out.Fight = apiFight(g, c, ch.Fight)
	out.Purse = apiPurse(g, c)
	out.Steals = apiSteals(g, c)
	for _, s := range g.SidesFor(c) {
		out.Sides = append(out.Sides, api.SideOption{Goal: s.Goal, Arc: s.Arc, Side: s.Side, Wants: s.Wants, Tag: s.Tag, Left: s.Left,
			At: apiHex(s.At), Region: s.Region, Backed: s.Backed})
	}
	return out
}

// apiFight is the beat a character faces, with the family of its machine
// where it has one. A shared encounter lists its members and who has
// picked, never what.
func apiFight(g *game.Game, c *game.Char, f *game.FightView) *api.Fight {
	if f == nil {
		return nil
	}
	v := &api.Fight{ID: f.ID, Beat: f.Beat, Beats: f.Beats, Kind: f.Kind, Creature: f.Creature, Ambush: f.Ambush,
		Default: f.Default, Due: f.Due, Options: []api.Option{}, Machine: g.MachineOn(c)}
	for _, o := range f.Options {
		v.Options = append(v.Options, apiOption(g, o))
	}
	if c.Fight == nil {
		return v
	}
	e := c.Fight.E
	v.Floor, v.Hidden, v.Theft = e.Floor, int64(e.At) < e.Hidden, apiTheft(g, c, c.Fight.Theft)
	v.CreatureName, v.Variant = variantSeen(g, c.C.At, e)
	if in, ok := fightPortrait(g, c); ok {
		v.Portrait = portraitKey(in)
	}
	for _, in := range g.SwapDecks(c) {
		v.Decks = append(v.Decks, api.DeckView{ID: in.ID, Name: g.KindName(in.Kind)})
	}
	if sh := g.SharedByID(f.Shared); sh != nil {
		v.Shared, v.Party = true, fightParty(g, c, sh)
		if family, _, ok := g.Rules().Fight.Machine(e); ok && v.Machine != "" {
			v.Machine = family
		}
	}
	return v
}

// fightPortrait is the portrait input of the creature a character fights,
// from what its fight already shows: false outside a fight, in a theft,
// whose creature is a stand-in, or without the kit.
func fightPortrait(g *game.Game, c *game.Char) (render.PortraitInput, bool) {
	if c.Fight == nil || c.Fight.E == nil || c.Fight.Theft != nil {
		return render.PortraitInput{}, false
	}
	e := c.Fight.E
	_, variant := variantSeen(g, c.C.At, e)
	var resists []string
	for _, r := range e.Resist {
		if r.Bands > 0 {
			resists = append(resists, string(r.Tag))
		}
	}
	return creaturePortrait(e.Creature, variant, resists)
}

// huntPortrait is the portrait input of a hunted creature: it has no
// variant, and its resistances are the beat's, not the creature's.
func huntPortrait(x *game.Hunt) (render.PortraitInput, bool) {
	return creaturePortrait(x.H.Creature, "", nil)
}

func creaturePortrait(cr fight.Creature, variant string, resists []string) (render.PortraitInput, bool) {
	kit, err := render.DefaultKit()
	if err != nil {
		return render.PortraitInput{}, false
	}
	ts := make([]string, len(cr.Tags))
	for i, t := range cr.Tags {
		ts[i] = string(t)
	}
	return kit.PortraitInput(cr.Archetype, cr.Tier, ts, variant, resists), true
}

// portraitKey is a portrait's media key, recorded with its input so its first fetch draws it outside the read's lock.
func portraitKey(in render.PortraitInput) string {
	key, _ := pictureKey(portraitKind, in) // a struct of strings and an int always marshals
	portraits.record(key, in)
	return key
}

// portraits holds the inputs of recently computed portrait keys and the keys
// a scan did not find, each bounded, oldest dropped first. It is process-wide
// on purpose: a key is a pure function of its input, and the free converters
// that compute keys hold no Server.
var portraits portraitRecord

type portraitRecord struct {
	in   bounded[string, render.PortraitInput]
	gone bounded[string, struct{}]
}

func (p *portraitRecord) record(key string, in render.PortraitInput) { p.in.add(key, in) }

func (p *portraitRecord) input(key string) (render.PortraitInput, bool) { return p.in.get(key) }

func (p *portraitRecord) missed(key string) bool {
	_, ok := p.gone.get(key)
	return ok
}

func (p *portraitRecord) miss(key string) { p.gone.add(key, struct{}{}) }

// structural: the media kinds drawn from the kit.
const (
	portraitKind = "portrait"
	artKind      = "art"
)

func apiPurse(g *game.Game, c *game.Char) api.Purse {
	p := api.Purse{Coin: c.C.Coin, Provisions: c.C.Provisions, Goods: apiGoods(c.C.Goods), Load: api.Load{Carried: c.Carried(), Capacity: g.Capacity(c)},
		Open: g.OpenOrders(c), Markets: []api.Hex{}}
	worn := func(in *item.Instance) api.Worn {
		w := api.Worn{ID: in.ID, Kind: in.Kind, Durability: in.Durability, Max: in.MaxDurability, Value: g.ItemValue(in)}
		if k, ok := g.Kinds.Kind(in.Kind); ok {
			cost := g.RepairCost(in, k)
			w.Repair = api.Goods{Material: cost.Material, Units: cost.Units}
		}
		return w
	}
	if in := c.C.In(char.Hand, 0); in != nil {
		w := worn(in)
		p.Hand = &w
	}
	p.Items = []api.Worn{}
	for _, in := range c.C.Pack {
		if !c.C.Worn(in.ID) {
			p.Items = append(p.Items, worn(in))
		}
	}
	p.Mounted, p.Owed = c.C.In(char.Mount, 0) != nil, c.Owed
	for _, h := range g.Settlements() {
		p.Markets = append(p.Markets, apiHex(h))
	}
	n, ok := g.MarketAt(c.C.At)
	if !ok {
		return p
	}
	p.Market = true
	rv := g.Rules().Values
	for _, o := range g.Offers(c.C.At) {
		if o.Asset == ledger.Provisions {
			p.Provision = o.Price
		} else {
			p.Mounts = append(p.Mounts, api.Offer{Asset: o.Asset, Price: o.Price})
		}
	}
	p.Listings = cheapest(g, c, n, purseListings)
	for _, b := range g.BooksAt(n) {
		bid, ask := b.Best()
		q := api.Quote{Material: b.Material, Bid: bid, Ask: ask, Value: rv.Asset(b.Material)}
		if len(b.Bids) > 0 {
			q.BidUnits = b.Bids[0].Qty
		}
		p.Quotes = append(p.Quotes, q)
	}
	return p
}

func apiFacts(fs []fact.Fact) []api.Fact {
	out := make([]api.Fact, len(fs))
	for i, f := range fs {
		out[i] = apiFact(f)
	}
	return out
}

func apiFact(f fact.Fact) api.Fact {
	x := api.Fact{ID: int64(f.ID), Tick: f.Tick, Kind: f.Kind, Region: f.Region, Weight: f.Weight,
		Subjects: make([]api.Ref, len(f.Subjects)), Data: make([]api.Datum, len(f.Data))}
	for j, s := range f.Subjects {
		x.Subjects[j] = api.Ref{Kind: s.Kind, ID: s.ID}
	}
	for j, d := range f.Data {
		x.Data[j] = api.Datum{Key: d.Key, N: d.N, S: d.S}
	}
	for _, c := range f.Causes {
		x.Causes = append(x.Causes, int64(c))
	}
	x.Staged = f.StagedBy != nil
	return x
}

func apiPressed(g *game.Game, ps []fight.Pressed) []api.Pressed {
	var out []api.Pressed
	for _, p := range ps {
		out = append(out, api.Pressed{Option: p.Option.ID, Band: g.BandName(p.Option.Band), Success: p.Outcome.Success, Why: fightWhy(g, p.Why)})
	}
	return out
}

// apiTile is a discovered tile: what it is, and what stands and blows on
// it now.
func apiTile(g *game.Game, h hex.Hex) (api.Tile, bool) {
	if !found(g, h) {
		return api.Tile{}, false
	}
	return tileView(g, h), true
}

// tileView is a tile as a client sees it, found or not: only for a tile
// the asking character stands on.
func tileView(g *game.Game, h hex.Hex) api.Tile {
	b := g.Rules().Gen.Baseline(h)
	out := api.Tile{Hex: apiHex(h), Terrain: b.Terrain, Water: b.Water, Site: g.SiteAt(h), Landmark: b.Landmark}
	if c, ok := g.Content(h); ok {
		out.SiteKind, out.Placed = c.SiteKind, apiPlaced(c.Placed)
		if c.Landmark != "" {
			out.Landmark = c.Landmark
		}
	}
	if st := g.World.Tile(h); st != nil {
		out.Road = st.Road
		if st.Discovered != nil {
			out.Found = st.Discovered.Tick
		}
		for _, s := range st.Structures {
			out.Structures = append(out.Structures, s.Kind)
		}
	}
	emergentTile(g, h, &out)
	if r := g.World.RegionAt(h); r >= 0 {
		out.Region = world.RegionRef(r)
	}
	if w, ok := g.World.Weather(h); ok {
		out.Weather = w.Kind
	}
	return out
}

// apiPlace is a discovered tile with its region's gauges and holder and who
// stands there; ok is false for a tile nobody has found.
func apiPlace(g *game.Game, h hex.Hex) (api.Place, bool) {
	if _, ok := apiTile(g, h); !ok {
		return api.Place{}, false
	}
	return placeView(g, h), true
}

// placeView is a place found or not: only for where the asking character
// stands.
func placeView(g *game.Game, h hex.Hex) api.Place {
	t := tileView(g, h)
	out := api.Place{Tick: g.Tick(), Tile: t, Gauges: []api.Gauge{}, Here: []string{}, Rest: g.CanRest(h), Explore: g.CanExplore(h), Overrun: g.World.Past(h, "overrun")}
	if gauges, holder, ok := g.RegionGauges(h); ok {
		for _, m := range gauges {
			out.Gauges = append(out.Gauges, api.Gauge{ID: m.ID, Value: m.Value, Unit: unitGauge})
		}
		if holder >= 0 {
			out.Holder = world.FactionRef(holder)
		}
	}
	for _, c := range g.Chars {
		if c.C.At == h {
			out.Here = append(out.Here, c.C.ID)
		}
	}
	if n, ok := g.SettlementAt(h); ok {
		p := g.Places[n]
		city := apiCity(g, p)
		out.City, out.Ruined = &city, p.Ruined != 0
		out.Trouble, out.Occasion = apiTrouble(g, n), apiOccasion(g, n)
	}
	if st := g.Story; st != nil && st.Ring != nil && st.Ring.Open != 0 && st.Ring.Core == h {
		out.Open = true
	}
	out.Pattern = apiPatternPoint(g, h)
	return out
}

// apiPatternPoint is the pattern point on a tile: its board's progress and
// the clues found, which are public, never the solution.
func apiPatternPoint(g *game.Game, h hex.Hex) *api.PatternPoint {
	pt := g.PatternAt(nil, h)
	if pt == nil {
		return nil
	}
	v := api.PatternPoint{Board: pt.Board, Kind: pt.Kind, Place: pt.Place, Family: pt.Family, Point: pt.Point, Points: pt.Points,
		Values: pt.Values, LapseDays: pt.LapseDays, Held: pt.Held, Solved: pt.Solved}
	for _, id := range pt.Clues {
		if f := storyFact(g, id); f != nil {
			v.Clues = append(v.Clues, *f)
		}
	}
	return &v
}

// apiCity is whether a place is a city, and while it is not, how it
// stands on each of a city's needs. A faction's city is one from the day
// it opens.
func apiCity(g *game.Game, p *game.Place) api.CityState {
	if p.City != nil {
		out := api.CityState{City: true, Raised: p.City.Raised}
		for _, h := range p.City.Tiles {
			out.Tiles = append(out.Tiles, apiHex(h))
		}
		return out
	}
	if p.Faction != nil {
		return api.CityState{City: true, Raised: p.Founded}
	}
	out := api.CityState{}
	for _, n := range g.CityCheck(p.N) {
		out.Needs = append(out.Needs, api.CityNeed{ID: n.ID, Have: n.Have, Need: n.Need, Unit: n.Unit, Met: n.Met})
	}
	return out
}

// apiTrouble is the trouble open at place n, if one is: its mark, the
// defence held so far, when it is decided, and the fact it was cast from.
func apiTrouble(g *game.Game, n int) *api.Trouble {
	if a := g.TroubleAt(n); a != nil {
		return troubleView(g, a)
	}
	return nil
}

// troubleView is a settlement arc as its trouble, open or decided: the
// stage it stands at or ended on.
func troubleView(g *game.Game, a *game.Arc) *api.Trouble {
	row := g.TroubleRow(a)
	_, st, ok := currentStage(a)
	if row == nil || !ok {
		return nil
	}
	out := &api.Trouble{Arc: a.ID, Kind: row.ID, Title: arcTitle(g, a), Banner: row.Banner, Ends: st.Due, Hunt: a.Hunt}
	for _, side := range st.Sides {
		out.Mark += side.Mark
		if x := g.GoalOf(side.Goal); x != nil {
			out.Defence += min(x.Total(), side.Mark)
		}
	}
	if len(a.Cause) > 0 {
		out.Why = storyFact(g, a.Cause[0])
	}
	return out
}

// apiOccasion is the occasion running at place n, if one is.
func apiOccasion(g *game.Game, n int) *api.Occasion {
	if g.Story == nil || n >= len(g.Story.At) {
		return nil
	}
	o := g.Story.At[n].Occasion
	if o == nil || o.Ends <= g.Tick() {
		return nil
	}
	out := &api.Occasion{Kind: o.Kind, Ends: o.Ends}
	if i := slices.IndexFunc(g.Rules().Book.Occasions, func(r sheets.OccasionRow) bool { return r.ID == o.Kind }); i >= 0 {
		out.Banner = g.Rules().Book.Occasions[i].Banner
	}
	return out
}

// storyFact is a fact the story names, from the log's tail or, once that
// is flushed, the story's memory of it; nil for one neither holds.
func storyFact(g *game.Game, id fact.ID) *api.Fact {
	if f, ok := g.Log.Get(id); ok {
		out := apiFacts([]fact.Fact{f})[0]
		return &out
	}
	if g.Story == nil {
		return nil
	}
	i := slices.IndexFunc(g.Story.Memory, func(m arc.Memory) bool { return m.Fact == id })
	if i < 0 {
		return nil
	}
	m := g.Story.Memory[i]
	out := api.Fact{ID: int64(m.Fact), Tick: m.Tick, Kind: m.Kind, Subjects: make([]api.Ref, len(m.Subjects)), Data: []api.Datum{}}
	if m.Region >= 0 {
		out.Region = world.RegionRef(m.Region)
	}
	for j, s := range m.Subjects {
		out.Subjects[j] = api.Ref{Kind: s.Kind, ID: s.ID}
	}
	return &out
}

// apiOrders are the faction orders standing on a tile, priced for a
// character.
func apiOrders(g *game.Game, c *game.Char, h hex.Hex) []api.Order {
	fee := g.Rules().Values.FeePercent()
	out := []api.Order{}
	for _, o := range g.FactionOrders(h) {
		yours, buys := g.PriceFor(c, h, o)
		out = append(out, api.Order{Faction: g.FactionName(o.Faction), Material: o.Material, Price: o.Price, Yours: yours, Wanted: o.Qty, Refuses: !buys,
			Fee: fee})
	}
	return out
}
