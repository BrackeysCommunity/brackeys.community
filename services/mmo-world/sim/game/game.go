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
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/world"
)

// Rules are the sheets and keyed systems a game runs on. One per world.
type Rules struct {
	Book    *sheets.Book
	Gen     *gen.Gen
	Fight   *fight.Rules
	Mounts  *item.Mounts
	Growth  *item.Growth
	draw    *draw.Drawer
	roll    draw.Key
	weights fact.Weights
	limits  char.Limits
}

// NewRules wires the systems under a world's keys.
func NewRules(b *sheets.Book, k keys.Set) (*Rules, error) {
	g, err := gen.New(b, k.Generation)
	if err != nil {
		return nil, err
	}
	d := item.NewDeriver(b, k.Quirk)
	gr := item.NewGrowth(b, d, k.Roll)
	f, err := fight.New(b, d, gr, puzzle.New(b, k.Generation), k)
	if err != nil {
		return nil, err
	}
	return &Rules{Book: b, Gen: g, Fight: f, Mounts: item.NewMounts(b, gr), Growth: gr, draw: draw.NewDrawer(k.Roll),
		roll: k.Roll, weights: fact.NewWeights(b.FactWeights), limits: char.LimitsOf(gr.Params())}, nil
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
}

// Fight is an encounter and the measures it was assembled under. An
// ambush waits for its owner through Due, the tick the journey would have
// ended, and at the next tick resolves with its default option (GDD 6).
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
	Log      *fact.Tail     `json:"log"`
	r        *Rules
}

// New founds a world with nobody in it.
func New(r *Rules) (*Game, error) {
	s, err := world.New(r.Book, r.Gen, r.roll)
	if err != nil {
		return nil, err
	}
	return &Game{World: s, Chars: []*Char{}, Pending: []world.Action{}, Log: &fact.Tail{}, r: r}, nil
}

// Attach binds a decoded game to its rules.
func (g *Game) Attach(r *Rules) {
	g.r = r
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
	i, ok := slices.BinarySearchFunc(g.Chars, id, func(c *Char, id string) int { return cmp.Compare(c.C.ID, id) })
	if !ok {
		return nil
	}
	return g.Chars[i]
}

func (g *Game) insert(c *Char) {
	i, _ := slices.BinarySearchFunc(g.Chars, c.C.ID, func(c *Char, id string) int { return cmp.Compare(c.C.ID, id) })
	g.Chars = slices.Insert(g.Chars, i, c)
}

// Digest is the game's identity: its state, the ledger and the chain over
// every fact, as replays compare it.
func (g *Game) Digest() (canon.Sum, error) { return canon.Digest(g) }

// Flush hands over the facts and ledger transactions written since the
// last flush, for a store.
func (g *Game) Flush() ([]fact.Fact, []ledger.Txn) { return g.Log.Flush(), g.Ledger.Flush() }

// Holdings is what the state says each character holds, as ledger
// balances, for the conservation check.
func (g *Game) Holdings() []ledger.Balance {
	var out []ledger.Balance
	for _, c := range g.Chars {
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
		}
	}
	return out
}

func charRef(id string) fact.Ref { return fact.Ref{Kind: "character", ID: id} }

// fact writes a fact of a sheet-weighed kind about a character.
func (g *Game) fact(c *Char, kind string, tick int64, data ...fact.Datum) (fact.Fact, error) {
	region := ""
	if r := g.World.RegionAt(c.C.At); r >= 0 {
		region = world.RegionRef(r)
	}
	f, err := g.r.weights.New(tick, kind, region, []fact.Ref{charRef(c.C.ID)}, nil, data...)
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
