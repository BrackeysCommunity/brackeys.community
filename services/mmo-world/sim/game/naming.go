package game

import (
	"slices"
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
)

// A dungeon is named once, for good, by the party or the lone delver that
// first slays its guardian (GDD 4.9): its leader gives the name, screened
// like a goal's words, within name-window-days, or the pack names it and
// they are its first held. An operator may hide a name; hidden, the
// dungeon shows its pack name.

// firstSlain makes the first slayers of a dungeon's guardian its namers,
// the leader first.
func (g *Game) firstSlain(h hex.Hex, namers []string, tick int64) error {
	d := g.World.DungeonAt(h)
	if len(namers) == 0 || d.Name != "" || len(d.Namers) > 0 || len(d.NamedBy) > 0 {
		return nil
	}
	d.SlainAt, d.Namers = tick, slices.Clone(namers)
	c := g.Char(namers[0])
	if c == nil {
		_, err := g.worldFact(h, "dungeon.slain-first", refsOf(namers), nil, fact.At(h)...)
		return err
	}
	_, err := g.factWith(c, g.withLead(c, refsOf(namers[1:])), "dungeon.slain-first", tick, fact.At(h)...)
	return err
}

func refsOf(ids []string) []fact.Ref {
	var out []fact.Ref
	for _, id := range ids {
		out = append(out, char.Ref(id))
	}
	return out
}

// namersLeader is who names a dungeon: of its namers, the one who leads
// their party, else the first.
func (g *Game) namersLeader(d *tile.Dungeon) string {
	for _, id := range d.Namers {
		if c := g.Char(id); c != nil {
			if p := g.partyOf(c); p != nil && p.Leader == id {
				return id
			}
		}
	}
	return d.Namers[0]
}

// namingAt is the dungeon a namer means: the one named by To, the one it
// stands on, or the one it alone may name.
func (g *Game) namingAt(c *Char, cmd Command) (hex.Hex, *tile.Dungeon) {
	if cmd.To != nil {
		return *cmd.To, g.recordOf(*cmd.To)
	}
	if d := g.recordOf(c.C.At); d != nil && (len(d.Namers) > 0 || d.Name != "") {
		return c.C.At, d
	}
	var h hex.Hex
	var found *tile.Dungeon
	for _, t := range g.World.Tiles {
		if t.Dungeon != nil && slices.Contains(t.Dungeon.Namers, c.C.ID) {
			if found != nil {
				return hex.Hex{}, nil
			}
			h, found = t.Hex, t.Dungeon
		}
	}
	return h, found
}

func (g *Game) dungeonName(c *Char, cmd Command) error {
	h, d := g.namingAt(c, cmd)
	switch {
	case d != nil && d.Name != "":
		return refuse(Named, "this dungeon is named %s", d.Name)
	case d == nil || len(d.Namers) == 0 || !slices.Contains(d.Namers, c.C.ID):
		return refuse(NotLeader, "%s is not among the first to slay this dungeon's guardian", c.C.ID)
	case g.namersLeader(d) != c.C.ID:
		return refuse(NotLeader, "%s's leader names this dungeon", c.C.ID)
	}
	name := strings.TrimSpace(cmd.Note)
	if name == "" || int64(len([]rune(name))) > g.gp("title-length") || g.blocked(name) != "" {
		return refuse(BadName, "a name is 1 to %d characters the board takes", g.gp("title-length"))
	}
	return g.nameGiven(h, d, name, false, g.Tick())
}

// nameGiven gives a dungeon its name for good, and says who named it.
func (g *Game) nameGiven(h hex.Hex, d *tile.Dungeon, name string, held bool, tick int64) error {
	d.Name, d.NamedBy, d.NamedAt, d.Namers = name, d.Namers, tick, nil
	data := append([]fact.Datum{fact.S("name", name)}, fact.At(h)...)
	if held {
		data = append(data, fact.N("first-held", 1))
	}
	if c := g.Char(d.NamedBy[0]); c != nil {
		_, err := g.factWith(c, refsOf(d.NamedBy[1:]), "dungeon.named", tick, data...)
		return err
	}
	_, err := g.worldFact(h, "dungeon.named", refsOf(d.NamedBy), nil, data...)
	return err
}

// nameDue names a dungeon its first slayers left unnamed past the window:
// the pack's name, and they are its first held.
func (g *Game) nameDue(h hex.Hex, d *tile.Dungeon, now int64) error {
	if len(d.Namers) == 0 || d.Name != "" || now-d.SlainAt < g.fp("name-window-days")*sheets.TicksPerDay {
		return nil
	}
	return g.nameGiven(h, d, g.r.NPC.PlaceName("dungeon", h.Ref()), true, now)
}

// hideName is an operator's hiding of a dungeon's name.
func (g *Game) hideName(_ *Char, cmd Command) error {
	if cmd.To == nil {
		return refuse(BadArgs, "a hide names a dungeon's entrance")
	}
	d := g.recordOf(*cmd.To)
	if d == nil || d.Name == "" || d.Hidden {
		return refuse(BadArgs, "no shown name at %s", cmd.To.Ref())
	}
	d.Hidden = true
	return nil
}

// DungeonName is what a dungeon is called: the name its first slayers
// gave, unless an operator hid it, else its kind's pack name.
func (g *Game) DungeonName(h hex.Hex) string {
	if d := g.recordOf(h); d != nil && d.Name != "" && !d.Hidden {
		return d.Name
	}
	if plan, ok := g.Plan(h); ok {
		return g.r.Name("map.dungeons:" + plan.Kind)
	}
	return ""
}
