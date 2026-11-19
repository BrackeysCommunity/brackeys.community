package game

import (
	"errors"
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// Long is a character's one long action (GDD 6): it comes due tick by
// tick whether or not its owner is there.
type Long struct {
	Kind    string `json:"kind"` // travel, gather or rest
	Key     string `json:"key"`  // the interaction that queued it
	Started int64  `json:"started"`
	Due     int64  `json:"due"`  // when its next step comes due
	Ends    int64  `json:"ends"` // when it is expected to end
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
	// Stop holds a journey's stop conditions.
	Stop *Stop `json:"stop,omitempty"`
}

// woundedTicks is what being wounded adds to a long action (GDD 5.5).
func (g *Game) woundedTicks(c *Char, t int64) int64 {
	if c.C.Has(char.Wounded, t) {
		return g.r.wp("wounded-ticks")
	}
	return 0
}

// Part is one line of a why: a label and what it adds, in a unit.
type Part struct {
	Label string `json:"label"`
	Value int64  `json:"value"`
	Unit  string `json:"unit"`
}

// structural: units and options the rules name.
const (
	unitTicks = "ticks"
	wayOut    = "back-out" // the retreat option, an ambush's default
)

// EnterCost is what stepping from one tile onto the next costs a character
// now, and why: terrain, a suited mount, hunger.
func (g *Game) EnterCost(c *Char, from, to hex.Hex, tick int64) (int64, []Part, bool) {
	cost, ok := g.World.EnterTicks(from, to)
	if !ok {
		return 0, nil, false
	}
	why := []Part{{"terrain", cost, unitTicks}}
	if low, ok := g.lowWater(to, cost); ok {
		why = append(why, Part{TrigLowWater, low - cost, unitTicks})
		cost = low
	}
	if m := c.C.In(char.Mount, 0); m != nil {
		if r := g.r.Mounts.EnterTicks(m, cost, g.ground(to), c.Fed()); r != cost {
			why = append(why, Part{"mount", r - cost, unitTicks})
			cost = r
		}
	}
	if c.C.Has(char.Hungry, tick) {
		n := g.r.wp("hungry-enter-ticks")
		why = append(why, Part{char.Hungry, n, unitTicks})
		cost += n
	}
	if g.Laden(c) {
		n := g.r.wp("laden-enter-ticks")
		why = append(why, Part{"laden", n, unitTicks})
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
			return refuse(NotHere, "no known way to %s", cmd.To.Ref())
		}
	}
	first, _, _ := g.EnterCost(c, c.C.At, route[0], t)
	slow := g.woundedTicks(c, t)
	c.Long = &Long{Kind: Travel, Key: cmd.Key, Started: t, Due: t + first + slow, Ends: t + total + slow, Route: route, StepTicks: first + slow, Stop: cmd.Stop}
	return nil
}

func (g *Game) gather(c *Char, cmd Command) error {
	if err := free(c); err != nil {
		return err
	}
	if cmd.Ticks < g.r.wp("gather-ticks-min") || cmd.Ticks > g.r.wp("gather-ticks-max") {
		return refuse(BadArgs, "a gather takes %d to %d ticks", g.r.wp("gather-ticks-min"), g.r.wp("gather-ticks-max"))
	}
	if cmd.Material != assetProvisions && !slices.Contains(g.Materials(c.C.At), cmd.Material) {
		return refuse(NotHere, "no %s to gather here", cmd.Material)
	}
	if cmd.Material != assetProvisions && g.WorkedOut(c.C.At, cmd.Material) {
		return refuse(NotHere, "the %s here is worked out", cmd.Material)
	}
	t := g.Tick()
	slow := g.woundedTicks(c, t)
	c.Long = &Long{Kind: Gather, Key: cmd.Key, Started: t, Due: t + 1 + slow, Ends: t + cmd.Ticks + slow, Material: cmd.Material, Left: cmd.Ticks}
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
	if !g.CanRest(c.C.At) {
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
	if c.Long.Kind != Travel {
		c.Long = nil
		return nil
	}
	endJourney(c)
	_, err := g.fact(c, "travel.stopped", g.Tick())
	return err
}

// stopFor is the stop condition the next tile of a journey meets, or "".
func (g *Game) stopFor(c *Char, l *Long, next hex.Hex, cost int64) string {
	if l.Stop == nil {
		return ""
	}
	if l.Stop.Threat > 0 {
		if r := g.World.RegionAt(next); r >= 0 && g.World.Regions[r].Gauge[g.World.GaugeIndex("threat")] >= l.Stop.Threat {
			return "threat"
		}
	}
	if l.Stop.Provisions && max(0, l.Spent+cost-g.r.wp("provisions-free-ticks"))-l.Owed > c.C.Provisions {
		return "provisions"
	}
	if l.Stop.Unknown {
		if tl := g.World.Tile(next); tl == nil || tl.Discovered == nil {
			return "unknown"
		}
	}
	return ""
}

// endJourney is every way a journey ends: the hunger it brought ends too.
func endJourney(c *Char) {
	c.Long = nil
	c.C.Clear(char.Hungry)
}

// Advance runs the next tick: abandoned ambushes default, due long actions
// step, and the world advances with their effects and every command's since
// the last tick. Characters it changes get a new version. It returns the
// facts written.
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
			c.Version++
		}
		if c.Long == nil || c.Long.Due > t {
			continue
		}
		c.Version++
		var err error
		switch c.Long.Kind {
		case Travel:
			acts, err = g.enter(c, t, acts)
		case Gather:
			acts, err = g.gatherTick(c, t, acts)
		case Rest:
			err = g.rested(c, t)
		case Crawl:
			err = g.crawled(c, t)
		}
		if err != nil {
			return nil, err
		}
	}
	if t%sheets.TicksPerDay == 0 {
		for _, c := range g.Chars {
			if err := g.upkeep(c, t); err != nil {
				return nil, err
			}
		}
	}
	acts = append(acts, g.Pending...)
	g.Pending = []world.Action{}
	if _, _, err := world.Advance(g.World, g.Log, acts, t); err != nil {
		return nil, err
	}
	out := g.Log.Since(first)
	g.keepNews(out)
	return out, nil
}

// defaulted resolves an ambush its owner was away for with the way out.
// A beat that offers no way out a tick can take ends the ambush with
// nothing won or lost: a refusal here would stop the world.
func (g *Game) defaulted(c *Char, t int64) error {
	key := ledger.SubKey("tick", strconv.FormatInt(t, decimal), c.C.ID, "ambush")
	_, err := g.pressOption(c, key, wayOut, t)
	var ref *Refused
	if errors.As(err, &ref) {
		c.Fight = nil
		_, err = g.fact(c, "ambush.defaulted", t)
		return err
	}
	if err != nil {
		return err
	}
	_, err = g.fact(c, "ambush.defaulted", t, fact.S("option", wayOut))
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
	acts = append(acts, world.Action{Kind: world.ActVisit, Hex: to, By: char.Ref(c.C.ID), Dir: &dir})
	if m := c.C.In(char.Mount, 0); m != nil && c.Fed() {
		g.r.Mounts.Ridden(m, g.ground(to), g.Laden(c))
		c.Rode += l.StepTicks
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
	if err := g.arrived(c, to, ledger.SubKey(l.Key, "arrive", strconv.FormatInt(l.Steps, decimal)), t); err != nil {
		return acts, err
	}
	l.Route = l.Route[1:]
	if g.ambushed(c, to, t) {
		endJourney(c)
		if err := g.begin(c, true, max(l.Ends, t)); err != nil {
			return acts, err
		}
		_, err := g.fact(c, "travel.ambushed", t)
		return acts, err
	}
	if len(l.Route) == 0 {
		endJourney(c)
		_, err := g.fact(c, "travel.arrived", t, fact.N("ticks", l.Spent))
		return acts, err
	}
	cost, why, ok := g.EnterCost(c, to, l.Route[0], t)
	if !ok {
		endJourney(c)
		_, err := g.fact(c, "travel.stopped", t)
		return acts, err
	}
	if why := g.stopFor(c, l, l.Route[0], cost); why != "" {
		endJourney(c)
		_, err := g.fact(c, "travel.stopped", t, fact.S("why", why))
		return acts, err
	}
	for _, p := range why {
		if p.Label == char.Hungry {
			l.Ends += p.Value // the plan left hunger out: the journey ends later
		}
	}
	l.StepTicks, l.Due = cost, t+cost
	return acts, nil
}

// provision charges the journey's provisions past its free ticks. Running
// short does not stop it; the character goes hungry until they pay, the
// journey ends or they rest.
func (g *Game) provision(c *Char, t int64) error {
	l := c.Long
	owe := max(0, l.Spent-g.r.wp("provisions-free-ticks")) - l.Owed
	if owe <= 0 {
		return nil
	}
	l.Owed += owe
	pay := min(owe, c.C.Provisions)
	if pay > 0 {
		key := ledger.SubKey(l.Key, "provisions", strconv.FormatInt(l.Steps, decimal))
		if err := g.receive(c, ledger.Move(key, "provisions", t, ledger.Char(c.C.ID), ledger.ToProvisions, ledger.Provisions, pay)); err != nil {
			return err
		}
	}
	if pay < owe {
		c.C.Set(char.Hungry, 0)
	} else {
		c.C.Clear(char.Hungry)
	}
	return nil
}

// ambushed draws whether entering a tile springs an ambush: only where
// something lives, in a region at the ambush line or above (GDD 4.3, 6).
func (g *Game) ambushed(c *Char, h hex.Hex, t int64) bool {
	r := g.World.RegionAt(h)
	if r < 0 || g.World.Regions[r].Gauge[g.World.GaugeIndex("threat")] < world.LineAt(g.r.Book, "ambush") || len(g.r.Gen.Creatures(h)) == 0 {
		return false
	}
	return g.r.draw.Percent(g.r.wp("ambush-chance"), "game.ambush", draw.Str(c.C.ID), draw.Int(t))
}

func (g *Game) gatherTick(c *Char, t int64, acts []world.Action) ([]world.Action, error) {
	l := c.Long
	key := ledger.SubKey(l.Key, "gather", strconv.FormatInt(l.Steps, decimal))
	var n int64
	if l.Material == assetProvisions {
		n = g.ForageYield(c.C.At)
		if err := g.receive(c, ledger.Move(key, "forage", t, ledger.FromForage, ledger.Char(c.C.ID), ledger.Provisions, n)); err != nil {
			return acts, err
		}
	} else {
		n = min(g.r.wp("gather-units"), g.StockLeft(c.C.At, l.Material))
		if n > 0 {
			if err := g.receive(c, ledger.Move(key, "gather", t, ledger.FromGather, ledger.Char(c.C.ID), ledger.Material(l.Material), n)); err != nil {
				return acts, err
			}
			acts = append(acts, world.Action{Kind: world.ActGather, Hex: c.C.At, By: char.Ref(c.C.ID), Material: l.Material, Units: n})
			if err := g.toolUse(c, t); err != nil {
				return acts, err
			}
		}
	}
	c.C.Practise("gather", 1, g.r.Growth.Params())
	l.Steps++
	l.Left--
	l.Spent += n
	if l.Left > 0 && n > 0 {
		l.Due = t + 1
		return acts, nil
	}
	c.Long = nil
	kind := "gather.done"
	if l.Material == assetProvisions {
		kind = "forage.done"
	} else if g.WorkedOut(c.C.At, l.Material) {
		if err := g.workedOut(c, l.Material, t); err != nil {
			return acts, err
		}
	}
	_, err := g.fact(c, kind, t, fact.S("material", l.Material), fact.N("units", l.Spent))
	return acts, err
}

func (g *Game) rested(c *Char, t int64) error {
	c.Long = nil
	c.C.Clear(char.Wounded)
	c.C.Clear(char.Down)
	c.C.Clear(char.Hungry)
	_, err := g.fact(c, "rest.done", t)
	return err
}
