package game

import (
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
)

// A key is not an item (GDD 5.9, Key-maker): a Key-maker makes one at the
// entrance of a dungeon it has reached the bottom of, paying key-cost
// units of the bottom tier's first material into the crafting sink. It
// cannot be traded, and the third way it opens uses it up.

// KeyCost is what a key for the dungeon at h costs: the material and the
// units; false off a dungeon.
func (g *Game) KeyCost(h hex.Hex) (string, int64, bool) {
	plan, ok := g.r.Gen.Dungeon(h)
	if !ok {
		return "", 0, false
	}
	tier := g.r.Gen.FloorAt(h, plan.Floors, noWay, g.tierAt(h)).Step.Tier
	for _, t := range g.r.Book.FightTiers {
		if t.Tier == tier && len(t.Haul) > 0 {
			return t.Haul[0], g.fp("key-cost"), true
		}
	}
	return "", 0, false
}

func (g *Game) keyMake(c *Char, cmd Command) error {
	if err := free(c); err != nil {
		return err
	}
	if !g.keyMaker(c) {
		return refuse(NoKeyMaker, "making a key takes Key-maker")
	}
	h := c.C.At
	plan, ok := g.r.Gen.Dungeon(h)
	if !ok || c.C.Floor != 0 {
		return refuse(NotHere, "a key is made at a dungeon's entrance")
	}
	if DeepestFloor(c, h) < plan.Floors {
		return refuse(NotHere, "%s has not reached this dungeon's bottom", c.C.ID)
	}
	m, n, ok := g.KeyCost(h)
	if !ok {
		return refuse(NotHere, "nothing here makes a key")
	}
	if g.balance(c, ledger.Material(m)) < n {
		return refuse(Short, "a key takes %d %s", n, m)
	}
	f, err := g.fact(c, "key.made", g.Tick(), append([]fact.Datum{fact.S("material", m), fact.N("units", n)}, fact.At(h)...)...)
	if err != nil {
		return err
	}
	t := ledger.Move(cmd.Key, "key", g.Tick(), ledger.Char(c.C.ID), ledger.ToCraft, ledger.Material(m), n)
	t.Fact = f.ID
	if err := g.receive(c, t); err != nil {
		return err
	}
	c.Keys = append(c.Keys, h.Ref())
	return nil
}
