package agent

import (
	"slices"
	"sync"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

// Uses a beneficiary makes of the staged goods it is given (GDD 10.8,
// 14.5): sold on the staged book where they were staged, crafted with,
// handed to another server's players, or offered to faction orders and
// other markets, which refuse them.
const (
	UseSell  = "sell"
	UseCraft = "craft"
	UseGive  = "give"
	UseTry   = "try"
)

// Uses are the four in the order a staging policy shares them out.
var Uses = []string{UseSell, UseCraft, UseGive, UseTry}

// Staging is what a stager and a beneficiary read of the world's staging:
// what a server's house and the hunt board show its members.
type Staging interface {
	// Home is the first settlement the server's guild runs.
	Home(server string) (int, bool)
	// Sites are the tiles a staging at a settlement may name, nearest
	// first.
	Sites(settlement int) []api.Hex
	// Stages are the world's open stages.
	Stages() []StageSpot
	// Hunt is the staged hunt in reach of a character, nil for none.
	Hunt(characterID string) *api.HuntView
	// SettlementAt is the settlement on a tile.
	SettlementAt(at api.Hex) (int, bool)
	// Outsiders are the characters of other servers standing on a tile.
	Outsiders(server string, at api.Hex) []string
	// Away is the market of a settlement another server's guild runs, or
	// nobody's.
	Away(server string) (api.Hex, bool)
	// StagedItems are the items a character carries that were staged.
	StagedItems(characterID string) []string
	// StagedArc reports whether an arc is a server's staged hardship.
	StagedArc(id string) bool
}

// StageSpot is one open stage as its server's members see it: where it
// stands, the crates left, its hunt and the tiles its reach contests ask
// for.
type StageSpot struct {
	ID         string
	Kind       string
	Settlement int
	At         api.Hex
	Crates     int64
	Hunt       string
	Reach      []api.Hex
}

// Stager stages for its server from the player path, as a member with the
// admin or staff console would (GDD 14.4): its templates in turn, at its
// home settlement's sites, one order every Every ticks from From. Off
// stages nothing: the unstaged twin's stager.
type Stager struct {
	Book      *sheets.Book
	Board     Staging
	Server    string
	Templates []string
	Every     int64
	From      int64
	Days      int64
	Far       bool
	Off       bool
	mu        sync.Mutex
	last      int64
	n         int
}

func (s *Stager) Name() string { return "stager" }

// structural: how many of a settlement's sites, nearest or farthest, a
// stager spreads its stages over.
const stagerSites = 6

// Choose is the next order, when one is due.
func (s *Stager) Choose(o api.Options, _ *Dice) (api.ActionRequest, bool) {
	switch {
	case o.Fight != nil:
		if pick := best(o.Fight, sheets.BandsByRank(s.Book)); pick != "" {
			return api.ActionRequest{Kind: api.ActPress, Option: pick}, true
		}
		return api.ActionRequest{}, false
	case has(o.Conditions, api.CondDown):
		return api.ActionRequest{Kind: api.ActCrawl}, true
	case s.Off || len(s.Templates) == 0 || o.Long != nil || o.Tick < s.From:
		return api.ActionRequest{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.n > 0 && o.Tick < s.last+s.Every {
		return api.ActionRequest{}, false
	}
	home, ok := s.Board.Home(s.Server)
	if !ok {
		return api.ActionRequest{}, false
	}
	sites := s.Board.Sites(home)
	if len(sites) == 0 {
		return api.ActionRequest{}, false
	}
	k := s.n
	s.last, s.n = o.Tick, s.n+1
	spread := min(len(sites), stagerSites)
	at := sites[k%spread]
	if s.Far {
		at = sites[len(sites)-1-k%spread]
	}
	order, ok := s.order(s.Templates[k%len(s.Templates)], home, at, k)
	if !ok {
		return api.ActionRequest{}, false
	}
	return api.ActionRequest{Kind: api.ActStage, Stage: &order}, true
}

// order is a staging of a template, naming the hunt, contest or pattern
// its kind takes in turn.
func (s *Stager) order(template string, home int, at api.Hex, k int) (api.StageOrder, bool) {
	i := slices.IndexFunc(s.Book.LiveOpsTemplates, func(t sheets.StageTemplate) bool { return t.ID == template })
	if i < 0 {
		return api.StageOrder{}, false
	}
	t := s.Book.LiveOpsTemplates[i]
	out := api.StageOrder{Template: t.ID, Settlement: home, At: at, Days: s.Days}
	switch t.Kind {
	case sheets.StageHunt:
		var rows []string
		for _, h := range s.Book.Hunts {
			if h.Kind == "" {
				rows = append(rows, h.ID)
			}
		}
		if len(rows) == 0 {
			return api.StageOrder{}, false
		}
		out.Hunt = rows[k%len(rows)]
	case sheets.StageContest:
		if len(s.Book.LiveOpsContests) == 0 {
			return api.StageOrder{}, false
		}
		out.Contest = s.Book.LiveOpsContests[k%len(s.Book.LiveOpsContests)].ID
	case sheets.StagePattern:
		if len(t.Patterns) == 0 {
			return api.StageOrder{}, false
		}
		out.Pattern = t.Patterns[k%len(t.Patterns)]
	}
	return out, true
}

// Beneficiary is a player of the staging server who takes what its
// server stages (crates, staged hunts, reach contests) and makes one Use
// of the staged goods; otherwise it plays Inner, which never sees a
// staged good or item. With no Use it takes nothing, and leaves staged
// hardships' sides unbacked.
type Beneficiary struct {
	Inner     Policy
	Use       string
	Server    string
	Board     Staging
	BandOrder []string
	// Cap is how many crates of one drop it opens (liveops.params
	// crate-cap).
	Cap   int64
	mu    sync.Mutex
	state map[string]*benefit
}

// benefit is what one beneficiary is about: the crates it has opened by
// stage, the stages it is done with, where it is headed, and the uses it
// tried today.
type benefit struct {
	opened map[string]int64
	done   map[string]bool
	target *api.Hex
	stage  string
	reach  bool             // the target is a reach contest's tile
	tried  map[string]int64 // what it tried, by the world day it last did
	away   int64            // the world day it last set out for another market
}

// structural: how far a stage draws a beneficiary, how many staged units
// it sets out to give or try elsewhere with, how many it hands over at
// once, and how many days lie between two such journeys.
const (
	stageReach = 6
	takeOut    = 4
	giveUnits  = 3
	awayEvery  = 3
)

func (b *Beneficiary) Name() string { return b.Inner.Name() + "+" + b.Use }

// Unwrap is the policy it plays when nothing staged is about.
func (b *Beneficiary) Unwrap() Policy { return b.Inner }

func (b *Beneficiary) Choose(o api.Options, d *Dice) (api.ActionRequest, bool) {
	if req, ok := b.staged(o); ok {
		return req, true
	}
	return b.Inner.Choose(b.clean(o), d)
}

func (b *Beneficiary) Civic(o api.Options, desk *Desk, d *Dice) (api.ActionRequest, Verdict, error) {
	if req, ok := b.staged(o); ok {
		return req, Act, nil
	}
	if cz, ok := b.Inner.(Citizen); ok {
		return cz.Civic(b.clean(o), desk, d)
	}
	return api.ActionRequest{}, Pass, nil
}

// clean is what the inner policy is shown: the options without staged
// goods, staged quotes or staged items, which it has no use for, and for a
// player who takes nothing without staged hardships' sides.
func (b *Beneficiary) clean(o api.Options) api.Options {
	if b.Use == "" && slices.ContainsFunc(o.Sides, func(s api.SideOption) bool { return b.Board.StagedArc(s.Arc) }) {
		o.Sides = slices.DeleteFunc(slices.Clone(o.Sides), func(s api.SideOption) bool { return b.Board.StagedArc(s.Arc) })
	}
	p := o.Purse
	if !slices.ContainsFunc(p.Goods, func(g api.Goods) bool { return g.Staged != nil }) &&
		!slices.ContainsFunc(p.Quotes, func(q api.Quote) bool { return q.Staged }) {
		if items := b.Board.StagedItems(o.CharacterID); len(items) == 0 {
			return o
		}
	}
	p.Goods = slices.DeleteFunc(slices.Clone(p.Goods), func(g api.Goods) bool { return g.Staged != nil })
	p.Quotes = slices.DeleteFunc(slices.Clone(p.Quotes), func(q api.Quote) bool { return q.Staged })
	if items := b.Board.StagedItems(o.CharacterID); len(items) > 0 {
		p.Items = slices.DeleteFunc(slices.Clone(p.Items), func(w api.Worn) bool { return slices.Contains(items, w.ID) })
	}
	o.Purse = p
	return o
}

func (b *Beneficiary) stateOf(id string) *benefit {
	if b.state == nil {
		b.state = map[string]*benefit{}
	}
	s, ok := b.state[id]
	if !ok {
		s = &benefit{opened: map[string]int64{}, done: map[string]bool{}, tried: map[string]int64{}, away: -awayEvery}
		b.state[id] = s
	}
	return s
}

// staged is the beneficiary's own move, when it has one: press a staged
// hunt in reach, open a crate underfoot, use its staged goods in a
// market, or walk to a stage that has something for it.
func (b *Beneficiary) staged(o api.Options) (api.ActionRequest, bool) {
	if b.Use == "" || o.Fight != nil || o.Long != nil || has(o.Conditions, api.CondDown) || has(o.Conditions, api.CondWounded) ||
		o.Purse.Provisions < tripTiles {
		return api.ActionRequest{}, false
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	s := b.stateOf(o.CharacterID)
	day := o.Tick / sheets.TicksPerDay
	if v := b.Board.Hunt(o.CharacterID); v != nil && v.Stage != "" {
		if req, ok := (Hunter{BandOrder: b.BandOrder}).Press(v); ok {
			return req, true
		}
	}
	spots := b.Board.Stages()
	for _, sp := range spots {
		if crates(sp) && sp.At == o.At && s.opened[sp.ID] < b.Cap && !s.done[sp.ID] {
			s.opened[sp.ID]++
			return api.ActionRequest{Kind: api.ActCrateOpen, Target: sp.ID}, true
		}
	}
	if o.Purse.Market {
		if req, ok := b.use(o, s, day); ok {
			return req, true
		}
	}
	return b.head(o, s, spots)
}

func crates(sp StageSpot) bool {
	return (sp.Kind == sheets.StageDrop || sp.Kind == sheets.StageFair) && sp.Crates > 0
}

// head walks toward the stage it set out for, or picks the nearest one in
// reach with something for it. A reach contest is done once its tile is
// reached; a drop once its crates are opened, and a hunt once it closes.
func (b *Beneficiary) head(o api.Options, s *benefit, spots []StageSpot) (api.ActionRequest, bool) {
	if s.target != nil {
		live := slices.ContainsFunc(spots, func(sp StageSpot) bool { return sp.ID == s.stage })
		switch {
		case live && o.At != *s.target:
			if req, ok := toward(o, *s.target); ok {
				return req, true
			}
			s.done[s.stage] = true
		case live && s.reach:
			s.done[s.stage] = true
		}
		s.target, s.stage, s.reach = nil, "", false
	}
	bestAt, bestID, bestD, reach := api.Hex{}, "", int64(stageReach+1), false
	consider := func(id string, at api.Hex, r bool) {
		if d := hexDistance(o.At, at); d > 0 && d < bestD {
			bestAt, bestID, bestD, reach = at, id, d, r
		}
	}
	for _, sp := range spots {
		if s.done[sp.ID] {
			continue
		}
		switch {
		case crates(sp) && s.opened[sp.ID] < b.Cap:
			consider(sp.ID, sp.At, false)
		case sp.Kind == sheets.StageHunt && sp.Hunt != "":
			consider(sp.ID, sp.At, false)
		case len(sp.Reach) > 0:
			consider(sp.ID, sp.Reach[0], true)
		}
	}
	if bestID == "" {
		return api.ActionRequest{}, false
	}
	req, ok := toward(o, bestAt)
	if !ok {
		s.done[bestID] = true
		return api.ActionRequest{}, false
	}
	s.target, s.stage, s.reach = &bestAt, bestID, reach
	return req, true
}

// use is what the beneficiary does with its staged goods in a market, each
// try at most once a world day.
func (b *Beneficiary) use(o api.Options, s *benefit, day int64) (api.ActionRequest, bool) {
	p := o.Purse
	here, ok := b.Board.SettlementAt(o.At)
	if !ok {
		return api.ActionRequest{}, false
	}
	once := func(what string) bool {
		if last, ok := s.tried[what]; ok && last == day {
			return false
		}
		s.tried[what] = day
		return true
	}
	var held int64
	for _, g := range p.Goods {
		if g.Staged == nil {
			continue
		}
		held += g.Units
		origin := g.Staged.Settlement
		asset := ledger.Staged(origin, g.Material)
		value := max(1, stagedQuote(p, g.Material).Value)
		switch b.Use {
		case UseSell:
			if here == origin && p.Open < restingAsks && once("ask "+asset) {
				return api.ActionRequest{Kind: api.ActAsk, Staged: true, Material: g.Material, Units: g.Units, Price: value}, true
			}
		case UseCraft:
			if g.Units >= craftQty && p.Coin >= craftFee && once("craft "+asset) {
				r := api.Recipe{Process: "shape", Method: "narrow-grind", Slot: "tool", Inputs: []api.Goods{{Material: g.Material, Units: craftQty}}}
				return api.ActionRequest{Kind: api.ActCraft, Recipe: &r}, true
			}
		case UseGive:
			if out := b.Board.Outsiders(b.Server, o.At); len(out) > 0 && once("give "+asset) {
				return api.ActionRequest{Kind: api.ActGive, Target: out[0], Asset: asset, Units: min(g.Units, giveUnits)}, true
			}
		case UseTry:
			if cleanOf(p, g.Material) == 0 {
				if once("sell " + asset) {
					return api.ActionRequest{Kind: api.ActSell, Material: g.Material, Units: g.Units}, true
				}
				if p.Open < restingAsks && once("ask "+asset) {
					return api.ActionRequest{Kind: api.ActAsk, Material: g.Material, Units: g.Units, Price: value}, true
				}
			}
			if here != origin && p.Open < restingAsks && once("staged-ask "+asset) {
				return api.ActionRequest{Kind: api.ActAsk, Staged: true, Material: g.Material, Units: g.Units, Price: value}, true
			}
		}
	}
	if req, ok := b.buy(o, here, once); ok {
		return req, true
	}
	if home, ok := b.Board.Home(b.Server); ok && home == here && b.Use == UseCraft {
		if req, ok := b.listItems(o, once); ok {
			return req, true
		}
	}
	if (b.Use == UseGive || b.Use == UseTry) && held >= takeOut && day >= s.away+awayEvery {
		if to, ok := b.Board.Away(b.Server); ok && to != o.At {
			s.away = day
			return api.ActionRequest{Kind: api.ActTravel, To: &to}, true
		}
	}
	return api.ActionRequest{}, false
}

// buy takes a staged ask at or under value for a crafter to work with, at
// the staged book here.
func (b *Beneficiary) buy(o api.Options, here int, once func(string) bool) (api.ActionRequest, bool) {
	if b.Use != UseCraft {
		return api.ActionRequest{}, false
	}
	p := o.Purse
	for _, q := range p.Quotes {
		if !q.Staged || q.Ask <= 0 || q.Ask > q.Value || p.Coin < q.Ask*craftQty+craftFee {
			continue
		}
		if once("take " + ledger.Staged(here, q.Material)) {
			return api.ActionRequest{Kind: api.ActTake, Staged: true, Material: q.Material, Units: craftQty, Price: q.Ask}, true
		}
	}
	return api.ActionRequest{}, false
}

// listItems lists the staged items it made, at home where they were
// staged.
func (b *Beneficiary) listItems(o api.Options, once func(string) bool) (api.ActionRequest, bool) {
	p := o.Purse
	if p.Open >= crafterOpen {
		return api.ActionRequest{}, false
	}
	staged := b.Board.StagedItems(o.CharacterID)
	for _, it := range p.Items {
		if !slices.Contains(staged, it.ID) {
			continue
		}
		if once("list " + it.ID) {
			return api.ActionRequest{Kind: api.ActList, Item: it.ID, Price: max(1, it.Value*listMarkup/hundred)}, true
		}
	}
	return api.ActionRequest{}, false
}

// stagedQuote is the staged book's quote for a material here, or the
// clean one's where none is open.
func stagedQuote(p api.Purse, material string) api.Quote {
	for _, q := range p.Quotes {
		if q.Staged && q.Material == material {
			return q
		}
	}
	return quote(p, material)
}

// cleanOf is the clean units of a material a purse holds.
func cleanOf(p api.Purse, material string) int64 {
	for _, g := range p.Goods {
		if g.Staged == nil && g.Material == material {
			return g.Units
		}
	}
	return 0
}

// Resting plays Inner but passes one tick in Every from From: a change of
// play with nothing staged.
type Resting struct {
	Inner       Policy
	From, Every int64
}

func (r *Resting) Name() string { return r.Inner.Name() + "+rest" }

func (r *Resting) Unwrap() Policy { return r.Inner }

func (r *Resting) Choose(o api.Options, d *Dice) (api.ActionRequest, bool) {
	if o.Tick >= r.From && o.Tick%r.Every == 0 {
		return api.ActionRequest{}, false
	}
	return r.Inner.Choose(o, d)
}

func (r *Resting) Civic(o api.Options, desk *Desk, d *Dice) (api.ActionRequest, Verdict, error) {
	if cz, ok := r.Inner.(Citizen); ok {
		return cz.Civic(o, desk, d)
	}
	return api.ActionRequest{}, Pass, nil
}
