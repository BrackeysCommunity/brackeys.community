package game

import (
	"fmt"
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/party"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tally"
	"jams.team/mmo-world/sim/world"
)

// Hunts in the world (GDD 7.6): a creature's health pool over a window,
// worn down by anyone in reach, one press a tick each. The spoils roll
// once at the kill, are minted into the hunt's pool, and are split from
// it by health removed. A hunt left unfinished pays nothing.

// Why a hunt opened.
const (
	WhySpawn    = "spawn"
	WhyOperator = "operator"
)

// huntRef is how a fact names a hunt.
func huntRef(id string) fact.Ref { return fact.Ref{Kind: "hunt", ID: id} }

// huntFact writes a fact of the region holding h, dated tick: a turn of
// the clock writes before the world's tick has moved.
func (g *Game) huntFact(tick int64, h hex.Hex, kind string, subjects []fact.Ref, data ...fact.Datum) error {
	region := ""
	if r := g.World.RegionAt(h); r >= 0 {
		region = world.RegionRef(r)
	}
	f, err := g.r.weights.New(tick, kind, region, subjects, nil, data...)
	if err == nil {
		_, err = g.Log.Append(f)
	}
	return err
}

// OpenHunt opens a hunt of a fights.hunts row on a tile: the spawn rule,
// the operator, and later milestones' troubles and staging all open
// hunts through it. A guardian's row, a tile outside the awake regions or
// off the land, and a second open hunt of the row in the region are
// refused.
func (g *Game) OpenHunt(row string, h hex.Hex, tick int64, why string) (*Hunt, error) {
	def, ok := g.r.Fight.Hunt(row)
	if !ok || def.Kind != "" {
		return nil, refuse(NoSuchRow, "no hunt %q in the world's rows", row)
	}
	r := g.World.RegionAt(h)
	if r < 0 || !g.r.Gen.Passable(g.r.Gen.Baseline(h).Terrain) {
		return nil, refuse(BadArgs, "a hunt opens on passable land inside the awake regions")
	}
	region := world.RegionRef(r)
	if g.openHunt(row, region) != nil {
		return nil, refuse(OpenHunt, "a hunt of %s is already open in %s", row, region)
	}
	ms := g.measures(h)
	id := "hn-" + strconv.FormatInt(g.NextHunt+1, decimal)
	fh, err := g.r.Fight.StartHunt(id, row, fight.Site{Tags: g.World.Place(h).Tags(), Measures: ms}, tick)
	if err != nil {
		return nil, err
	}
	g.NextHunt++
	x := &Hunt{H: fh, Hex: h, Region: region, Why: why, Measures: ms}
	g.Hunts = append(g.Hunts, x)
	err = g.huntFact(tick, h, "hunt.opened", []fact.Ref{huntRef(id), {Kind: "archetype", ID: fh.Creature.Archetype}},
		append(fact.At(h), fact.S("row", row), fact.S("why", why), fact.S("archetype", fh.Creature.Archetype),
			fact.N("health", fh.Max), fact.N("ends", fh.Ends))...)
	g.saw(g.inReach(x)...)
	return x, err
}

// openHunt is the open hunt of a row in a region, or nil.
func (g *Game) openHunt(row, region string) *Hunt {
	for _, x := range g.Hunts {
		if x.H.Row == row && x.Region == region && !x.H.Over {
			return x
		}
	}
	return nil
}

// LiveHunts are the hunts still open, in opening order.
func (g *Game) LiveHunts() []*Hunt {
	var out []*Hunt
	for _, x := range g.Hunts {
		if !x.H.Over {
			out = append(out, x)
		}
	}
	return out
}

// InReach reports whether a character stands where it may press a hunt:
// on its tile or a neighbour, and not inside a dungeon.
func InReach(c *Char, x *Hunt) bool { return c.C.Floor == 0 && party.Within(c.C.At, x.Hex) }

// inReach are the characters standing in reach of a hunt.
func (g *Game) inReach(x *Hunt) []string {
	var out []string
	for _, c := range g.Chars {
		if InReach(c, x) {
			out = append(out, c.C.ID)
		}
	}
	return out
}

// PressedAt is the tick a character last pressed a hunt; false if it never
// has.
func (x *Hunt) PressedAt(who string) (int64, bool) {
	i := slices.IndexFunc(x.Pressed, func(c tally.Count) bool { return c.Key == who })
	if i < 0 {
		return 0, false
	}
	return x.Pressed[i].N, true
}

// HuntOptions are what a character may press a hunt with now, with the
// kit it presses with.
func (g *Game) HuntOptions(c *Char, x *Hunt) (fight.Kit, []fight.Option) {
	e := x.H.Beat()
	k := g.r.Fight.KitOf(c.C)
	k.Self = append(k.Self, g.fightTags(c, e)...)
	_, kit, opts := g.r.Fight.Choices(e, c.C, k, g.Tick())
	return kit, opts
}

// huntPress is one press against a live hunt. Anyone in reach who is not
// down in it may press, once a tick; in a party each member presses for
// themselves. The press that slays it rolls and pays the spoils.
func (g *Game) huntPress(c *Char, cmd Command) ([]fight.Pressed, error) {
	tick := g.Tick()
	x := g.HuntByID(cmd.Target)
	if x == nil || x.H.Over || tick >= x.H.Ends {
		return nil, refuse(NoHunt, "no hunt %q is open", cmd.Target)
	}
	if err := notDown(c); err != nil {
		return nil, err
	}
	if slices.Contains(x.H.Down, c.C.ID) {
		return nil, refuse(DownCode, "%s is down in hunt %s", c.C.ID, x.H.ID)
	}
	if c.Fight != nil {
		return nil, refuse(Busy, "%s is in an encounter", c.C.ID)
	}
	if !InReach(c, x) {
		return nil, refuse(OutOfReach, "hunt %s is out of %s's reach", x.H.ID, c.C.ID)
	}
	if at, ok := x.PressedAt(c.C.ID); ok && at == tick {
		return nil, refuse(Pressed, "%s has pressed hunt %s this tick", c.C.ID, x.H.ID)
	}
	kit, opts := g.HuntOptions(c, x)
	if o, ok := fight.OptionByID(opts, cmd.Option); !ok || o.Puzzle {
		return nil, refuse(BadArgs, "no option %q on hunt %s", cmd.Option, x.H.ID)
	}
	pack := slices.Clone(c.C.Pack)
	salvaged := len(x.H.Salvage)
	health := x.H.Health
	p, facts, err := g.r.Fight.HuntBeat(x.H, &fight.Member{Ch: c.C, Kit: kit, Pick: cmd.Option}, tick)
	if err != nil {
		return nil, err
	}
	x.Pressed.Bump(c.C.ID, tick-x.Pressed.Get(c.C.ID))
	for _, f := range facts {
		f.Region = x.Region
		if _, err := g.Log.Append(f); err != nil {
			return nil, err
		}
	}
	g.deeds(c, []fight.Pressed{p})
	if err := g.lost(c, cmd.Key, pack, tick); err != nil {
		return nil, err
	}
	acc := ledger.Char(c.C.ID)
	for i, sv := range x.H.Salvage[salvaged:] {
		for j, s := range sv.Spoil {
			k := ledger.SubKey(cmd.Key, "salvage", strconv.Itoa(i), strconv.Itoa(j))
			if err := g.receive(c, ledger.Move(k, "salvage", tick, ledger.FromSalvage, acc, ledger.Material(s.Material), s.Qty)); err != nil {
				return nil, err
			}
		}
	}
	if _, err := g.factWith(c, []fact.Ref{huntRef(x.H.ID)}, "hunt.pressed", tick, append(fact.At(x.Hex),
		fact.S("option", cmd.Option), fact.B("success", p.Outcome.Success), fact.N("removed", health-x.H.Health), fact.N("health", x.H.Health))...); err != nil {
		return nil, err
	}
	if x.H.Slain {
		if err := g.huntSlain(c, x, cmd.Key, tick); err != nil {
			return nil, err
		}
	}
	g.saw(slices.DeleteFunc(g.inReach(x), func(id string) bool { return id == c.C.ID })...)
	return []fight.Pressed{p}, nil
}

// huntSlain rolls a slain hunt's spoils once, mints the roll into the
// hunt's pool, and pays each presser its part by health removed. The
// parts sum to the roll exactly; the fact carries the roll and names
// every presser.
func (g *Game) huntSlain(c *Char, x *Hunt, key string, tick int64) error {
	h := x.H
	h.Closed = tick
	x.Rolled = g.r.Fight.Roll(h)
	pool := ledger.HuntPool(h.ID)
	for i, s := range x.Rolled {
		if err := g.post(ledger.Move(ledger.SubKey(key, "hunt", "roll", strconv.Itoa(i)), "hunt", tick, ledger.FromHunt, pool, ledger.Material(s.Material), s.Qty)); err != nil {
			return err
		}
	}
	parts := fight.Split(x.Rolled, h.Removed, g.r.Fight.SplitTie(h.ID))
	var also []fact.Ref
	for _, r := range h.Removed {
		who := g.Char(r.Key)
		if who == nil {
			return fmt.Errorf("game: hunt %s was pressed by %q, who is gone", h.ID, r.Key)
		}
		if who != c {
			also = append(also, char.Ref(who.C.ID))
		}
		for i, s := range parts[r.Key] {
			k := ledger.SubKey(key, "hunt", "part", r.Key, strconv.Itoa(i))
			if err := g.receive(who, ledger.Move(k, "hunt", tick, pool, ledger.Char(r.Key), ledger.Material(s.Material), s.Qty)); err != nil {
				return err
			}
		}
		if who != c && len(parts[r.Key]) > 0 {
			g.touch(who)
		}
	}
	data := append(fact.At(x.Hex), fact.S("hunt", h.ID), fact.S("row", h.Row), fact.S("archetype", h.Creature.Archetype),
		fact.S("tags", joinTags(h.Creature.Tags)), fact.N("hunters", int64(len(h.Removed))), fact.N("health", h.Max))
	for _, s := range x.Rolled {
		data = append(data, fact.N("rolled:"+s.Material, s.Qty))
	}
	_, err := g.factWith(c, append(also, huntRef(h.ID)), "hunt.slain", tick, data...)
	return err
}

// HuntParts are a slain hunt's parts: its roll split by health removed,
// as it was paid.
func (g *Game) HuntParts(x *Hunt) map[string][]item.Spoil {
	if !x.H.Slain {
		return map[string][]item.Spoil{}
	}
	return fight.Split(x.Rolled, x.H.Removed, g.r.Fight.SplitTie(x.H.ID))
}

// huntStart is the operator's hunt-start: a hunt of a row on a tile, with
// no character behind it.
func (g *Game) huntStart(cmd Command) error {
	if cmd.Asset == "" || cmd.To == nil {
		return refuse(BadArgs, "hunt-start needs a hunts row and a tile")
	}
	_, err := g.OpenHunt(cmd.Asset, *cmd.To, g.Tick(), WhyOperator)
	return err
}

// huntsTurn closes on the tick every hunt whose window has run out
// unfinished, and settles the dungeons' guardians.
func (g *Game) huntsTurn(tick int64) error {
	for _, x := range g.Hunts {
		h := x.H
		if h.Over || tick < h.Ends {
			continue
		}
		h.Close(tick)
		h.Closed = tick
		if err := g.huntFact(tick, x.Hex, "hunt.left", []fact.Ref{huntRef(h.ID), {Kind: "archetype", ID: h.Creature.Archetype}},
			append(fact.At(x.Hex), fact.S("row", h.Row), fact.S("archetype", h.Creature.Archetype), fact.N("health", h.Health),
				fact.N("max", h.Max), fact.N("hunters", int64(len(h.Removed))))...); err != nil {
			return err
		}
		g.saw(g.inReach(x)...)
	}
	return g.guardiansTurn(tick)
}

// huntsDay forgets hunts that closed before the day began, and runs the
// spawn rule: in each awake region, each row with a spawn chance whose
// creature stands there at or above its line, with none of the row open
// there, opens with its chance on a tile of the region it lives on.
func (g *Game) huntsDay(day int64) error {
	t := g.Tick()
	g.Hunts = slices.DeleteFunc(g.Hunts, func(x *Hunt) bool { return x.H.Over && x.H.Closed < t })
	for _, row := range g.r.Book.Hunts {
		if row.SpawnChance <= 0 || row.Kind != "" {
			continue
		}
		for r := range g.World.Regions {
			region := world.RegionRef(r)
			if g.openHunt(row.ID, region) != nil {
				continue
			}
			parts := []draw.Part{draw.Str(row.ID), draw.Str(region), draw.Int(day)}
			if !g.r.draw.Percent(row.SpawnChance, "hunt.spawn", parts...) {
				continue
			}
			tiles, pop, capacity := g.herd(r, row.Creature)
			if len(tiles) == 0 || !fixed.AtPercent(pop, capacity, row.SpawnLine) {
				continue
			}
			h := tiles[g.r.draw.Below(uint64(len(tiles)), "hunt.where", parts...)]
			if _, err := g.OpenHunt(row.ID, h, t, WhySpawn); err != nil {
				return err
			}
		}
	}
	return nil
}

// herd is a creature in a region: the passable tiles outside settlements
// it lives on, and its population and capacity over the region.
func (g *Game) herd(r int, species string) (tiles []hex.Hex, pop, capacity int64) {
	for _, h := range g.r.Gen.RegionTiles(g.World.Regions[r].Lattice) {
		n := g.World.Capacity(h, species)
		if n == 0 {
			continue
		}
		capacity += n
		pop += g.World.Population(h, species)
		if b := g.r.Gen.Baseline(h); g.r.Gen.Passable(b.Terrain) && b.Site != gen.PlaceSettlement {
			tiles = append(tiles, h)
		}
	}
	return tiles, pop, capacity
}

// huntDraft is what thin herds near a settlement suggest (GDD 8.6): when
// a region near it holds its creature under the thin-herds line, finish
// the nearest open hunt instead, a Defeat of the hunt's creature where it
// stands.
func (g *Game) huntDraft(n int) (Draft, bool) {
	h := g.SettlementHex(n)
	line := g.trigger(TrigThin).Magnitude
	thin := false
	for _, r := range g.RegionsNear(h) {
		sp := g.r.Gen.Region(g.World.Regions[r].Lattice).Creature
		if sp == "" {
			continue
		}
		if _, pop, capacity := g.herd(r, sp); capacity > 0 && !fixed.AtPercent(pop, capacity, line) {
			thin = true
			break
		}
	}
	if !thin {
		return Draft{}, false
	}
	var best *Hunt
	for _, x := range g.LiveHunts() {
		if d := hex.Distance(x.Hex, h); d <= g.Near() && (best == nil || d < hex.Distance(best.Hex, h)) {
			best = x
		}
	}
	if best == nil {
		return Draft{}, false
	}
	name := g.r.Name("fights.hunts:" + best.H.Row)
	return Draft{Why: "the herds near here are thin, and " + name + " is out",
		Spec: GoalSpec{Title: "Bring down " + name, Issuer: goal.ByCharacter, Mode: goal.First, Lifetime: goal.Ephemeral, Turnover: goal.Expire,
			Ticks: sheets.TicksPerDay, Reward: g.gp("reward-least"),
			Cond: goal.Condition{Verb: goal.Defeat, Kind: best.H.Creature.Archetype, Count: 1, At: goal.RegionRef(best.Region)}}}, true
}
