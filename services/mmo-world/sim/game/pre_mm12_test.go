package game_test

import (
	"fmt"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/world"
)

// testdata/pre-mm12 is a world saved before live operations, on world
// day 16, in season 1: a road walkers promoted; a fill and a resting bid
// and ask by players at the first settlement; a designer's pin, a server
// admin's (landed) and a server staff member's, all sent by the operator
// path; an operator's hunt part hunted and still open; and a burglar's hot
// lot.
const preMM12Dir = "testdata/pre-mm12/"

// A world saved before live operations attaches at its digest with no
// house, nothing staged and no ground pinned, and plays a world day with
// the ledger holding and still nothing staged.
func TestPreMM12WorldLoads(t *testing.T) {
	r := testkit.Rules(t, testkit.Book(t), keys.Throwaway("pre-mm12"))
	body, err := os.ReadFile(preMM12Dir + "snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	saved, err := os.ReadFile(preMM12Dir + "digest.txt")
	if err != nil {
		t.Fatal(err)
	}
	g := mm8aSnapshot(t, r, body)
	if d, _ := g.Digest(); d.String() != strings.TrimSpace(string(saved)) {
		t.Fatalf("the pre-MM12 save attaches at %s, saved as %s", d, strings.TrimSpace(string(saved)))
	}
	if err := preMM12Shows(g); err != nil {
		t.Fatal(err)
	}
	if err := unstaged(g); err != nil {
		t.Fatal(err)
	}
	if err := groundless(g); err != nil {
		t.Fatal(err)
	}

	day := g.World.Day
	advanceDays(t, g, 1)
	audit(t, g)
	if g.World.Day != day+1 {
		t.Fatalf("a world day played from day %d reached day %d", day, g.World.Day)
	}
	if i := slices.IndexFunc(g.Hunts, func(x *game.Hunt) bool { return x.Why == game.WhyOperator }); i < 0 || !g.Hunts[i].H.Over {
		t.Fatal("the operator's hunt did not close at its end")
	}
	if err := unstaged(g); err != nil {
		t.Fatalf("after a world day: %v", err)
	}
}

// preMM12Shows is nil when the save holds what it was made for.
func preMM12Shows(g *game.Game) error {
	if g.Story == nil || g.Story.Clock == nil || g.Story.Clock.N < 1 {
		return fmt.Errorf("the save keeps no season past season zero: %+v", g.Story)
	}
	if g.Emergence == nil || !slices.ContainsFunc(g.Emergence.Promotions, func(p emerge.Promotion) bool { return p.Type == emerge.Road }) {
		return fmt.Errorf("the save holds no promoted road")
	}
	filled, bid, ask := false, false, false
	for _, b := range g.BooksAt(0) {
		filled = filled || b.Last > 0
		for _, o := range append(slices.Clone(b.Bids), b.Asks...) {
			if o.Faction == nil && strings.HasPrefix(o.Owner, "char:") {
				bid, ask = bid || o.Side == "bid", ask || o.Side == "ask"
			}
		}
	}
	if !filled || !bid || !ask {
		return fmt.Errorf("the first settlement's market: a fill %v, a player's bid %v, a player's ask %v", filled, bid, ask)
	}
	roles := map[string]world.Pin{}
	for _, p := range g.World.Pins {
		roles[p.By.Role] = p
	}
	if _, ok := roles[world.PinDesigner]; !ok {
		return fmt.Errorf("no designer's pin in %+v", g.World.Pins)
	}
	if a, ok := roles[world.PinAdmin]; !ok || a.By.Server == "" || a.Landed == 0 {
		return fmt.Errorf("no landed admin's pin in %+v", g.World.Pins)
	}
	if s, ok := roles[world.PinStaff]; !ok || s.By.Server == "" || s.By.Points == 0 {
		return fmt.Errorf("no staff pin with points in %+v", g.World.Pins)
	}
	if !slices.ContainsFunc(g.Hunts, func(x *game.Hunt) bool { return x.Why == game.WhyOperator && !x.H.Over && len(x.H.Removed) > 0 }) {
		return fmt.Errorf("no open operator's hunt with hunters at it")
	}
	if !slices.ContainsFunc(g.Chars, func(c *game.Char) bool { return len(char.HotLotsOf(c.C)) > 0 }) {
		return fmt.Errorf("no character holds a hot lot")
	}
	return nil
}

// unstaged is nil when the game holds no house, no live operation, no
// staged book, no staged asset and no staged mark, read both from the
// state and from its encoding so the check holds whichever fields exist.
func unstaged(g *game.Game) error {
	if len(g.Houses) > 0 || g.Live != nil {
		return fmt.Errorf("the game holds %d houses and live ops %+v", len(g.Houses), g.Live)
	}
	if f := reflect.ValueOf(g.Market).Elem().FieldByName("Staged"); f.IsValid() && f.Len() > 0 {
		return fmt.Errorf("the market holds %d staged books", f.Len())
	}
	for _, b := range g.Ledger.Balances {
		if strings.HasPrefix(b.Asset, "stg:") || strings.HasSuffix(b.Account, ":staged") {
			return fmt.Errorf("the ledger books %d %s to %s", b.Units, b.Asset, b.Account)
		}
	}
	enc, err := jsonMap(g)
	if err != nil {
		return err
	}
	for _, k := range []string{"houses", "live"} {
		if _, ok := enc[k]; ok {
			return fmt.Errorf("the game encodes %s", k)
		}
	}
	for _, at := range []struct {
		in   string
		keys []string
	}{
		{"market", []string{"staged"}},
		{"chars", []string{"staged", "stagedDay"}},
		{"hunts", []string{"stage"}},
		{"goals", []string{"prize"}},
	} {
		for _, k := range at.keys {
			if p := keyPath(enc[at.in], k, at.in); p != "" {
				return fmt.Errorf("the game encodes %s", p)
			}
		}
	}
	// An arc's "stage" is its stage index, so a server's arc is told by
	// who cast it.
	if g.Story != nil {
		if i := slices.IndexFunc(g.Story.Arcs, func(a *game.Arc) bool { return a.By == "server" }); i >= 0 {
			return fmt.Errorf("arc %s was cast by a server", g.Story.Arcs[i].ID)
		}
	}
	if i := slices.IndexFunc(g.Hunts, func(x *game.Hunt) bool { return x.Why == "staged" }); i >= 0 {
		return fmt.Errorf("hunt %s opened staged", g.Hunts[i].H.ID)
	}
	return nil
}

// groundless is nil when no pin fixes ground and no tile holds any, and
// the world's baseline, where it has one of its own, is the scaffold's
// round every pin and the first settlement.
func groundless(g *game.Game) error {
	enc, err := jsonMap(g.World)
	if err != nil {
		return err
	}
	if p := keyPath(enc, "ground", "world"); p != "" {
		return fmt.Errorf("the world encodes %s", p)
	}
	base := reflect.ValueOf(g.World).MethodByName("Baseline")
	if !base.IsValid() || base.Type().NumIn() != 1 || base.Type().In(0) != reflect.TypeFor[hex.Hex]() || base.Type().NumOut() != 1 {
		return nil
	}
	gn := g.Rules().Gen
	centres := []hex.Hex{g.SettlementHex(0)}
	for _, p := range g.World.Pins {
		centres = append(centres, p.At)
	}
	for _, c := range centres {
		for _, h := range hex.DiscAt(c, 6) {
			got := base.Call([]reflect.Value{reflect.ValueOf(h)})[0].Interface()
			if want := gn.Baseline(h); !reflect.DeepEqual(got, want) {
				return fmt.Errorf("the world's baseline at %s is %+v, the scaffold's %+v", h.Ref(), got, want)
			}
		}
	}
	return nil
}

// keyPath is the path of the first object key named key anywhere in a
// decoded JSON value, or "".
func keyPath(v any, key, at string) string {
	switch x := v.(type) {
	case map[string]any:
		if _, ok := x[key]; ok {
			return at + "." + key
		}
		names := make([]string, 0, len(x))
		for k := range x {
			names = append(names, k)
		}
		slices.Sort(names)
		for _, k := range names {
			if p := keyPath(x[k], key, at+"."+k); p != "" {
				return p
			}
		}
	case []any:
		for i, e := range x {
			if p := keyPath(e, key, fmt.Sprintf("%s[%d]", at, i)); p != "" {
				return p
			}
		}
	}
	return ""
}
