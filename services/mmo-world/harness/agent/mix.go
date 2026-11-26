package agent

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/sheets"
)

// Activities a Mixed player divides its world days between: the loop
// climb's policy space (GDD 18.4).
const (
	GatherSell   = "gather-sell"    // works nodes out from a market and sells to the bids
	BuyCraftSell = "buy-craft-sell" // buys a craft's inputs off the asks, makes and lists
	Arbitrage    = "arbitrage"      // buys under another market's bid and carries it there
	GuildWorks   = "guild-works"    // plays its own role for its server's guild
	Hunts        = "hunts"          // presses the live hunts on the board
	Theft        = "theft"          // steals and fences
)

// structural: the number of activities a Mix weighs.
const activityCount = 6

// Activities are a Mix's weights in order.
var Activities = [activityCount]string{GatherSell, BuyCraftSell, Arbitrage, GuildWorks, Hunts, Theft}

// Mix is a weight per activity in Activities order. The zero Mix plays
// nothing of its own.
type Mix [activityCount]int64

// Zero reports whether no activity has weight.
func (m Mix) Zero() bool { return m.Sum() <= 0 }

// Sum is the weights together.
func (m Mix) Sum() int64 {
	var n int64
	for _, w := range m {
		n += max(w, 0)
	}
	return n
}

// Weight is one activity's weight, 0 for an unknown one.
func (m Mix) Weight(activity string) int64 {
	if i := slices.Index(Activities[:], activity); i >= 0 {
		return max(m[i], 0)
	}
	return 0
}

// pick is the activity a roll in [0, Sum) falls on.
func (m Mix) pick(roll int64) int {
	for i, w := range m {
		if w <= 0 {
			continue
		}
		if roll < w {
			return i
		}
		roll -= w
	}
	return slices.IndexFunc(m[:], func(w int64) bool { return w > 0 })
}

func (m Mix) String() string {
	var parts []string
	for i, w := range m {
		if w > 0 {
			parts = append(parts, fmt.Sprintf("%s %d", Activities[i], w))
		}
	}
	if len(parts) == 0 {
		return "none"
	}
	return strings.Join(parts, ", ")
}

// HuntPages are a world's hunt board and a character's party page, where
// the hunts in reach show.
type HuntPages interface {
	Hunts(ctx context.Context) (api.HuntBoard, error)
	Party(ctx context.Context, characterID string) (api.PartyState, error)
}

// Mixed plays a Mix: each world day it draws an activity by weight and
// plays it until the next day's draw, which waits until it stands free in
// a market with nothing in hand. Guild works is its own Earner, whose
// role and guild plan stay, and theft is a Thief over that Earner, as the
// Crime run's thieves are; every other activity earns as a guildless
// Earner of the role that fits it, so a mixed player gives its guild
// nothing on those days.
type Mixed struct {
	Mix    Mix
	Base   *Earner
	gather *Earner
	craft  *Earner
	haul   *Earner
	thief  *Thief
	hunter Hunter
	mu     sync.Mutex
	state  map[string]*mixState
}

// mixState is one mixed player's day: the activity in hand and the world
// day it was drawn on, the turns it has given each activity, the haul it
// carries for arbitrage and the prices it last saw in each market.
type mixState struct {
	act      int
	day      int64 // world day + 1; 0 before the first draw
	turns    Mix
	haul     *haul
	prices   map[api.Hex][]api.Quote
	scouted  int64 // world day + 1 it last set out only to read a market
	bought   int64 // world day + 1 it last bought a craft's inputs
	board    api.HuntBoard
	boardAt  int64
	boardSet bool
}

// haul is an arbitrage carry: what was bought, and the market whose bid
// it is carried to.
type haul struct {
	material string
	to       api.Hex
	sent     bool // asked to travel; still in a market a turn later, it walks
	walk     bool
}

// structural: what an arbitrage carry and a craft's purchase take.
const (
	arbMargin  = 125 // per cent of the ask another market's bid must reach
	arbUnits   = 10  // units carried at once
	huntReach  = 12  // tiles out a hunter walks to a live hunt
	craftBuyAt = 2   // times the craft's inputs' cost it keeps over comfort to buy them
)

// NewMixed is a player who keeps e's role, comfort and backing and plays
// m over them, under the sheets' theft rules.
func NewMixed(b *sheets.Book, e *Earner, m Mix) *Mixed {
	as := func(role string) *Earner {
		return &Earner{Role: role, BandOrder: e.BandOrder, Comfort: e.Comfort, Back: e.Back, Idle: e.Idle}
	}
	return &Mixed{Mix: m, Base: e, gather: as(Gatherer), craft: as(Crafter), haul: as(Hauler), thief: NewThief(b, e),
		hunter: Hunter{BandOrder: e.BandOrder}, state: map[string]*mixState{}}
}

func (m *Mixed) Name() string { return "mixed-" + m.Base.Role }

// Steals reports whether the mix gives theft any weight.
func (m *Mixed) Steals() bool { return m.Mix.Weight(Theft) > 0 }

// Played is the turns a character gave each activity.
func (m *Mixed) Played(characterID string) Mix {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.state[characterID]; ok {
		return s.turns
	}
	return Mix{}
}

func (m *Mixed) stateOf(id string) *mixState {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.state[id]
	if !ok {
		s = &mixState{prices: map[api.Hex][]api.Quote{}}
		m.state[id] = s
	}
	return s
}

// current is the activity in hand, drawn afresh once a world day when
// the player stands free in a market.
func (m *Mixed) current(o api.Options, d *Dice) (*mixState, string) {
	s := m.stateOf(o.CharacterID)
	day := o.Tick/sheets.TicksPerDay + 1
	free := o.Purse.Market && o.Fight == nil && o.Long == nil && s.haul == nil
	if s.day == 0 || (s.day != day && free) {
		s.act, s.day = m.Mix.pick(int64(d.Below(int(m.Mix.Sum()), "mix.activity"))), day
	}
	return s, Activities[s.act]
}

func (m *Mixed) Choose(o api.Options, d *Dice) (api.ActionRequest, bool) {
	if m.Mix.Zero() {
		return m.Base.Choose(o, d)
	}
	s, act := m.current(o, d)
	req, ok := m.choose(o, d, s, act)
	if ok {
		s.turns[s.act]++
	}
	return req, ok
}

func (m *Mixed) choose(o api.Options, d *Dice, s *mixState, act string) (api.ActionRequest, bool) {
	switch act {
	case GuildWorks:
		return m.Base.Choose(o, d)
	case BuyCraftSell:
		if req, ok := m.buyCraft(o, d, s); ok {
			return req, true
		}
		return m.craft.Choose(o, d)
	case Arbitrage:
		if req, ok, done := m.arbitrage(o, d, s); done {
			return req, ok
		}
		return m.haul.Choose(o, d)
	case Hunts:
		if req, ok := m.hunter.Choose(o, d); ok {
			return req, true
		}
		return m.gather.Choose(o, d)
	case Theft:
		return m.thief.Choose(o, d)
	}
	return m.gather.Choose(o, d)
}

// Civic is the activity's own: its guild's and classes' pages on guild
// works days, the thief's crimes on theft days, the hunt board on hunt
// days; on the others only the classes page.
func (m *Mixed) Civic(o api.Options, desk *Desk, d *Dice) (api.ActionRequest, Verdict, error) {
	if m.Mix.Zero() {
		return m.Base.Civic(o, desk, d)
	}
	s, act := m.current(o, d)
	req, v, err := m.civic(o, desk, d, s, act)
	if err == nil && v == Act {
		s.turns[s.act]++
	}
	return req, v, err
}

func (m *Mixed) civic(o api.Options, desk *Desk, d *Dice, s *mixState, act string) (api.ActionRequest, Verdict, error) {
	switch act {
	case GuildWorks:
		return m.Base.Civic(o, desk, d)
	case Theft:
		return m.thief.Civic(o, desk, d)
	case Hunts:
		req, v, err := m.hunt(o, desk, s)
		if err != nil || v != Pass {
			return req, v, err
		}
		return m.gather.Civic(o, desk, d)
	case BuyCraftSell:
		return m.craft.Civic(o, desk, d)
	case Arbitrage:
		return m.haul.Civic(o, desk, d)
	}
	return m.gather.Civic(o, desk, d)
}

// hunt presses the nearest open hunt within huntReach, or walks to it;
// Pass when the board has none.
func (m *Mixed) hunt(o api.Options, desk *Desk, s *mixState) (api.ActionRequest, Verdict, error) {
	hp, ok := desk.pages.(HuntPages)
	if !ok || o.Fight != nil || o.Long != nil || has(o.Conditions, api.CondDown) || has(o.Conditions, api.CondWounded) {
		return api.ActionRequest{}, Pass, nil
	}
	if !s.boardSet || s.boardAt != o.Tick {
		board, err := hp.Hunts(desk.ctx)
		if err != nil {
			return api.ActionRequest{}, Pass, err
		}
		s.board, s.boardAt, s.boardSet = board, o.Tick, true
	}
	var to *api.Hex
	most := int64(huntReach) + 1
	for _, c := range s.board.Hunts {
		if d := hexDistance(o.At, c.At); !c.Closed && d < most {
			at := c.At
			to, most = &at, d
		}
	}
	if to == nil {
		return api.ActionRequest{}, Pass, nil
	}
	st, err := hp.Party(desk.ctx, o.CharacterID)
	if err != nil {
		return api.ActionRequest{}, Pass, err
	}
	if st.Hunt != nil {
		if req, ok := m.hunter.Press(st.Hunt); ok {
			return req, Act, nil
		}
		return api.ActionRequest{}, Wait, nil
	}
	if req, ok := m.hunter.Toward(o, *to); ok {
		return req, Act, nil
	}
	return api.ActionRequest{}, Pass, nil
}

// buyCraft buys a craft's inputs off the cheapest clean ask here, once a
// world day, when it holds none to craft and keeps enough over its comfort;
// the crafter it plays then makes and lists.
func (m *Mixed) buyCraft(o api.Options, d *Dice, s *mixState) (api.ActionRequest, bool) {
	p := o.Purse
	if !p.Market || o.Fight != nil || o.Long != nil || s.bought == o.Tick/sheets.TicksPerDay+1 {
		return api.ActionRequest{}, false
	}
	if slices.ContainsFunc(p.Goods, func(g api.Goods) bool { return g.Staged == nil && g.Units >= craftQty }) {
		return api.ActionRequest{}, false
	}
	spare := p.Coin - m.craft.tripOf(o, d).comfort
	var pick api.Quote
	for _, q := range p.Quotes {
		if !q.Staged && q.Ask > 0 && (pick.Ask == 0 || q.Ask < pick.Ask) {
			pick = q
		}
	}
	if pick.Ask == 0 || spare < craftBuyAt*(pick.Ask*craftQty+craftFee) {
		return api.ActionRequest{}, false
	}
	s.bought = o.Tick/sheets.TicksPerDay + 1
	return api.ActionRequest{Kind: api.ActTake, Material: pick.Material, Units: craftQty, Price: pick.Ask}, true
}

// arbitrage plays a carry: in a market it notes the prices, sells a haul
// where it was carried to, sets out with one, buys under another market's
// last-seen bid, or sets out to read a market it has not seen. done is
// false when there is nothing of arbitrage to do and the hauler plays.
func (m *Mixed) arbitrage(o api.Options, d *Dice, s *mixState) (req api.ActionRequest, ok, done bool) {
	p := o.Purse
	if o.Fight != nil || o.Long != nil || has(o.Conditions, api.CondDown) {
		return api.ActionRequest{}, false, false
	}
	if p.Market {
		s.prices[o.At] = slices.DeleteFunc(slices.Clone(p.Quotes), func(q api.Quote) bool { return q.Staged })
	}
	if h := s.haul; h != nil {
		held := goodsOf(p, h.material)
		switch {
		case held == 0:
			s.haul = nil
		case p.Market && o.At == h.to:
			s.haul = nil
			if q := quote(p, h.material); q.Bid > 0 {
				return api.ActionRequest{Kind: api.ActSell, Material: h.material, Units: held}, true, true
			}
			return api.ActionRequest{}, false, false
		case p.Market && h.sent && !h.walk:
			h.walk = true
			fallthrough
		case h.walk || !p.Market:
			if req, ok := toward(o, h.to); ok {
				return req, true, true
			}
			s.haul = nil
			return api.ActionRequest{}, false, false
		default:
			h.sent = true
			to := h.to
			return api.ActionRequest{Kind: api.ActTravel, To: &to}, true, true
		}
	}
	if !p.Market {
		return api.ActionRequest{}, false, false
	}
	spare := p.Coin - m.haul.tripOf(o, d).comfort
	best, bestTo, gain := api.Quote{}, api.Hex{}, int64(0)
	for _, q := range s.prices[o.At] {
		if q.Ask <= 0 {
			continue
		}
		for _, at := range p.Markets {
			if at == o.At {
				continue
			}
			i := slices.IndexFunc(s.prices[at], func(x api.Quote) bool { return x.Material == q.Material })
			if i < 0 {
				continue
			}
			bid := s.prices[at][i].Bid
			if bid*hundred >= q.Ask*arbMargin && bid-q.Ask > gain {
				best, bestTo, gain = q, at, bid-q.Ask
			}
		}
	}
	if gain > 0 && spare > 0 {
		units := min(int64(arbUnits), spare/best.Ask)
		if room := p.Load.Capacity - p.Load.Carried; p.Load.Capacity > 0 {
			units = min(units, room)
		}
		if units > 0 {
			s.haul = &haul{material: best.Material, to: bestTo}
			return api.ActionRequest{Kind: api.ActTake, Material: best.Material, Units: units, Price: best.Ask}, true, true
		}
	}
	day := o.Tick/sheets.TicksPerDay + 1
	if s.scouted != day && len(s.prices) < len(p.Markets) {
		for _, at := range p.Markets {
			if _, seen := s.prices[at]; !seen {
				s.scouted = day
				to := at
				return api.ActionRequest{Kind: api.ActTravel, To: &to}, true, true
			}
		}
	}
	return api.ActionRequest{}, false, false
}

// HouseKeeper is a server's admin who saves its house's settings once and
// then plays no more: a server with a house and nobody playing.
type HouseKeeper struct {
	Settings api.HouseSettings
	mu       sync.Mutex
	sent     map[string]bool
}

func (*HouseKeeper) Name() string { return "house-keeper" }

func (h *HouseKeeper) Choose(o api.Options, _ *Dice) (api.ActionRequest, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.sent[o.CharacterID] || o.Fight != nil || o.Long != nil {
		return api.ActionRequest{}, false
	}
	if h.sent == nil {
		h.sent = map[string]bool{}
	}
	h.sent[o.CharacterID] = true
	s := h.Settings
	return api.ActionRequest{Kind: api.ActHouseSettings, Settings: &s}, true
}
