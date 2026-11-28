package game

import (
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
)

// Forgetting a player (GDD 14.9): the forget command marks the character
// at once and every later command on or to it is refused. At the first
// tick it is free its holdings leave it in one transaction: staged goods
// are destroyed, coin is sunk, and every other good, item and provision
// stays where it stood, in the tile's spoils pool. Its deeds stay in the
// log and the ledger, told to others as a traveller's. The sweep makes no
// draw and writes no fact of its own.

func init() {
	houseTicks = append(houseTicks, forgetTurn)
}

// structural: the ledger key of a character's forgetting, and its kind.
const (
	forgetPrefix = "forget-"
	forgetTxn    = "forget"
)

// forgottenGuard refuses a command on a character asked to be forgotten,
// or one naming such a character as its target.
func (g *Game) forgottenGuard(c *Char, cmd Command) error {
	if c.Forget > 0 {
		return refuse(ForgottenCode, "%s was forgotten and acts no more", c.C.ID)
	}
	if o := g.Char(cmd.Target); o != nil && o.Forget > 0 {
		return refuse(ForgottenCode, "%s was forgotten", o.C.ID)
	}
	return nil
}

// forgetAsked marks a character asked to be forgotten. A forget at tick 0
// is kept as tick 1, since 0 means never asked.
func (g *Game) forgetAsked(c *Char) Result {
	c.Forget = max(g.Tick(), 1)
	c.Version++
	return Result{Char: c}
}

// IsForgotten reports whether a character's player asked to be forgotten:
// a client names it to nobody, and shows it as a traveller.
func (g *Game) IsForgotten(id string) bool {
	c := g.Char(id)
	return c != nil && c.Forget > 0
}

// forgetTurn sets down each forgotten character's carry, then sweeps, in
// id order, each one that is free. One swept before is swept again when
// something it was owed, a refund or a share, has reached it since.
func forgetTurn(g *Game, tick int64) error {
	for _, c := range g.Chars {
		if c.Forget == 0 {
			continue
		}
		g.forgetRelease(c)
		if g.forgetWaits(c) {
			continue
		}
		key := forgetPrefix + c.C.ID
		if c.Forgotten == 0 {
			if err := g.forgetWithdraw(c, key); err != nil {
				return err
			}
		} else {
			if !g.forgetHolds(c) {
				continue
			}
			key = ledger.SubKey(key, strconv.FormatInt(tick, decimal))
		}
		if err := g.forgetHoldings(c, key, tick); err != nil {
			return err
		}
		if c.Forgotten == 0 {
			c.Forgotten = tick
		}
		g.touchOnce(c)
	}
	return nil
}

// forgetRelease sets down any carry the character is part of, since it never
// travels or crawls to end one: a downed player it carried lies where it
// is, its call for help still open.
func (g *Game) forgetRelease(c *Char) {
	if c.Carrying != "" {
		g.setDown(c, g.Char(c.Carrying))
	}
	if c.CarriedBy != "" {
		g.setDown(g.Char(c.CarriedBy), c)
	}
}

// forgetWaits reports whether a character is not yet free to be swept:
// in an encounter that ends on its own (an ambush, or one shared with a
// party).
func (g *Game) forgetWaits(c *Char) bool {
	f := c.Fight
	return f != nil && (f.Ambush || f.Shared != "")
}

// forgetWithdraw ends what a character has under way, each through its own
// path: its long action, a machine or an encounter only it could resolve
// (as a ban ends them), a haul it took, its market orders, the goals it
// posted that may be withdrawn, its shared record (left as a ban leaves
// it), its party and its guild.
func (g *Game) forgetWithdraw(c *Char, key string) error {
	if c.Long != nil {
		if err := g.cancel(c); err != nil {
			return err
		}
	}
	c.Armed = nil
	c.Fight = nil
	for _, x := range g.Goals {
		if x.Cargo == nil || x.State != goal.Live || x.Cargo.Hauler != c.C.ID {
			continue
		}
		if err := g.forgetHaul(c, x, ledger.SubKey(key, "haul", x.ID)); err != nil {
			return err
		}
	}
	var orders []Open
	for o := range g.opens(ledger.Char(c.C.ID), false) {
		orders = append(orders, o)
	}
	for _, o := range orders {
		if err := g.closeOrder(o, ledger.SubKey(key, "order", o.ID)); err != nil {
			return err
		}
	}
	for _, x := range slices.Clone(g.Goals) {
		if x.Poster != c.C.ID || g.MusterGuild(x) != nil || !g.CanWithdraw(x, c) {
			continue
		}
		if err := g.withdrawGoal(c, Command{Key: ledger.SubKey(key, "goal", x.ID), Target: x.ID}); err != nil {
			return err
		}
	}
	g.unshare(c)
	if err := g.quitParty(c, g.Tick()); err != nil {
		return err
	}
	if c.C.Guild != "" {
		return g.leaveGuild(c, key)
	}
	return nil
}

// forgetHaul hands back a haul the character took, since it never travels
// to deliver it: intact, the goal stands untaken and the collateral goes
// back; short, the goal ends as a haul that never arrived.
func (g *Game) forgetHaul(c *Char, x *Goal, key string) error {
	acc, pool, asset := ledger.Char(c.C.ID), goalPool(x.ID), ledger.Goods(x.Cargo.Material)
	n := min(g.Ledger.Of(acc, asset), x.Cargo.Units)
	if n == x.Cargo.Units {
		legs := ledger.Pair(acc, pool, asset, n)
		if x.Cargo.Collateral > 0 {
			legs = append(legs, ledger.Pair(pool, acc, ledger.Coin, x.Cargo.Collateral)...)
		}
		if err := g.postAll(ledger.Txn{Key: key, Kind: forgetTxn, Tick: g.Tick(), Legs: legs}); err != nil {
			return err
		}
		x.Cargo.Release(g.haulCollateral(x))
		return nil
	}
	if n > 0 {
		if err := g.postAll(ledger.Move(key, forgetTxn, g.Tick(), acc, pool, asset, n)); err != nil {
			return err
		}
	}
	return g.endGoal(x, "expired", key)
}

// forgetHolds reports whether a swept character holds anything again.
func (g *Game) forgetHolds(c *Char) bool {
	if c.C.Coin != 0 || c.C.Provisions != 0 || len(c.C.Goods) > 0 || len(c.C.Staged) > 0 || len(c.C.Pack) > 0 {
		return true
	}
	return slices.ContainsFunc(c.Waits, func(at hex.Hex) bool { return len(g.forgetWaitLegs(c, at)) > 0 })
}

// forgetHoldings moves everything a character holds, and the goods that
// wait for it on tiles, in one transaction.
func (g *Game) forgetHoldings(c *Char, key string, tick int64) error {
	acc, pool := ledger.Char(c.C.ID), poolOf(c.C.At)
	var legs []ledger.Leg
	if c.C.Coin > 0 {
		legs = append(legs, ledger.Pair(acc, ledger.ToForgotten, ledger.Coin, c.C.Coin)...)
	}
	if c.C.Provisions > 0 {
		legs = append(legs, ledger.Pair(acc, pool, ledger.Provisions, c.C.Provisions)...)
	}
	for _, s := range c.C.Goods {
		legs = append(legs, ledger.Pair(acc, pool, ledger.Material(s.Material), s.Qty)...)
	}
	for _, s := range c.C.Staged {
		legs = append(legs, ledger.Pair(acc, ledger.ToStaged, ledger.Staged(s.At, s.Material), s.Units)...)
	}
	items := slices.Clone(c.C.Pack)
	var left []*Left
	for _, in := range items {
		// Staged goods never lie on a tile.
		if in.Staged != nil {
			legs = append(legs, itemLegs(in, acc, ledger.ToStaged)...)
			continue
		}
		legs = append(legs, itemLegs(in, acc, pool)...)
		left = append(left, &Left{Hex: c.C.At, By: c.C.ID, Item: in})
	}
	var waits []hex.Hex
	for _, at := range c.Waits {
		w := g.forgetWaitLegs(c, at)
		legs = append(legs, w...)
		if g.forgetWaitKeeps(c, at) {
			waits = append(waits, at)
		}
	}
	if len(legs) > 0 {
		t := ledger.Txn{Key: key, Kind: forgetTxn, Tick: tick, Legs: ledger.Merge(legs)}
		if err := g.postAll(t, items...); err != nil {
			return err
		}
	}
	g.Left = append(g.Left, left...)
	c.Waits = waits
	return nil
}

// forgetWaitLegs move what waits for a character on a tile to that tile's
// pool: coin is sunk, staged goods destroyed. An item stays where it waits.
func (g *Game) forgetWaitLegs(c *Char, at hex.Hex) []ledger.Leg {
	from, to := ledger.WaitPool(at.Ref(), c.C.ID), poolOf(at)
	var legs []ledger.Leg
	for _, b := range g.Ledger.Held(from) {
		switch _, isItem := ledger.ItemOf(b.Asset); {
		case b.Units <= 0, isItem:
		case b.Asset == ledger.Coin:
			legs = append(legs, ledger.Pair(from, ledger.ToForgotten, b.Asset, b.Units)...)
		case ledger.IsStaged(b.Asset):
			legs = append(legs, ledger.Pair(from, ledger.ToStaged, b.Asset, b.Units)...)
		default:
			legs = append(legs, ledger.Pair(from, to, b.Asset, b.Units)...)
		}
	}
	return legs
}

// forgetWaitKeeps reports whether a wait still holds an item once swept.
func (g *Game) forgetWaitKeeps(c *Char, at hex.Hex) bool {
	return slices.ContainsFunc(g.Ledger.Held(ledger.WaitPool(at.Ref(), c.C.ID)), func(b ledger.Balance) bool {
		_, isItem := ledger.ItemOf(b.Asset)
		return isItem && b.Units > 0
	})
}
