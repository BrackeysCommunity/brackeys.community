package game

import (
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/item"
)

// deckSwap swaps the deck in the off-hand for another the character
// carries, once a beat and before its pick, for a holder of Second slot
// (GDD 5.9: carry a second deck).
func (g *Game) deckSwap(c *Char, cmd Command) error {
	if !g.holds(c, measureDecks) {
		return refuse(NoSlot, "%s carries one deck", c.C.ID)
	}
	if c.Fight == nil {
		return refuse(NoFight, "a deck is swapped before a pick on a beat")
	}
	if err := notDown(c); err != nil {
		return err
	}
	e := c.Fight.E
	if sh := g.SharedByID(c.Fight.Shared); sh != nil && sh.pickOf(c.C.ID) != "" {
		return refuse(Picked, "%s has picked on this beat", c.C.ID)
	}
	if c.Swapped == int64(e.At)+1 {
		return refuse(Swapped, "%s has swapped a deck on this beat", c.C.ID)
	}
	in := c.C.Item(cmd.Item)
	if in == nil || !g.isDeck(in) || c.C.Worn(in.ID) {
		return refuse(BadArgs, "a deck swap names a deck carried in the pack")
	}
	if err := c.C.Equip(char.OffHand, 0, in.ID); err != nil {
		return refuse(BadArgs, "%s", err.Error())
	}
	c.Swapped = int64(e.At) + 1
	_, err := g.fact(c, "item.equipped", g.Tick(), fact.S("item", in.ID), fact.S("slot", char.OffHand), fact.N("beat", int64(e.At)+1))
	return err
}

// SwapDecks are the decks c may swap into its off hand now: none unless
// deck-swap would take one.
func (g *Game) SwapDecks(c *Char) []*item.Instance {
	if c.Fight == nil || !g.holds(c, measureDecks) || notDown(c) != nil || c.Swapped == int64(c.Fight.E.At)+1 {
		return nil
	}
	if sh := g.SharedByID(c.Fight.Shared); sh != nil && sh.pickOf(c.C.ID) != "" {
		return nil
	}
	var out []*item.Instance
	for _, in := range c.C.Pack {
		if g.isDeck(in) && !c.C.Worn(in.ID) {
			out = append(out, in)
		}
	}
	return out
}

// structural: the measure Second slot adds a deck to.
const measureDecks = "decks"
