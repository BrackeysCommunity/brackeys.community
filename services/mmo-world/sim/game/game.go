// Package game is a world with people in it: the world, its characters,
// their long actions, the ledger and the fact log, moved forward by player
// commands between ticks and by the tick itself (GDD 6). Commands change
// characters and the ledger at once and leave world-side effects pending;
// the next tick applies them, so a recorded run of commands and ticks
// replays to the same digest.
package game

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/craft"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/econ"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/faucet"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/tally"
	"jams.team/mmo-world/sim/world"
)

// Rules are the sheets and keyed systems a game runs on. One per world.
type Rules struct {
	Book    *sheets.Book
	Gen     *gen.Gen
	Fight   *fight.Rules
	Mounts  *item.Mounts
	Growth  *item.Growth
	Crafter *craft.Crafter
	NPC     *npc.Rules
	Values  *econ.Values
	Faucet  faucet.Params
	names   map[string]string // pack names by sheet:id
	// processStations lists the stations each process is done at.
	processStations map[string][]string
	draw            *draw.Drawer
	roll            draw.Key
	weights         fact.Weights
	limits          char.Limits
}

// NewRules wires the systems under a world's keys.
func NewRules(b *sheets.Book, k keys.Set) (*Rules, error) {
	g, err := gen.New(b, k.Generation)
	if err != nil {
		return nil, err
	}
	s, err := fight.Wire(b, k)
	if err != nil {
		return nil, err
	}
	r := &Rules{Book: b, Gen: g, Fight: s.Fight, Mounts: s.Mounts, Growth: s.Growth, Crafter: craft.New(b, s.Deriver, s.Growth, k.Roll),
		Values: econ.New(b), Faucet: faucet.ParamsOf(b.EconomyParams), NPC: npc.New(b, k.Generation, k.Roll), names: map[string]string{}, processStations: map[string][]string{}, draw: draw.NewDrawer(k.Roll),
		roll: k.Roll, weights: fact.NewWeights(b.FactWeights), limits: char.LimitsOf(s.Growth.Params())}
	for _, n := range b.Names {
		r.names[n.Ref] = n.Name
	}
	for _, p := range b.Processes {
		r.processStations[p.ID] = p.Stations
	}
	return r, nil
}

func (r *Rules) wp(id string) int64 { return sheets.IntParam(r.Book.WorldParams, id) }

// Char is a character as the game holds it: the sim's character, the row
// version a command must name, and what it is doing.
type Char struct {
	C       *char.Character `json:"c"`
	Version int64           `json:"version"`
	Born    int64           `json:"born"`
	Acted   int64           `json:"acted"` // the tick of its last command
	Banned  bool            `json:"banned,omitempty"`
	Long    *Long           `json:"long,omitempty"`
	// Fight is an encounter in progress: explored, or sprung by an ambush.
	Fight *Fight `json:"fight,omitempty"`
	// Encounters counts encounters begun, naming each one.
	Encounters int64 `json:"encounters"`
	// Start is the thing it chose to have carried (GDD 3.1).
	Start string `json:"start,omitempty"`
	// Rode is ticks ridden this world day; Owed the upkeep its mount was
	// not fed (GDD 6.2).
	Rode int64 `json:"rode,omitempty"`
	Owed int64 `json:"owed,omitempty"`
	// Seen is the tick its owner last opened the hub, for the recap.
	Seen int64 `json:"seen,omitempty"`
	// Server is the Discord server it plays from; HideSame and NameOther
	// are its naming consent (GDD 4.18).
	Server    string `json:"server,omitempty"`
	HideSame  bool   `json:"hideSame,omitempty"`
	NameOther bool   `json:"nameOther,omitempty"`
	// Dropped is haul it lost and may find again; Finds what triggers
	// turned up for it, newest last.
	Dropped []Dropped `json:"dropped,omitempty"`
	Finds   []Find    `json:"finds,omitempty"`
	// Sold is coin sold to each faction, by standing key, for the standing
	// it earns (GDD 5.4).
	Sold tally.Tally `json:"sold,omitempty"`
	// Visits are when it last stood in each settlement (GDD 10.6).
	Visits []Visit `json:"visits,omitempty"`
	// Gave is what it gave away on world day GaveDay, while young.
	Gave    int64 `json:"gave,omitempty"`
	GaveDay int64 `json:"gaveDay,omitempty"`
	// Hours are the world hours of HoursDay it acted in; Streak the days
	// running it acted in nearly all of them; Review its flags for an
	// operator (GDD 10.9).
	Hours    uint32   `json:"hours,omitempty"`
	HoursDay int64    `json:"hoursDay,omitempty"`
	Streak   int64    `json:"streak,omitempty"`
	Review   []string `json:"review,omitempty"`
}

// Fight is an encounter and the measures it was assembled under. An
// ambush waits for its owner through Due (the journey's expected end, at
// the earliest now) and then resolves with its default option (GDD 6).
type Fight struct {
	E        *fight.Encounter `json:"e"`
	Measures []tags.Measure   `json:"measures"`
	Ambush   bool             `json:"ambush,omitempty"`
	Due      int64            `json:"due,omitempty"`
}

// Game is the whole of a world's state. Its JSON is a snapshot; Attach
// makes a decoded one runnable.
type Game struct {
	World    *world.State   `json:"world"`
	Chars    []*Char        `json:"chars"` // sorted by id
	Ledger   ledger.Book    `json:"ledger"`
	Pending  []world.Action `json:"pending"` // world effects of commands, for the next tick
	NextChar int64          `json:"nextChar"`
	Kinds    Kinds          `json:"kinds"`
	Left     []*Left        `json:"left,omitempty"` // items lying on tiles
	NPCs     npc.Book       `json:"npcs"`
	News     []News         `json:"news"`
	Market   *Market        `json:"market,omitempty"`
	Log      *fact.Tail     `json:"log"`
	r        *Rules
}

// New founds a world with nobody in it.
func New(r *Rules) (*Game, error) {
	s, err := world.New(r.Book, r.Gen, r.roll)
	if err != nil {
		return nil, err
	}
	g := &Game{World: s, Chars: []*Char{}, Pending: []world.Action{}, Log: &fact.Tail{}, Kinds: Kinds{List: []*item.Kind{}, Made: []KindCount{}},
		NPCs: npc.Book{List: []*npc.NPC{}}, News: []News{}, r: r}
	r.Fight.D.Reg = &g.Kinds
	g.Market = g.newMarket()
	return g, g.postFactionOrders(g.Tick())
}

// Attach binds a decoded game to its rules.
func (g *Game) Attach(r *Rules) {
	g.r = r
	r.Fight.D.Reg = &g.Kinds
	g.NPCs.Rebuild()
	g.World.Attach(r.Book, r.Gen, r.roll)
	if g.Log == nil {
		g.Log = &fact.Tail{}
	}
	for _, c := range g.Chars {
		if c.Fight != nil {
			c.Fight.E.Measures = c.Fight.Measures
		}
	}
}

func (g *Game) Rules() *Rules { return g.r }
func (g *Game) Tick() int64   { return g.World.Tick }

// Char finds a character, or nil.
func (g *Game) Char(id string) *Char {
	i, ok := slices.BinarySearchFunc(g.Chars, id, byID)
	if !ok {
		return nil
	}
	return g.Chars[i]
}

func (g *Game) insert(c *Char) {
	i, _ := slices.BinarySearchFunc(g.Chars, c.C.ID, byID)
	g.Chars = slices.Insert(g.Chars, i, c)
}

func byID(c *Char, id string) int { return cmp.Compare(c.C.ID, id) }

// Digest is the game's identity: its state, the ledger and the chain over
// every fact, as replays compare it.
// Saved NPCs count through the book's chain alone, so the digest of a
// world day does not grow with them.
func (g *Game) Digest() (canon.Sum, error) {
	view := *g
	view.NPCs = npc.Book{Chain: g.NPCs.Chain}
	return canon.Digest(&view)
}

// Flush hands over the facts and ledger transactions written since the
// last flush, for a store.
func (g *Game) Flush() ([]fact.Fact, []ledger.Txn) { return g.Log.Flush(), g.Ledger.Flush() }

// Holdings is what the state says each character holds, as ledger
// balances, for the conservation check.
func (g *Game) Holdings() []ledger.Balance { return HoldingsOf(g.Chars) }

// HoldingsOf is what characters hold, as ledger balances.
func HoldingsOf(chars []*Char) []ledger.Balance {
	var out []ledger.Balance
	for _, c := range chars {
		acc := ledger.Char(c.C.ID)
		add := func(asset string, n int64) {
			if n != 0 {
				out = append(out, ledger.Balance{Account: acc, Asset: asset, Units: n})
			}
		}
		add(ledger.Coin, c.C.Coin)
		add(ledger.Provisions, c.C.Provisions)
		for _, s := range c.C.Goods {
			add(ledger.Material(s.Material), s.Qty)
		}
		for _, in := range c.C.Pack {
			add(ledger.Item(in.ID), 1)
			if in.Exploit != nil {
				add(ledger.Item(in.Exploit.ID), 1)
			}
		}
	}
	return out
}

// fact writes a fact of a sheet-weighed kind about a character.
func (g *Game) fact(c *Char, kind string, tick int64, data ...fact.Datum) (fact.Fact, error) {
	return g.factWith(c, nil, kind, tick, data...)
}

// factWith writes a fact about a character and others it names; a heavy
// one stays in the character's memory.
func (g *Game) factWith(c *Char, also []fact.Ref, kind string, tick int64, data ...fact.Datum) (fact.Fact, error) {
	region := ""
	if r := g.World.RegionAt(c.C.At); r >= 0 {
		region = world.RegionRef(r)
	}
	f, err := g.r.weights.New(tick, kind, region, append([]fact.Ref{char.Ref(c.C.ID)}, also...), nil, data...)
	if err != nil {
		return f, err
	}
	f.ID, err = g.Log.Append(f)
	if err == nil && f.Weight >= sheets.IntParam(g.r.Book.TileParams, "heavy-fact-weight") {
		c.C.Remember(f.ID, g.r.limits)
	}
	return f, err
}

// post moves goods or coin through the ledger.
func (g *Game) post(t ledger.Txn) error { return g.Ledger.Post(t) }
