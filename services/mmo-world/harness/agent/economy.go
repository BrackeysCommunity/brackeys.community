package agent

import (
	"slices"
	"sync"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/hex"
)

// Roles an Earner plays in the Economy run.
const (
	Gatherer   = "gatherer"   // works nodes near home and sells to the best bids
	Crafter    = "crafter"    // gathers, makes tools and lists them
	Hauler     = "hauler"     // carries its haul to the market that pays most
	Speculator = "speculator" // rests bids under value and asks over it
	Hoarder    = "hoarder"    // keeps far more coin before it spends
	Casual     = "casual"     // plays a short session every few days
)

// Earner is a scripted player of the economy: it works nodes out from a
// market, sells, keeps provisioned and repaired, and spends over its
// comfort as its role decides.
type Earner struct {
	Role      string
	BandOrder []string
	// Comfort is the coin a player of this role keeps before spending, on
	// average; each player's is drawn from half to one and a half times it.
	Comfort int64
	mu      sync.Mutex
	trips   map[string]*trip
}

// trip is where an earner is headed and how far out it has gone.
type trip struct {
	comfort int64
	home    api.Hex
	dir     int
	out     int
	worked  int // gathers this trip
	forages int
	far     bool // a hauler bound for the farthest market
	// sent is set when it asked to go out by a known route; still in the
	// market a turn later, the route was refused and it walks instead.
	sent, walk bool
}

// structural: the shape of an earner's day.
const (
	tripTiles       = 3   // tiles out before it works, and provisions under which it forages
	tripGathers     = 3   // gathers, and forages, a trip makes before it heads back
	provisionsFloor = 12  // provisions it keeps
	repairShare     = 40  // per cent of durability under which it repairs
	listMarkup      = 120 // per cent of value a crafter lists at
	bidUnder        = 85  // per cent of value a speculator bids
	askOver         = 115 // per cent of value it asks
	speculatorOpen  = 4   // orders a speculator keeps open
	hundred         = 100
)

func (e *Earner) Name() string { return "earner-" + e.Role }

func (e *Earner) tripOf(o api.Options, d *Dice) *trip {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.trips == nil {
		e.trips = map[string]*trip{}
	}
	t, ok := e.trips[o.CharacterID]
	if !ok {
		t = &trip{home: o.At, dir: d.Below(len(o.Moves), "earn.dir"), comfort: e.Comfort * int64(hundred/2+d.Below(hundred+1, "earn.comfort")) / hundred}
		e.trips[o.CharacterID] = t
	}
	return t
}

func (e *Earner) Choose(o api.Options, d *Dice) (api.ActionRequest, bool) {
	switch {
	case o.Fight != nil:
		if pick := best(o.Fight, e.BandOrder); pick != "" {
			return api.ActionRequest{Kind: api.ActPress, Option: pick}, true
		}
		return api.ActionRequest{}, false
	case o.Long != nil:
		return api.ActionRequest{}, false
	case has(o.Conditions, api.CondDown):
		return api.ActionRequest{Kind: api.ActCrawl}, true
	case o.Rest && has(o.Conditions, api.CondWounded):
		return api.ActionRequest{Kind: api.ActRest}, true
	}
	t := e.tripOf(o, d)
	if o.Purse.Market {
		if req, ok := e.atMarket(o, t, d); ok {
			return req, true
		}
		t.walk = t.sent
		t.out, t.worked, t.forages, t.far, t.sent = 0, 0, 0, false, false
		t.dir = d.Below(len(o.Moves), "earn.dir")
		if !t.walk {
			if to, ok := ahead(o, t.dir, e.reach(o.Purse, t)); ok {
				t.sent, t.out = true, e.reach(o.Purse, t)
				return api.ActionRequest{Kind: api.ActTravel, To: &to}, true
			}
		}
	}
	return e.away(o, t, d)
}

// atMarket sells, keeps up, spends over comfort, and plays its role.
func (e *Earner) atMarket(o api.Options, t *trip, d *Dice) (api.ActionRequest, bool) {
	p := o.Purse
	for _, g := range p.Goods {
		if e.Role == Crafter && g.Units <= craftQty {
			continue
		}
		if q := quote(p, g.Material); q.Bid > 0 {
			units := g.Units
			if e.Role == Crafter {
				units -= craftQty
			}
			return api.ActionRequest{Kind: api.ActSell, Material: g.Material, Units: units}, true
		}
	}
	if p.Owed > 0 && p.Provisions >= p.Owed {
		return api.ActionRequest{Kind: api.ActFeed}, true
	}
	if h := p.Hand; h != nil && h.Max > 0 && h.Durability*hundred < h.Max*repairShare && p.Coin >= h.Max {
		if need := h.Repair.Units - goodsOf(p, h.Repair.Material); need <= 0 {
			return api.ActionRequest{Kind: api.ActRepair, Item: h.ID}, true
		} else if q := quote(p, h.Repair.Material); q.Ask > 0 && q.Ask*need <= p.Coin-h.Max {
			return api.ActionRequest{Kind: api.ActTake, Material: h.Repair.Material, Units: need, Price: q.Ask}, true
		}
	}
	spare := p.Coin - t.comfort
	want := int64(provisionsFloor)
	if spare > 0 {
		want = max(want, int64(e.reach(p, t))*ticksPerTile)
	}
	if p.Provisions < want && p.Provision > 0 {
		if n := min(want-p.Provisions, p.Coin/p.Provision); n > 0 {
			return api.ActionRequest{Kind: api.ActBuy, Asset: "provisions", Units: n}, true
		}
	}
	if spare <= 0 {
		return e.role(o, d)
	}
	if !p.Mounted && len(p.Mounts) > 0 && p.Mounts[0].Price <= spare {
		return api.ActionRequest{Kind: api.ActBuy, Asset: p.Mounts[0].Asset, Units: 1}, true
	}
	if p.Hand == nil {
		if l, ok := cheapestTool(p, spare); ok {
			return api.ActionRequest{Kind: api.ActPurchase, Item: l.ID}, true
		}
	}
	if h := p.Hand; h != nil && h.Durability < h.Max && h.Repair.Units <= goodsOf(p, h.Repair.Material) && h.Max-h.Durability <= spare {
		return api.ActionRequest{Kind: api.ActRepair, Item: h.ID}, true
	}
	return e.role(o, d)
}

// structural: ticks a tile of a trip home takes, on average, for the
// provisions it needs.
const ticksPerTile = 3

// role is what an earner does in a market once it has sold and kept up.
func (e *Earner) role(o api.Options, d *Dice) (api.ActionRequest, bool) {
	p := o.Purse
	switch e.Role {
	case Crafter:
		for _, it := range p.Items {
			if p.Open < crafterOpen {
				return api.ActionRequest{Kind: api.ActList, Item: it.ID, Price: max(1, it.Value*listMarkup/hundred)}, true
			}
		}
		for _, g := range p.Goods {
			if g.Units >= craftQty && p.Coin >= craftFee {
				r := api.Recipe{Process: "shape", Method: "narrow-grind", Slot: "tool", Inputs: []api.Goods{{Material: g.Material, Units: craftQty}}}
				return api.ActionRequest{Kind: api.ActCraft, Recipe: &r}, true
			}
		}
	case Speculator:
		if p.Open < speculatorOpen && len(p.Quotes) > 0 {
			q := p.Quotes[d.Below(len(p.Quotes), "spec.material")]
			if held := goodsOf(p, q.Material); held > 0 {
				return api.ActionRequest{Kind: api.ActAsk, Material: q.Material, Units: held, Price: max(1, q.Value*askOver/hundred)}, true
			}
			price := max(1, q.Value*bidUnder/hundred)
			if units := min(int64(speculatorUnits), p.Coin/(2*price)); units > 0 {
				return api.ActionRequest{Kind: api.ActBid, Material: q.Material, Units: units, Price: price}, true
			}
		}
	}
	return api.ActionRequest{}, false
}

// structural: what crafters and speculators trade.
const (
	craftQty        = 2
	craftFee        = 8
	speculatorUnits = 5 // units per speculator bid
	crafterOpen     = 6 // listings a crafter keeps open
)

// away walks out, works the nodes, and turns back when laden, short of
// provisions or done.
func (e *Earner) away(o api.Options, t *trip, d *Dice) (api.ActionRequest, bool) {
	p := o.Purse
	full := p.Load.Capacity > 0 && p.Load.Carried*hundred >= p.Load.Capacity*80
	if !p.Market && p.Provisions < tripTiles && t.forages < tripGathers {
		t.forages++
		return api.ActionRequest{Kind: api.ActForage, Ticks: o.GatherMax}, true
	}
	if t.worked >= tripGathers || full {
		if len(p.Markets) == 0 {
			return api.ActionRequest{}, false
		}
		to := p.Markets[0]
		if e.Role == Hauler && len(p.Markets) > 1 && (t.far || d.Percent(haulShare, "haul.where")) {
			to, t.far = p.Markets[len(p.Markets)-1], true
			if req, ok := toward(o, to); ok {
				return req, true
			}
		}
		if to == o.At {
			t.worked = 0
			return e.unsold(p), true
		}
		return api.ActionRequest{Kind: api.ActTravel, To: &to}, true
	}
	if t.out >= e.reach(p, t) && len(o.Materials) > 0 {
		t.worked++
		return api.ActionRequest{Kind: api.ActGather, Material: o.Materials[d.Below(len(o.Materials), "earn.material")], Ticks: o.GatherMax}, true
	}
	for _, m := range o.Moves {
		if m.Dir == t.dir && m.Open {
			t.out++
			return api.ActionRequest{Kind: api.ActStep, Dir: m.Dir}, true
		}
	}
	t.dir = d.Below(len(o.Moves), "earn.dir")
	t.out++
	return step(o, d)
}

// structural: how far an earner goes and how often a hauler takes its
// haul to the farthest market.
const (
	haulShare   = 50
	coinPerTile = 40 // spare coin that takes an earner one tile farther
	farthest    = 15 // most tiles out an earner goes
)

// reach is how far out an earner goes before it works: farther the more
// it has to spend on the provisions home.
func (e *Earner) reach(p api.Purse, t *trip) int {
	spare := p.Coin - t.comfort
	if spare <= 0 {
		return tripTiles
	}
	return int(min(farthest, tripTiles+spare/coinPerTile))
}

// ahead is the tile n steps out in a direction.
func ahead(o api.Options, dir, n int) (api.Hex, bool) {
	for _, m := range o.Moves {
		if m.Dir == dir {
			dq, dr := m.To.Q-o.At.Q, m.To.R-o.At.R
			return api.Hex{Q: o.At.Q + dq*int64(n), R: o.At.R + dr*int64(n)}, true
		}
	}
	return api.Hex{}, false
}

// toward steps to the open neighbour nearest a far tile, for a trip over
// ground nobody has mapped; false once there.
func toward(o api.Options, to api.Hex) (api.ActionRequest, bool) {
	best, dist := -1, hexDistance(o.At, to)
	for _, m := range o.Moves {
		if d := hexDistance(m.To, to); m.Open && d < dist {
			best, dist = m.Dir, d
		}
	}
	if best < 0 {
		return api.ActionRequest{}, false
	}
	return api.ActionRequest{Kind: api.ActStep, Dir: best}, true
}

func hexDistance(a, b api.Hex) int64 {
	return hex.Distance(hex.Hex{Q: a.Q, R: a.R}, hex.Hex{Q: b.Q, R: b.R})
}

// unsold rests an ask at reference value for the largest good nobody here
// is buying today, or just looks in: a player with a full pack and no
// buyer waits for the next day's orders.
func (e *Earner) unsold(p api.Purse) api.ActionRequest {
	var most api.Goods
	for _, g := range p.Goods {
		if g.Units > most.Units {
			most = g
		}
	}
	if q := quote(p, most.Material); most.Units > 0 && p.Open < restingAsks && q.Value > 0 {
		return api.ActionRequest{Kind: api.ActAsk, Material: most.Material, Units: most.Units, Price: q.Value}
	}
	return api.ActionRequest{Kind: api.ActLook}
}

// structural: asks an earner leaves resting when nobody buys.
const restingAsks = 3

func quote(p api.Purse, material string) api.Quote {
	i := slices.IndexFunc(p.Quotes, func(q api.Quote) bool { return q.Material == material })
	if i < 0 {
		return api.Quote{}
	}
	return p.Quotes[i]
}

func goodsOf(p api.Purse, material string) int64 {
	for _, g := range p.Goods {
		if g.Material == material {
			return g.Units
		}
	}
	return 0
}

func cheapestTool(p api.Purse, most int64) (api.Listing, bool) {
	for _, l := range p.Listings {
		if l.Price <= most && !l.Mine && l.Slot == "tool" {
			return l, true
		}
	}
	return api.Listing{}, false
}
