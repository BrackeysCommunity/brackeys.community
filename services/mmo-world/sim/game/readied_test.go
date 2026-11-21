package game_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/game"
)

// An operator readies a character for a tier: its worn gear and its
// fighting practice reach the tier's expected levels, nothing is minted,
// and a bad tier or a missing note changes nothing.
func TestSetReady(t *testing.T) {
	p := newPartyGame(t)
	c := p.act(&game.Char{C: &char.Character{}}, game.Command{Kind: game.Create, Option: "knife"}).Char
	tiers := int64(len(p.g.Rules().Book.FightTiers))
	p.refused(c, game.BadArgs, game.Command{Kind: game.SetReady, Units: tiers + 1, Note: "past the ceiling"})
	p.refused(c, game.BadArgs, game.Command{Kind: game.SetReady, Units: 2})
	goods, coin := slices.Clone(c.C.Goods), c.C.Coin
	res := p.act(c, game.Command{Kind: game.SetReady, Units: tiers, Note: "a proof run"})
	ft := p.g.Rules().Fight.Tier(tiers)
	if hand := c.C.In(char.Hand, 0); hand == nil || hand.Level < ft.ExpectedLevel {
		t.Fatalf("the hand after readying: %+v", hand)
	}
	if lv := c.C.PracticeOf("fight").Level; lv < ft.ExpectedPractice {
		t.Fatalf("fight practice %d, want %d", lv, ft.ExpectedPractice)
	}
	if countFacts(res.Facts, "character.readied") != 1 || c.C.Coin != coin || !slices.Equal(goods, c.C.Goods) {
		t.Fatalf("readying wrote %v and left coin %d goods %v", res.Facts, c.C.Coin, c.C.Goods)
	}
}
