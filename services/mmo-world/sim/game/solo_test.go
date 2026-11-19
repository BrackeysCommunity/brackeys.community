package game_test

import (
	"errors"
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
)

// solo drives one character through the first sitting: out to the
// nearest site, fights until its tool reaches the first milestone, home,
// sells to a faction order and crafts.
type solo struct {
	t    *testing.T
	g    *game.Game
	c    *game.Char
	n    int
	home hex.Hex
}

func (s *solo) act(cmd game.Command) error {
	s.n++
	cmd.Key = fmt.Sprintf("p%d", s.n)
	cmd.Char = s.c.C.ID
	_, err := s.g.Act(cmd)
	var r *game.Refused
	if err != nil && !errors.As(err, &r) {
		s.t.Fatal(err)
	}
	return err
}

func (s *solo) wait() {
	for s.c.Long != nil {
		if _, err := s.g.Advance(); err != nil {
			s.t.Fatal(err)
		}
	}
}

// walk steps tile by tile along the world's quickest path.
func (s *solo) walk(to hex.Hex) {
	path, _, ok := s.g.World.Path(s.c.C.At, to)
	if !ok {
		s.t.Fatalf("no path to %v", to)
	}
	for _, h := range path[1:] {
		if err := s.act(game.Command{Kind: game.Step, Dir: s.c.C.At.DirectionTo(h)}); err != nil {
			s.t.Fatalf("step to %v: %v", h, err)
		}
		s.wait()
		s.fight()
	}
}

// fight presses the best-banded winning option, else holds, until the
// encounter ends.
func (s *solo) fight() {
	for s.c.Fight != nil {
		ch := s.g.Choose(s.c)
		pick := ""
		var band int64 = -1
		for _, o := range ch.Fight.Options {
			if !o.Puzzle && o.Kind == "win" && o.Band > band {
				pick, band = o.ID, o.Band
			}
		}
		// One failure from going down, a careful player leaves unless the
		// odds are better than even.
		if s.c.Fight.E.Failures.Get(s.c.C.ID) > 0 && band < likely {
			pick = ""
		}
		if pick == "" {
			pick = "back-out"
		}
		if pick == "" {
			pick = "hold"
			if !slices.ContainsFunc(ch.Fight.Options, func(o fight.Option) bool { return o.ID == pick }) {
				pick = "back-out"
			}
		}
		if err := s.act(game.Command{Kind: game.Press, Option: pick}); err != nil {
			s.t.Fatalf("press %s: %v", pick, err)
		}
	}
}

// likely is the Likely band's rank.
const likely = 4

func TestSoloLoop(t *testing.T) {
	r := rules(t)
	g, err := game.New(r)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := g.Act(game.Command{Key: "new", Kind: game.Create, Option: "knife"}); err != nil {
		t.Fatal(err)
	}
	s := &solo{t: t, g: g, c: g.Chars[0]}
	s.home = s.c.C.At
	tool := s.c.C.In(char.Hand, 0)
	if tool == nil || tool.Level != 1 {
		t.Fatalf("no tier-1 knife in hand: %+v", s.c.C.Equipped)
	}
	site, ok := nearestSite(g, s.home)
	if !ok {
		t.Fatal("no site near the start")
	}
	t.Logf("start %v, site %v (%d tiles)", s.home, site, hex.Distance(s.home, site))
	s.walk(site)
	for i := 0; tool.Level < 5 && i < 60; i++ {
		if s.c.C.Has(char.Down, g.Tick()) {
			if err := s.act(game.Command{Kind: game.Crawl}); err != nil {
				t.Fatal(err)
			}
			s.wait()
		}
		if s.act(game.Command{Kind: game.Explore}) != nil {
			if _, err := g.Advance(); err != nil {
				t.Fatal(err)
			}
			continue
		}
		s.fight()
		t.Logf("encounter %d: level %d, xp %d, durability %d of %d, conditions %v, goods %v", i, tool.Level, tool.XP, tool.Durability, tool.MaxDurability, s.c.C.Conditions, s.c.C.Goods)
		if tool.Durability < tool.MaxDurability/3 {
			break
		}
	}
	if s.c.C.Has(char.Down, g.Tick()) {
		if err := s.act(game.Command{Kind: game.Crawl}); err != nil {
			t.Fatal(err)
		}
		s.wait()
	}
	t.Logf("tool level %d after %d presses, %d ticks; goods %v", tool.Level, s.n, g.Tick(), s.c.C.Goods)
	if tool.Level < 5 {
		t.Fatalf("tool level %d", tool.Level)
	}
	gathered := g.Materials(s.c.C.At)[0]
	if err := s.act(game.Command{Kind: game.Gather, Material: gathered, Ticks: 1}); err != nil {
		t.Fatal(err)
	}
	s.wait()
	s.walk(s.home)
	sold := int64(0)
	for _, o := range g.Orders(s.home) {
		if n := g.Ledger.Of(ledger.Char(s.c.C.ID), ledger.Material(o.Material)); n > 0 && o.Material != gathered {
			if s.act(game.Command{Kind: game.Sell, Material: o.Material, Units: n}) == nil {
				sold += n
			}
		}
	}
	if sold == 0 || s.c.C.Coin == 0 {
		t.Fatalf("sold %d goods for %d coin", sold, s.c.C.Coin)
	}
	t.Logf("sold %d goods for %d coin", sold, s.c.C.Coin)
	{
		rec := item.Recipe{Process: "shape", Method: "narrow-grind", Slot: "tool", Inputs: []item.Input{{Kind: gathered, Qty: 2}}}
		ap, err := g.Appraise(s.c, rec)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.act(game.Command{Kind: game.Craft, Recipe: &rec}); err != nil {
			t.Fatalf("craft %s: %v", ap.Name, err)
		}
		t.Logf("crafted %s at the %s for %d coin, by tick %d", ap.Name, ap.Station.Kind, ap.Fee, g.Tick())
	}
	if problems := ledger.Audit(g.Ledger.Balances, g.Holdings()); len(problems) > 0 {
		t.Fatal(problems)
	}
	if _, err := g.Digest(); err != nil {
		t.Fatal(err)
	}
}

// nearestSite is the closest explorable tile to h.
func nearestSite(g *game.Game, h hex.Hex) (hex.Hex, bool) {
	for r := int64(1); r <= 8; r++ {
		for _, x := range hex.Ring(h, r) {
			if g.CanExplore(x) {
				if _, _, ok := g.World.Path(h, x); ok {
					return x, true
				}
			}
		}
	}
	return hex.Hex{}, false
}
