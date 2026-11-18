package game

import (
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/world"
)

// Long is a character's one long action (GDD 6): it comes due tick by
// tick whether or not its owner is there.
type Long struct {
	Kind    string `json:"kind"` // travel, gather or rest
	Key     string `json:"key"`  // the interaction that queued it
	Started int64  `json:"started"`
	Due     int64  `json:"due"`  // when its next step comes due
	Ends    int64  `json:"ends"` // when it was planned to end
	Steps   int64  `json:"steps"`
	// Travel: the tiles still to enter, what the next costs, the journey's
	// ticks so far and the provisions charged for them, paid or not.
	Route     []hex.Hex `json:"route,omitempty"`
	StepTicks int64     `json:"stepTicks,omitempty"`
	Spent     int64     `json:"spent,omitempty"`
	Owed      int64     `json:"owed,omitempty"`
	// Gather: the material and the ticks left.
	Material string `json:"material,omitempty"`
	Left     int64  `json:"left,omitempty"`
}

// Part is one line of a why: a label and what it adds, in a unit.
type Part struct {
	Label string `json:"label"`
	Value int64  `json:"value"`
	Unit  string `json:"unit"`
}

// structural: units and tags the rules name.
const (
	unitTicks = "ticks"
	hungry    = "hungry"
	wounded   = "wounded"
	down      = "down"
	wayOut    = "back-out" // the option every beat offers, an ambush's default
)

// EnterCost is what entering to from from costs a character now, and
// why: the tile on foot, a mount that suits it, hunger.
func (g *Game) EnterCost(c *Char, from, to hex.Hex, tick int64) (int64, []Part, bool) {
	cost, ok := g.World.EnterTicks(from, to)
	if !ok {
		return 0, nil, false
	}
	why := []Part{{"terrain", cost, unitTicks}}
	if m := c.C.In(char.Mount, 0); m != nil {
		if r := g.r.Mounts.EnterTicks(m, cost, g.ground(to), true); r != cost {
			why = append(why, Part{"mount", r - cost, unitTicks})
			cost = r
		}
	}
	if c.C.Has(hungry, tick) {
		n := g.r.wp("hungry-enter-ticks")
		why = append(why, Part{hungry, n, unitTicks})
		cost += n
	}
	return cost, why, true
}

// ground is what a mount reads of a tile.
func (g *Game) ground(h hex.Hex) item.Ground {
	b := g.r.Gen.Baseline(h)
	at := item.Ground{Terrain: b.Terrain, River: b.River}
	if t := g.World.Tile(h); t != nil {
		at.Road = t.Road > 0
	}
	return at
}

// Route is the quickest known way to a tile: only tiles someone has
// entered, the destination too.
func (g *Game) Route(c *Char, to hex.Hex) ([]hex.Hex, int64, bool) {
	tick := g.Tick()
	step := func(from, n hex.Hex) (int64, bool) {
		if t := g.World.Tile(n); t == nil || t.Discovered == nil {
			return 0, false
		}
		cost, _, ok := g.EnterCost(c, from, n, tick)
		return cost, ok
	}
	path, cost, ok := hex.Path(c.C.At, to, step, 1, 0)
	if !ok || len(path) <= 1 {
		return nil, 0, false
	}
	return path[1:], cost, true
}

func (g *Game) travel(c *Char, cmd Command) error {
	if err := free(c); err != nil {
		return err
	}
	t := g.Tick()
	var route []hex.Hex
	var total int64
	if cmd.Kind == Step {
		if cmd.Dir < 0 || cmd.Dir >= hex.Directions {
			return refuse(BadArgs, "no direction %d", cmd.Dir)
		}
		route = []hex.Hex{c.C.At.Neighbour(cmd.Dir)}
		cost, _, ok := g.EnterCost(c, c.C.At, route[0], t)
		if !ok {
			return refuse(NotHere, "that way is impassable")
		}
		total = cost
	} else {
		if cmd.To == nil {
			return refuse(BadArgs, "travel needs a destination")
		}
		var ok bool
		if route, total, ok = g.Route(c, *cmd.To); !ok {
			return refuse(NotHere, "no known way to %s", hexRef(*cmd.To))
		}
	}
	first, _, _ := g.EnterCost(c, c.C.At, route[0], t)
	c.Long = &Long{Kind: Travel, Key: cmd.Key, Started: t, Due: t + first, Ends: t + total, Route: route, StepTicks: first}
	return nil
}

func (g *Game) gather(c *Char, cmd Command) error {
	if err := free(c); err != nil {
		return err
	}
	if cmd.Ticks < g.r.wp("gather-ticks-min") || cmd.Ticks > g.r.wp("gather-ticks-max") {
		return refuse(BadArgs, "a gather takes %d to %d ticks", g.r.wp("gather-ticks-min"), g.r.wp("gather-ticks-max"))
	}
	if !slices.Contains(g.Materials(c.C.At), cmd.Material) {
		return refuse(NotHere, "no %s to gather here", cmd.Material)
	}
	t := g.Tick()
	c.Long = &Long{Kind: Gather, Key: cmd.Key, Started: t, Due: t + 1, Ends: t + cmd.Ticks, Material: cmd.Material, Left: cmd.Ticks}
	return nil
}

// Materials are what can be gathered on a tile: its region's.
func (g *Game) Materials(h hex.Hex) []string {
	return g.r.Gen.Region(g.r.Gen.RegionOf(h)).Materials
}

func (g *Game) rest(c *Char, cmd Command) error {
	if err := free(c); err != nil {
		return err
	}
	if g.r.Gen.Baseline(c.C.At).Site != gen.PlaceSettlement {
		return refuse(NotHere, "rest is taken in a settlement")
	}
	t := g.Tick()
	n := g.r.wp("rest-ticks")
	c.Long = &Long{Kind: Rest, Key: cmd.Key, Started: t, Due: t + n, Ends: t + n}
	return nil
}

func (g *Game) cancel(c *Char) error {
	if c.Long == nil {
		return refuse(BadArgs, "%s is doing nothing that can stop", c.C.ID)
	}
	kind := c.Long.Kind
	c.Long = nil
	if kind == Travel {
		_, err := g.fact(c, "travel.stopped", g.Tick())
		return err
	}
	return nil
}

// Advance runs the next tick: ambushes whose owners stayed away take
// their default, long actions due now take their step, and the world
// advances with the effects of both and of every command since the last
// tick. It returns the facts written.
func (g *Game) Advance() ([]fact.Fact, error) {
	t := g.Tick() + 1
	first := fact.ID(g.Log.Len())
	acts := g.Pending
	g.Pending = []world.Action{}
	for _, c := range g.Chars {
		if c.Fight != nil && c.Fight.Ambush && c.Fight.Due < t {
			if err := g.defaulted(c, t); err != nil {
				return nil, err
			}
		}
		if c.Long == nil || c.Long.Due != t {
			continue
		}
		var err error
		switch c.Long.Kind {
		case Travel:
			acts, err = g.enter(c, t, acts)
		case Gather:
			acts, err = g.gatherTick(c, t, acts)
		case Rest:
			err = g.rested(c, t)
		}
		if err != nil {
			return nil, err
		}
	}
	acts = append(acts, g.Pending...)
	g.Pending = []world.Action{}
	if _, _, err := world.Advance(g.World, g.Log, acts, t); err != nil {
		return nil, err
	}
	return g.Log.Since(first), nil
}

// defaulted resolves an ambush its owner was away for with the way out.
func (g *Game) defaulted(c *Char, t int64) error {
	key := "tick/" + strconv.FormatInt(t, decimal) + "/" + c.C.ID + "/ambush"
	if _, err := g.pressOption(c, key, wayOut, t); err != nil {
		return err
	}
	_, err := g.fact(c, "ambush.defaulted", t, fact.S("option", wayOut))
	return err
}

// enter takes the next tile of a journey (GDD 6.1, 6.4): a fact, the
// provisions past the free ticks, and perhaps an ambush.
func (g *Game) enter(c *Char, t int64, acts []world.Action) ([]world.Action, error) {
	l := c.Long
	from, to := c.C.At, l.Route[0]
	dir := from.DirectionTo(to)
	c.C.Walk(to, g.r.limits)
	c.C.Facing = dir
	acts = append(acts, world.Action{Kind: world.ActVisit, Hex: to, By: charRef(c.C.ID), Dir: &dir})
	if m := c.C.In(char.Mount, 0); m != nil {
		g.r.Mounts.Ridden(m, g.ground(to), false)
	}
	c.C.Practise("travel", 1, g.r.Growth.Params())
	l.Spent += l.StepTicks
	l.Steps++
	if err := g.provision(c, t); err != nil {
		return acts, err
	}
	if _, err := g.fact(c, "travel.entered", t, fact.N("q", to.Q), fact.N("r", to.R), fact.N("ticks", l.StepTicks)); err != nil {
		return acts, err
	}
	l.Route = l.Route[1:]
	if g.ambushed(c, to, t) {
		c.Long = nil
		if err := g.begin(c, true, l.Ends); err != nil {
			return acts, err
		}
		_, err := g.fact(c, "travel.ambushed", t)
		return acts, err
	}
	if len(l.Route) == 0 {
		c.Long = nil
		_, err := g.fact(c, "travel.arrived", t, fact.N("ticks", l.Spent))
		return acts, err
	}
	cost, _, ok := g.EnterCost(c, to, l.Route[0], t)
	if !ok {
		c.Long = nil
		_, err := g.fact(c, "travel.stopped", t)
		return acts, err
	}
	l.StepTicks, l.Due = cost, t+cost
	return acts, nil
}

// provision charges the journey's provisions past its free ticks. Running
// short does not stop it; the character goes hungry until they can pay.
func (g *Game) provision(c *Char, t int64) error {
	l := c.Long
	owe := max(0, l.Spent-g.r.wp("provisions-free-ticks")) - l.Owed
	if owe <= 0 {
		return nil
	}
	l.Owed += owe
	pay := min(owe, c.C.Provisions)
	if pay > 0 {
		key := l.Key + "/provisions/" + strconv.FormatInt(l.Steps, decimal)
		if err := g.post(ledger.Move(key, "provisions", t, ledger.Char(c.C.ID), ledger.ToProvisions, ledger.Provisions, pay)); err != nil {
			return err
		}
		c.C.Provisions -= pay
	}
	if pay < owe {
		c.C.Set(hungry, 0)
	} else {
		c.C.Clear(hungry)
	}
	return nil
}

// ambushed draws whether entering a tile springs an ambush: only in a
// region at the ambush line or above (GDD 4.3, 6).
func (g *Game) ambushed(c *Char, h hex.Hex, t int64) bool {
	r := g.World.RegionAt(h)
	if r < 0 || g.World.Regions[r].Gauge[g.World.GaugeIndex("threat")] < g.ambushLine() {
		return false
	}
	return g.r.draw.Percent(g.r.wp("ambush-chance"), "game.ambush", draw.Str(c.C.ID), draw.Int(t))
}

func (g *Game) ambushLine() int64 {
	for _, l := range g.r.Book.GaugeLines {
		if l.Effect == "ambush" {
			return l.AtLeast
		}
	}
	panic("game: no ambush line")
}

func (g *Game) gatherTick(c *Char, t int64, acts []world.Action) ([]world.Action, error) {
	l := c.Long
	n := g.r.wp("gather-units")
	key := l.Key + "/gather/" + strconv.FormatInt(l.Steps, decimal)
	if err := g.receive(c, ledger.Move(key, "gather", t, ledger.FromGather, ledger.Char(c.C.ID), ledger.Material(l.Material), n)); err != nil {
		return acts, err
	}
	acts = append(acts, world.Action{Kind: world.ActGather, Hex: c.C.At, By: charRef(c.C.ID), Material: l.Material, Units: n})
	c.C.Practise("gather", 1, g.r.Growth.Params())
	l.Steps++
	l.Left--
	if l.Left > 0 {
		l.Due = t + 1
		return acts, nil
	}
	c.Long = nil
	_, err := g.fact(c, "gather.done", t, fact.S("material", l.Material), fact.N("units", n*l.Steps))
	return acts, err
}

func (g *Game) rested(c *Char, t int64) error {
	c.Long = nil
	c.C.Clear(wounded)
	c.C.Clear(down)
	_, err := g.fact(c, "rest.done", t)
	return err
}
