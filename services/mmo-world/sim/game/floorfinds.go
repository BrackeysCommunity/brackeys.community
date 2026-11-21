package game

import (
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/tags"
)

// What fell on a dungeon's floors stays there (GDD 4.9, 8.6): a delver's
// own loss in the floor's pool, found again as What fell here, and a find
// from that pool alone, likelier while the dungeon is haunted. Nothing is
// minted.

// structural: a floor find is drawn as a percent.
const findMeasure = "floor-find"

// remember notes a delver's loss on floor n, which only it finds again.
func (g *Game) remember(c *Char, h hex.Hex, n int64, lost []item.Spoil) {
	i := slices.IndexFunc(c.Dropped, func(d Dropped) bool { return d.Hex == h && d.Floor == n })
	if i < 0 {
		c.Dropped = append(c.Dropped, Dropped{Hex: h, Floor: n})
		i = len(c.Dropped) - 1
	}
	for _, s := range lost {
		c.Dropped[i].Lost = item.AddSpoil(c.Dropped[i].Lost, s.Material, s.Qty)
	}
}

// floorFinds are what a delver entering floor n turns up: its own loss
// there, as much as the pool still holds, and perhaps a find from the
// floor's pool, at floor-find-chance as the place's rules scale it.
func (g *Game) floorFinds(c *Char, h hex.Hex, n int64, key string, place []tags.Tag) error {
	pool := ledger.FloorPool(h.Ref(), n)
	if i := slices.IndexFunc(c.Dropped, func(d Dropped) bool { return d.Hex == h && d.Floor == n }); i >= 0 {
		tr := g.trigger(TrigFell)
		goods := takeFrom(g.Ledger.Held(pool), c.Dropped[i].Lost, tr.Magnitude)
		c.Dropped = slices.Delete(c.Dropped, i, i+1)
		if len(goods) > 0 {
			if err := g.foundIn(c, h, pool, ledger.SubKey(key, "fell"), Find{Trigger: TrigFell, Rarity: rarityCommon, Chance: tr.Chance, Goods: goods}, g.Tick()); err != nil {
				return err
			}
		}
	}
	held := g.Ledger.Held(pool)
	if len(held) == 0 {
		return nil
	}
	chance := g.floorFindChance(c, place)
	if !g.r.draw.Percent(chance, "trigger.floor-find", draw.Str(c.C.ID), draw.Str(h.Ref()), draw.Int(n), draw.Int(g.Tick())) {
		return nil
	}
	tr := g.trigger(TrigSpoils)
	goods := takeFrom(held, nil, tr.Magnitude)
	if len(goods) == 0 {
		return nil
	}
	return g.foundIn(c, h, pool, ledger.SubKey(key, "floor"), Find{Trigger: TrigFloorFind, Rarity: rarityCommon, Chance: fixed.Percent(chance), Goods: goods}, g.Tick())
}

// floorFindChance is floor-find-chance for a character on a floor with
// these site tags: haunted-finds doubles it.
func (g *Game) floorFindChance(c *Char, place []tags.Tag) int64 {
	from := tags.Source{Note: "character:" + c.C.ID}
	subject := tags.Plain(from, append([]tags.Tag{tags.Character}, g.charTags(c)...)...)
	ctx := tags.Context{Place: tags.Plain(tags.Source{Note: "floor"}, place...)}
	return tags.Adjust(g.r.rules, subject, ctx, findMeasure, g.tp("floor-find-chance"))
}

// takeFrom is what a find takes from a pool's balances: of the materials
// wanted (any, for none), at most most units, in the pool's order.
func takeFrom(held []ledger.Balance, wanted []item.Spoil, most int64) []item.Spoil {
	var out []item.Spoil
	for _, b := range held {
		m, ok := ledger.MaterialOf(b.Asset)
		if !ok || most <= 0 {
			continue
		}
		n := b.Units
		if wanted != nil {
			i := slices.IndexFunc(wanted, func(s item.Spoil) bool { return s.Material == m })
			if i < 0 {
				continue
			}
			n = min(n, wanted[i].Qty)
		}
		if n = min(n, most); n > 0 {
			out = item.AddSpoil(out, m, n)
			most -= n
		}
	}
	return out
}

// FloorPoolSeen is what a character with Hoard sense sees of floor n's
// pool before it enters; nil without it.
func (g *Game) FloorPoolSeen(c *Char, h hex.Hex, n int64) []item.Spoil {
	if !g.HoardSense(c) {
		return nil
	}
	return takeFrom(g.Ledger.Held(ledger.FloorPool(h.Ref(), n)), nil, poolShown)
}

// structural: Hoard sense shows a pool whole.
const poolShown = 1 << 40
