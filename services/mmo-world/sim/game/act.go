package game

import (
	"fmt"
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/world"
)

// Command kinds. The operator's correct, grant, ban and unban are
// commands too, so they are recorded and replayed like any other.
const (
	Create  = "create"
	Step    = "step"
	Travel  = "travel"
	Gather  = "gather"
	Rest    = "rest"
	Cancel  = "cancel"
	Explore = "explore"
	Press   = "press"
	Correct = "correct"
	Grant   = "grant"
	Ban     = "ban"
	Unban   = "unban"
)

// Command is one thing done to the game between ticks. Key is the
// interaction id: every ledger transaction it causes is keyed on it.
type Command struct {
	Key      string   `json:"key"`
	Char     string   `json:"char,omitempty"`
	Kind     string   `json:"kind"`
	Dir      int      `json:"dir,omitempty"`
	To       *hex.Hex `json:"to,omitempty"`
	Material string   `json:"material,omitempty"`
	Ticks    int64    `json:"ticks,omitempty"`
	Option   string   `json:"option,omitempty"`
	Asset    string   `json:"asset,omitempty"`
	Units    int64    `json:"units,omitempty"`
	Note     string   `json:"note,omitempty"`
}

// Operator reports whether a command kind is for operators only.
func Operator(kind string) bool {
	return kind == Correct || kind == Grant || kind == Ban || kind == Unban
}

// Refused is a command the rules turn down. Nothing changed.
type Refused struct {
	Code string // a stable reason a client can branch on
	Msg  string
}

func (r *Refused) Error() string { return r.Code + ": " + r.Msg }

func refuse(code, format string, a ...any) error {
	return &Refused{Code: code, Msg: fmt.Sprintf(format, a...)}
}

// Refusal codes.
const (
	NoSuchChar = "no-such-character"
	Busy       = "busy"
	BadArgs    = "bad-arguments"
	NotHere    = "not-here"
	BannedCode = "banned"
	NoFight    = "no-encounter"
	InActivity = "needs-activity"
)

// Result is what a command did.
type Result struct {
	Char    *Char           `json:"char"`
	Facts   []fact.Fact     `json:"facts"`
	Pressed []fight.Pressed `json:"pressed,omitempty"`
}

// Act applies a command at the current tick. A refused command changes
// nothing. Any other error leaves the game part-way, and the caller
// reloads it.
func (g *Game) Act(cmd Command) (Result, error) {
	if cmd.Key == "" {
		return Result{}, refuse(BadArgs, "a command needs its interaction id")
	}
	first := fact.ID(g.Log.Len())
	var c *Char
	var err error
	var pressed []fight.Pressed
	if cmd.Kind == Create {
		c, err = g.create()
	} else {
		if c = g.Char(cmd.Char); c == nil {
			return Result{}, refuse(NoSuchChar, "no character %q", cmd.Char)
		}
		if c.Banned && !Operator(cmd.Kind) {
			return Result{}, refuse(BannedCode, "character %s is banned", c.C.ID)
		}
		pressed, err = g.act(c, cmd)
	}
	if err != nil {
		return Result{}, err
	}
	c.Version++
	if !Operator(cmd.Kind) {
		c.Acted = g.Tick()
	}
	return Result{Char: c, Facts: g.Log.Since(first), Pressed: pressed}, nil
}

func (g *Game) act(c *Char, cmd Command) ([]fight.Pressed, error) {
	switch cmd.Kind {
	case Step, Travel:
		return nil, g.travel(c, cmd)
	case Gather:
		return nil, g.gather(c, cmd)
	case Rest:
		return nil, g.rest(c, cmd)
	case Cancel:
		return nil, g.cancel(c)
	case Explore:
		return nil, g.explore(c)
	case Press:
		return g.press(c, cmd)
	case Correct:
		return nil, g.correct(c, cmd)
	case Grant:
		return nil, g.grant(c, cmd)
	case Ban, Unban:
		return nil, g.ban(c, cmd.Kind == Ban, cmd.Note)
	}
	return nil, refuse(BadArgs, "unknown command %q", cmd.Kind)
}

// create makes a character at the first starting settlement. Nothing is
// granted: no purse, no kit (GDD 10.1 rule 6).
func (g *Game) create() (*Char, error) {
	g.NextChar++
	id := "c-" + strconv.FormatInt(g.NextChar, decimal)
	c := &Char{C: char.New(id, g.r.Gen.Settlement(0).Hex), Born: g.Tick()}
	g.insert(c)
	_, err := g.fact(c, "character.arrived", g.Tick())
	return c, err
}

// structural: ids are written in decimal.
const decimal = 10

// free reports why a character cannot start something new: a long action
// running or an encounter open.
func free(c *Char) error {
	if c.Long != nil {
		return refuse(Busy, "%s is already %s", c.C.ID, c.Long.Kind)
	}
	if c.Fight != nil {
		return refuse(Busy, "%s is in an encounter", c.C.ID)
	}
	return nil
}

// explore begins an encounter at the site the character stands on.
func (g *Game) explore(c *Char) error {
	if err := free(c); err != nil {
		return err
	}
	site := g.r.Gen.Baseline(c.C.At).Site
	if site == "" || site == gen.PlaceSettlement {
		return refuse(NotHere, "nothing to explore on this tile")
	}
	return g.begin(c, false, 0)
}

// begin assembles an encounter on the character's tile against one of
// the creatures its biome holds, picked by a keyed draw.
func (g *Game) begin(c *Char, ambush bool, due int64) error {
	h := c.C.At
	kinds := g.r.Gen.Creatures(h)
	if len(kinds) == 0 {
		return refuse(NotHere, "nothing lives on this tile")
	}
	c.Encounters++
	id := "e-" + c.C.ID + "-" + strconv.FormatInt(c.Encounters, decimal)
	arch := kinds[g.r.draw.Below(uint64(len(kinds)), "game.creature", draw.Str(id))]
	place := g.World.Place(h).Tags()
	ms := g.measures(h)
	cr := g.r.Fight.Spawn(arch, nil, place, ms)
	e := g.r.Fight.Assemble(fight.Site{ID: id, Place: "tile:" + hexRef(h), Tags: place, Measures: ms, Party: 1}, cr)
	c.Fight = &Fight{E: e, Measures: ms, Ambush: ambush, Due: due}
	return nil
}

func hexRef(h hex.Hex) string {
	return strconv.FormatInt(h.Q, decimal) + "," + strconv.FormatInt(h.R, decimal)
}

// press resolves the current beat with the picked option; an encounter
// that ends pays out its haul and leaves its mark on the tile.
func (g *Game) press(c *Char, cmd Command) ([]fight.Pressed, error) {
	if c.Fight == nil {
		return nil, refuse(NoFight, "%s is in no encounter", c.C.ID)
	}
	return g.pressOption(c, cmd.Key, cmd.Option, g.Tick())
}

func (g *Game) pressOption(c *Char, key, pick string, tick int64) ([]fight.Pressed, error) {
	f := g.r.Fight
	e := c.Fight.E
	_, kit, opts := f.Choices(e, c.C, f.KitOf(c.C), tick)
	o, ok := fight.OptionByID(opts, pick)
	if !ok {
		return nil, refuse(BadArgs, "no option %q on this beat", pick)
	}
	if o.Puzzle {
		return nil, refuse(InActivity, "a machine is worked in the Activity")
	}
	pack := packIDs(c.C)
	pressed, facts, err := f.Press(e, []*fight.Member{{Ch: c.C, Kit: kit, Pick: pick}}, tick)
	if err != nil {
		return nil, err
	}
	for _, x := range facts {
		if _, err := g.Log.Append(x); err != nil {
			return nil, err
		}
	}
	if err := g.lost(c, key, pack, tick); err != nil {
		return nil, err
	}
	if len(pressed) > 0 && pressed[0].Outcome.Success {
		g.Pending = append(g.Pending, world.Action{Kind: world.ActWinBeat, Hex: c.C.At, By: charRef(c.C.ID), Tag: e.Creature.Archetype})
	}
	if e.Over {
		return pressed, g.close(c, key, tick)
	}
	return pressed, nil
}

// close ends an encounter: the haul and any salvage go to the character,
// and the world hears of a kill or a fall.
func (g *Game) close(c *Char, key string, tick int64) error {
	e := c.Fight.E
	c.Fight = nil
	acc := ledger.Char(c.C.ID)
	for i, s := range e.Haul {
		if err := g.receive(c, ledger.Move(key+"/haul/"+strconv.Itoa(i), "haul", tick, ledger.FromHaul, acc, ledger.Material(s.Material), s.Qty)); err != nil {
			return err
		}
	}
	for _, sv := range e.Salvage {
		for i, s := range sv.Spoil {
			if err := g.receive(c, ledger.Move(key+"/salvage/"+strconv.Itoa(i), "salvage", tick, ledger.FromSalvage, acc, ledger.Material(s.Material), s.Qty)); err != nil {
				return err
			}
		}
	}
	switch e.Result {
	case fight.Won:
		g.Pending = append(g.Pending, world.Action{Kind: world.ActSlay, Hex: c.C.At, By: charRef(c.C.ID), Species: e.Creature.Archetype})
	case fight.Lost:
		g.Pending = append(g.Pending, world.Action{Kind: world.ActFall, Hex: c.C.At, By: charRef(c.C.ID)})
	}
	return nil
}

// receive posts a movement into a character's account and adds the goods
// it names to what they carry.
func (g *Game) receive(c *Char, t ledger.Txn) error {
	if err := g.post(t); err != nil {
		return err
	}
	for _, l := range t.Legs {
		if l.Account == ledger.Char(c.C.ID) {
			hold(c.C, l.Asset, l.Units)
		}
	}
	return nil
}

// hold changes what a character carries of a fungible asset.
func hold(c *char.Character, asset string, n int64) {
	switch asset {
	case ledger.Coin:
		c.Coin += n
	case ledger.Provisions:
		c.Provisions += n
	default:
		if m, ok := ledger.MaterialOf(asset); ok {
			c.Goods = addGoods(c.Goods, m, n)
		}
	}
}

func addGoods(list []item.Spoil, material string, n int64) []item.Spoil {
	if n > 0 {
		return item.AddSpoil(list, material, n)
	}
	i := slices.IndexFunc(list, func(s item.Spoil) bool { return s.Material == material })
	if i >= 0 {
		list[i].Qty += n
		if list[i].Qty == 0 {
			list = slices.Delete(list, i, i+1)
		}
	}
	return list
}

func packIDs(c *char.Character) []string {
	out := make([]string, len(c.Pack))
	for i, in := range c.Pack {
		out[i] = in.ID
	}
	return out
}

// lost writes off items that left the pack during a press: broken gear.
func (g *Game) lost(c *Char, key string, before []string, tick int64) error {
	for _, id := range before {
		if c.C.Item(id) == nil {
			if err := g.post(ledger.Move(key+"/lost/"+id, "broke", tick, ledger.Char(c.C.ID), ledger.ToLost, ledger.Item(id), 1)); err != nil {
				return err
			}
		}
	}
	return nil
}

// correct is an operator's correction of a balance, recorded as a fact
// and moved through the operator's source or sink.
func (g *Game) correct(c *Char, cmd Command) error {
	if cmd.Units == 0 || cmd.Note == "" || (cmd.Asset != ledger.Coin && cmd.Asset != ledger.Provisions) && !isMaterial(cmd.Asset) {
		return refuse(BadArgs, "a correction needs a coin, provisions or material asset, units and a note")
	}
	if cmd.Units < 0 && g.Ledger.Of(ledger.Char(c.C.ID), cmd.Asset) < -cmd.Units {
		return refuse(BadArgs, "%s holds less than %d %s", c.C.ID, -cmd.Units, cmd.Asset)
	}
	f, err := g.fact(c, "ledger.corrected", g.Tick(), fact.S("asset", cmd.Asset), fact.N("units", cmd.Units), fact.S("note", cmd.Note))
	if err != nil {
		return err
	}
	from, to := ledger.FromOperator, ledger.Char(c.C.ID)
	units := cmd.Units
	if units < 0 {
		from, to, units = to, ledger.ToOperator, -units
	}
	t := ledger.Move(cmd.Key, "correction", g.Tick(), from, to, cmd.Asset, units)
	t.Fact = f.ID
	if err := g.post(t); err != nil {
		return err
	}
	hold(c.C, cmd.Asset, cmd.Units)
	return nil
}

func isMaterial(asset string) bool { _, ok := ledger.MaterialOf(asset); return ok }

// grant is an operator giving a character a mount of a mounts.kinds row,
// for closed tests until mounts are found, bred and made in play.
func (g *Game) grant(c *Char, cmd Command) error {
	if g.r.Mounts.Kind(cmd.Asset) == nil || cmd.Note == "" {
		return refuse(BadArgs, "a grant needs a mount kind and a note")
	}
	if c.C.In(char.Mount, 0) != nil {
		return refuse(Busy, "%s already has a mount", c.C.ID)
	}
	id := "m-" + cmd.Key
	f, err := g.fact(c, "item.granted", g.Tick(), fact.S("kind", cmd.Asset), fact.S("item", id), fact.S("note", cmd.Note))
	if err != nil {
		return err
	}
	t := ledger.Move(cmd.Key, "grant", g.Tick(), ledger.FromOperator, ledger.Char(c.C.ID), ledger.Item(id), 1)
	t.Fact = f.ID
	if err := g.post(t); err != nil {
		return err
	}
	c.C.Carry(char.Mount, 0, g.r.Mounts.NewMount(id, cmd.Asset))
	return nil
}

func (g *Game) ban(c *Char, on bool, note string) error {
	if note == "" || c.Banned == on {
		return refuse(BadArgs, "a ban or unban needs a note and must change something")
	}
	c.Banned = on
	kind := "character.unbanned"
	if on {
		kind = "character.banned"
		c.Long = nil
	}
	_, err := g.fact(c, kind, g.Tick(), fact.S("note", note))
	return err
}

// measures are the region's gauges a rule may test, at a tile.
func (g *Game) measures(h hex.Hex) []tags.Measure {
	r := g.World.RegionAt(h)
	if r < 0 {
		return nil
	}
	reg := g.World.Regions[r]
	var out []tags.Measure
	for i, gg := range g.r.Book.Gauges {
		out = append(out, tags.Measure{ID: gg.ID, Value: reg.Gauge[i], From: tags.Source{Note: "region:" + world.RegionRef(r)}})
	}
	return out
}
