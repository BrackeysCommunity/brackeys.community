package game

import (
	"math/bits"
	"slices"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/sheets"
)

// Young reports whether a character is under young-days old, and capped
// on what it gives away (GDD 10.9).
func (g *Game) Young(c *Char) bool {
	return g.Tick()-c.Born < g.mp("young-days")*sheets.TicksPerDay
}

// GaveToday is what a young character has given away this world day.
func (g *Game) GaveToday(c *Char) int64 {
	if c.GaveDay != g.World.Day {
		return 0
	}
	return c.Gave
}

// mayGive reports why a young character may not give value away.
func (g *Game) mayGive(c *Char, value int64) error {
	if value <= 0 || !g.Young(c) {
		return nil
	}
	if gave, most := g.GaveToday(c), g.mp("young-cap"); gave+value > most {
		return refuse(Busy, "%s is under %d world days old and may give away %d coin a day; %d coin given today", c.C.ID, g.mp("young-days"), most, gave)
	}
	return nil
}

// gave counts value a character gave away today.
func (g *Game) gave(c *Char, value int64) {
	if value > 0 && g.Young(c) {
		c.Gave, c.GaveDay = g.GaveToday(c)+value, g.World.Day
	}
}

// canGive is mayGive, counting the value when it may.
func (g *Game) canGive(c *Char, value int64) error {
	if err := g.mayGive(c, value); err != nil {
		return err
	}
	g.gave(c, value)
	return nil
}

// offValue is how far a fill's price sits from reference value, as value
// the seller (under it) or the buyer (over it) gives away.
func offValue(ref, price, qty int64) (sellerGives, buyerGives int64) {
	return max(0, ref-price) * qty, max(0, price-ref) * qty
}

// checkGive refuses a sale between two characters that would take a
// young one past its cap (GDD 10.9), counting what each gives when count
// is set and it may.
func (g *Game) checkGive(sellerAcc, buyerAcc string, ref, price, qty int64, count bool) error {
	seller, buyer := g.charOf(sellerAcc), g.charOf(buyerAcc)
	if seller == nil || buyer == nil {
		return nil
	}
	sg, bg := offValue(ref, price, qty)
	if err := g.mayGive(seller, sg); err != nil {
		return err
	}
	if err := g.mayGive(buyer, bg); err != nil {
		return err
	}
	if count {
		g.gave(seller, sg)
		g.gave(buyer, bg)
	}
	return nil
}

// capped reports whether a fill would take a young character past its
// cap; a fill it lets through counts toward the cap.
func (g *Game) capped(material string, bid, ask market.Order, price, qty int64) bool {
	return g.checkGive(ask.Owner, bid.Owner, g.r.Values.Asset(material), price, qty, true) != nil
}

// give hands coin, goods or an item to another character on the same
// tile; a young character is capped (GDD 10.9).
func (g *Game) give(c *Char, cmd Command) error {
	if err := canTrade(c); err != nil {
		return err
	}
	to := g.Char(cmd.Target)
	if to == nil || to == c || to.C.At != c.C.At {
		return refuse(NotHere, "%q is not here", cmd.Target)
	}
	from, dest := ledger.Char(c.C.ID), ledger.Char(to.C.ID)
	if cmd.Item != "" {
		in, err := unworn(c, cmd.Item)
		if err != nil {
			return err
		}
		if err := g.canGive(c, g.ItemValue(in)); err != nil {
			return err
		}
		if err := g.postAll(ledger.Txn{Key: cmd.Key, Kind: "give", Tick: g.Tick(), Legs: itemLegs(in, from, dest)}, in); err != nil {
			return err
		}
	} else {
		material, isGoods := ledger.GoodsOf(cmd.Asset)
		isGoods = isGoods && g.tradable(material)
		if cmd.Units <= 0 || g.Ledger.Of(from, cmd.Asset) < cmd.Units || (cmd.Asset != ledger.Coin && !isGoods) {
			return refuse(BadArgs, "%s does not carry %d %s", c.C.ID, cmd.Units, cmd.Asset)
		}
		value := cmd.Units
		if isGoods {
			value *= g.r.Values.Asset(material)
		}
		if err := g.canGive(c, value); err != nil {
			return err
		}
		if err := g.postAll(ledger.Move(cmd.Key, "give", g.Tick(), from, dest, cmd.Asset, cmd.Units)); err != nil {
			return err
		}
	}
	if g.Market != nil && cmd.Asset == ledger.Coin {
		g.Market.Week.between(cmd.Units)
	}
	_, err := g.factWith(c, []fact.Ref{char.Ref(to.C.ID)}, "character.gave", g.Tick(), fact.S("asset", cmd.Asset), fact.N("units", cmd.Units), fact.S("item", cmd.Item))
	return err
}

// cadence marks the world hour a character acted in; a character that
// acts in nearly every hour of a day, days running, is flagged for an
// operator to review, never banned (GDD 10.9).
func (g *Game) cadence(c *Char, t int64) error {
	day := t / sheets.TicksPerDay
	if c.HoursDay != day {
		if c.HoursDay == day-1 && int64(bits.OnesCount32(c.Hours)) >= g.mp("cadence-hours") {
			c.Streak++
		} else {
			c.Streak = 0
		}
		c.Hours, c.HoursDay = 0, day
	}
	c.Hours |= 1 << ((t % sheets.TicksPerDay) / sheets.TicksPerHour)
	if c.Streak >= g.mp("cadence-days") && !slices.Contains(c.Review, flagCadence) {
		c.Review = append(c.Review, flagCadence)
		_, err := g.fact(c, "character.flagged", t, fact.S("flag", flagCadence), fact.N("days", c.Streak))
		return err
	}
	return nil
}

// structural: the review flag a steady cadence raises.
const flagCadence = "cadence"
