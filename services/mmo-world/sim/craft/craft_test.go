package craft_test

import (
	"testing"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/sim/craft"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
)

func play(t *testing.T) *harness.Play {
	t.Helper()
	b, err := harness.LoadBook(harness.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	p, err := harness.NewPlay(b, keys.Throwaway("craft-test"))
	if err != nil {
		t.Fatal(err)
	}
	return p
}

var smelt = item.Recipe{Process: "alloy", Method: "slow-cool", Inputs: []item.Input{{Kind: "copper-ore", Qty: 2}, {Kind: "bog-iron", Qty: 1}}}
var forge = craft.Station{Kind: "forge", Tier: 2}

// Appraisal: ±12% at practice 0, narrowing 4% of that a point; the true
// value always inside; the same ranges when asked again.
func TestAppraise(t *testing.T) {
	p := play(t)
	if s := p.Crafter.Spread(0).String(); s != "0.12" {
		t.Fatalf("spread at 0: %s", s)
	}
	if s := p.Crafter.Spread(10).String(); s != "0.072" {
		t.Fatalf("spread at 10: %s", s)
	}
	r0, err := p.Crafter.Appraise(smelt, forge, 0, "ossa")
	if err != nil {
		t.Fatal(err)
	}
	r20, _ := p.Crafter.Appraise(smelt, forge, 20, "ossa")
	again, _ := p.Crafter.Appraise(smelt, forge, 0, "ossa")
	res, _, err := p.Crafter.Craft(craft.Order{Recipe: smelt, Station: forge, By: "ossa", Press: "i-1"})
	if err != nil {
		t.Fatal(err)
	}
	for a := range r0.Lo {
		if r0.Lo[a] != again.Lo[a] || r0.Hi[a] != again.Hi[a] {
			t.Fatal("appraisal changed when asked again")
		}
		if r20.Hi[a]-r20.Lo[a] > r0.Hi[a]-r0.Lo[a] {
			t.Fatal("practice widened a range")
		}
	}
	// The craft itself carries the quirk; the ranges were drawn without it,
	// so check against the quirkless vector: edge 13, weight 15, conduct 26.
	for a, v := range (item.Vec{13, 15, 0, 26, 0, 0, 0, 0}) {
		if v < r0.Lo[a] || v > r0.Hi[a] {
			t.Fatalf("axis %d: %d outside %d..%d", a, v, r0.Lo[a], r0.Hi[a])
		}
	}
	if !res.Discovered || res.Kind.FirstMaker != "ossa" {
		t.Fatalf("first maker not recorded: %+v", res)
	}
	known, _ := p.Crafter.Appraise(smelt, forge, 0, "someone")
	if !known.Known {
		t.Fatal("a known kind should appraise exactly")
	}
}

func TestStationAndFailure(t *testing.T) {
	p := play(t)
	if _, _, err := p.Crafter.Craft(craft.Order{Recipe: smelt, Station: craft.Station{Kind: "still", Tier: 2}, By: "x", Press: "p"}); err == nil {
		t.Fatal("smelted at a still")
	}
	// Two components with nothing to compose a state from: a failure,
	// recorded, with salvage.
	junk := item.Recipe{Process: "compose", Method: "ordered", Inputs: []item.Input{{Kind: "timber", Qty: 4}, {Kind: "fieldstone", Qty: 4}}}
	res, facts, err := p.Crafter.Craft(craft.Order{Recipe: junk, Station: craft.Station{Kind: "still", Tier: 2}, By: "x", Press: "p2"})
	if err != nil {
		t.Fatal(err)
	}
	if !res.Failed || len(res.Salvage) == 0 || res.Instance != nil {
		t.Fatalf("junk: %+v", res)
	}
	var recorded bool
	for _, f := range facts {
		recorded = recorded || f.Kind == "craft.failed"
	}
	if !recorded {
		t.Fatal("a failure was not recorded")
	}
}

func TestMaturitySavesUnits(t *testing.T) {
	p := play(t)
	blade := item.Recipe{Process: "shape", Method: "narrow-grind", Slot: "blade", Inputs: []item.Input{{Kind: item.KindID(smelt), Qty: 1}}}
	if _, _, err := p.Crafter.Craft(craft.Order{Recipe: smelt, Station: forge, By: "x", Press: "s"}); err != nil {
		t.Fatal(err)
	}
	var saved, made int64
	for i := range 1200 {
		res, _, err := p.Crafter.Craft(craft.Order{Recipe: smelt, Station: forge, By: "x", Press: "m-" + string(rune(i))})
		if err != nil {
			t.Fatal(err)
		}
		for _, s := range res.Saved {
			saved += s.Qty
		}
		made += 3
	}
	if saved == 0 || saved*4 > made {
		t.Fatalf("maturity saved %d of %d units; want some, never over a quarter", saved, made)
	}
	res, _, err := p.Crafter.Craft(craft.Order{Recipe: blade, Station: forge, By: "x", Press: "b"})
	if err != nil || res.Instance == nil || res.ToolXP != 20 {
		t.Fatalf("blade: %+v %v", res, err)
	}
	pat, _, err := p.Crafter.WritePattern(res.Kind.ID, "x", "pat", 0)
	if err != nil || pat.Pattern != res.Kind.ID {
		t.Fatal("pattern", err)
	}
}
