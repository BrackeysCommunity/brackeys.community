package item_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/tags"
)

func play(t *testing.T) *harness.Play {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	p, err := harness.NewPlay(b, keys.Throwaway("item-test"))
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// GDD 9.12's table: xp to next and total so far.
func TestLevelCurve(t *testing.T) {
	p := play(t)
	so := map[int64]int64{}
	var total int64
	for l := int64(1); l <= 20; l++ {
		so[l] = total
		total += p.Growth.ToNext(l)
	}
	for l, want := range map[int64][2]int64{1: {5, 0}, 4: {74, 64}, 5: {115, 138}, 9: {373, 938}, 10: {460, 1311}, 15: {1035, 4669}} {
		if p.Growth.ToNext(l) != want[0] || so[l] != want[1] {
			t.Errorf("level %d: %d to next, %d so far; want %v", l, p.Growth.ToNext(l), so[l], want)
		}
	}
	if so[20] != 11362 {
		t.Errorf("level 20 at %d xp, want 11,362", so[20])
	}
}

func copperline(t *testing.T, p *harness.Play) *item.Kind {
	t.Helper()
	smelt, err := p.Deriver.Derive(item.Recipe{Process: "alloy", Method: "slow-cool", Inputs: []item.Input{{Kind: "copper-ore", Qty: 2}, {Kind: "bog-iron", Qty: 1}}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	k, err := p.Deriver.Derive(item.Recipe{Process: "shape", Method: "narrow-grind", Slot: "blade", Inputs: []item.Input{{Kind: smelt.ID, Qty: 1}}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

// Milestones fix two offers from the ancestry's tables, chosen by the
// record; the same instance always gets the same offers.
func TestMilestoneOffers(t *testing.T) {
	p := play(t)
	k := copperline(t, p)
	in := item.NewInstance("blade-1", k, "ossa")
	for range 40 {
		in.Record.Add("won", "strike", "clash")
	}
	lv := p.Growth.AddXP(in, k, 138)
	if lv.To != 5 || !slices.Equal(lv.Milestones, []int64{5}) || len(in.Offers) != 2 {
		t.Fatalf("levelled %+v offers %v", lv, in.Offers)
	}
	if !slices.Contains(in.Offers, "keen") {
		t.Fatalf("a blade that strikes is offered %v, not keen", in.Offers)
	}
	twin := item.NewInstance("blade-1", k, "ossa")
	twin.Record = in.Record
	p.Growth.AddXP(twin, k, 138)
	if !slices.Equal(in.Offers, twin.Offers) {
		t.Fatal("offers are not fixed")
	}
	if err := p.Growth.Pick(in, k, "not-offered"); err == nil {
		t.Fatal("picked something not on offer")
	}
	if err := p.Growth.Pick(in, k, in.Offers[0]); err != nil || len(in.Offers) != 0 {
		t.Fatal(err)
	}
	if mat, n := p.Growth.PickCost(k); n != 3 || mat == "" {
		t.Fatalf("pick cost %d of %q", n, mat)
	}
	// Level stops at the tier's cap; milestones passed together are
	// offered one after another.
	before := len(in.Picks)
	p.Growth.AddXP(in, k, 1_000_000)
	if in.Level != 20 {
		t.Fatalf("tier-2 level %d, want the cap 20", in.Level)
	}
	picked := 0
	for len(in.Offers) > 0 {
		if err := p.Growth.Pick(in, k, in.Offers[0]); err != nil {
			t.Fatal(err)
		}
		picked++
	}
	if picked < 2 || len(in.Picks) != before+picked {
		t.Fatalf("picked %d of the milestones passed at once", picked)
	}
}

func TestWearBreakAndDormancy(t *testing.T) {
	p := play(t)
	k := copperline(t, p)
	if k.Durability != 90 {
		t.Fatalf("tier-2 blade durability %d, want 90", k.Durability)
	}
	fresh := item.NewInstance("a", k, "")
	if fresh.Use(89) != item.Worn || fresh.Use(5) != item.Broke {
		t.Fatal("an item with no pick should break at 0")
	}
	salvage := p.Deriver.Salvage(k.Recipe.Inputs, 40)
	var n int64
	for _, s := range salvage {
		n += s.Qty
	}
	if n != 1 {
		t.Fatalf("40%% of 3 units of copper and iron: %v", salvage)
	}
	picked := item.NewInstance("b", k, "")
	picked.Picks = []string{"keen"}
	if picked.Use(90) != item.WentDormant || picked.Usable() {
		t.Fatal("an item with a pick should go dormant")
	}
	if got := item.RepairCost(picked, p.Book.WearParams); got != 4 {
		t.Fatalf("repair from 0: %d units, want 4 (25%% a unit)", got)
	}
	picked.Repair()
	if !picked.Usable() || picked.Durability != 90 {
		t.Fatal("repair did not wake it")
	}
}

// GDD 9.17's six reference exploits compose to the states they add.
func TestReferenceExploits(t *testing.T) {
	p := play(t)
	smelt, _ := p.Deriver.Derive(item.Recipe{Process: "alloy", Method: "slow-cool", Inputs: []item.Input{{Kind: "copper-ore", Qty: 2}, {Kind: "bog-iron", Qty: 1}}}, 2)
	for _, c := range []struct {
		name   string
		inputs []string
		state  string
		target string
		trait  string
	}{
		{"overheat", []string{"ember-salt", "reed-ash"}, "burning", "creature", ""},
		{"thermite loop", []string{"ember-salt", "reed-ash", "marsh-amber"}, "burning", "creature", "lingering"},
		{"coolant dump", []string{"river-clay", "reedflax"}, "wet", "tile", ""},
		{"cryo spike", []string{"saltglass", "river-clay"}, "brittle", "tile", ""},
		{"ghost signal", []string{"reed-ash", "feathers"}, "hidden", "caster", ""},
		{"surge call", []string{smelt.ID, "marsh-amber", "saltglass"}, "charged", "tagged", ""},
	} {
		r := item.Recipe{Process: "compose", Method: "ordered"}
		for _, in := range c.inputs {
			r.Inputs = append(r.Inputs, item.Input{Kind: in, Qty: 1})
		}
		k, err := p.Deriver.Derive(r, 4)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if k.Exploit == nil || k.Exploit.State != c.state || k.Exploit.Target != c.target || k.Failed {
			t.Fatalf("%s: %+v", c.name, k.Exploit)
		}
		if c.trait != "" && !slices.Contains(k.Traits, c.trait) {
			t.Fatalf("%s lacks %s: %v", c.name, c.trait, k.Traits)
		}
		if !slices.Contains(k.Tags, tags.Tag("exploit")) {
			t.Fatalf("%s tags %v", c.name, k.Tags)
		}
	}
	a := item.Recipe{Process: "compose", Method: "ordered", Inputs: []item.Input{{Kind: "ember-salt", Qty: 1}, {Kind: "reed-ash", Qty: 1}}}
	b := item.Recipe{Process: "compose", Method: "ordered", Inputs: []item.Input{{Kind: "reed-ash", Qty: 1}, {Kind: "ember-salt", Qty: 1}}}
	if item.KindID(a) == item.KindID(b) {
		t.Fatal("order is part of a composed recipe")
	}
}

func TestInscribeCostsDurability(t *testing.T) {
	p := play(t)
	k := copperline(t, p)
	for method, cost := range map[string]int64{"shallow": 5, "deep-cut": 15} {
		ins, err := p.Deriver.Derive(item.Recipe{Process: "inscribe", Method: method, Inputs: []item.Input{{Kind: k.ID, Qty: 1}, {Kind: "reed-ash", Qty: 1}}}, 4)
		if err != nil {
			t.Fatal(err)
		}
		if ins.Durability != k.Durability-cost || ins.Slot != "blade" || len(ins.Traits) == 0 {
			t.Fatalf("%s: durability %d traits %v", method, ins.Durability, ins.Traits)
		}
		strong := p.Deriver.Trait(ins.Traits[len(ins.Traits)-1]).Strong
		if strong != (method == "deep-cut") {
			t.Fatalf("%s drew %v", method, ins.Traits)
		}
	}
}

func TestMounts(t *testing.T) {
	p := play(t)
	goat := p.Mounts.NewMount("goat-1", "rad-goat")
	if got := p.Mounts.EnterTicks(goat, 3, item.Ground{Terrain: "hills"}, true); got != 2 {
		t.Fatalf("a rad goat in hills: %d ticks, want 2", got)
	}
	if got := p.Mounts.EnterTicks(goat, 3, item.Ground{Terrain: "marsh"}, true); got != 3 {
		t.Fatalf("off its terrain: %d", got)
	}
	if got := p.Mounts.EnterTicks(goat, 1, item.Ground{Terrain: "hills"}, true); got != 1 {
		t.Fatal("never under 1 tick")
	}
	if got := p.Mounts.EnterTicks(goat, 3, item.Ground{Terrain: "hills"}, false); got != 3 {
		t.Fatal("an unfed mount does not carry")
	}
	rig := p.Mounts.NewMount("rig-1", "stilt-rig")
	if got := p.Mounts.EnterTicks(rig, 3, item.Ground{Terrain: "hills", River: true}, true); got != 2 {
		t.Fatalf("a stilt rig crossing a river: %d ticks, want 2", got)
	}
	trike := p.Mounts.NewMount("trike-1", "road-trike")
	if p.Mounts.EnterTicks(trike, 1, item.Ground{Terrain: "plain", Road: true}, true) != 1 || p.Mounts.Load(trike) != 40 {
		t.Fatal("a trike buys load on a road, not speed")
	}
	if got := p.Mounts.Upkeep(2, 13); got != 4 {
		t.Fatalf("upkeep %d, want 2 + 13/6", got)
	}
	for range 30 {
		p.Mounts.Ridden(goat, item.Ground{Terrain: "hills"}, false)
	}
	if goat.Level < 5 || len(goat.Offers) != 2 {
		t.Fatalf("goat level %d offers %v", goat.Level, goat.Offers)
	}
	if !slices.Contains(goat.Offers, "sure-footed") {
		t.Fatalf("a goat ridden on its terrain is offered %v", goat.Offers)
	}
}

// Every tile ridden counts once under ridden:any and once per tag, so a
// mount kept on the road is offered swift first.
func TestRiddenRecord(t *testing.T) {
	p := play(t)
	rig := p.Mounts.NewMount("rig-1", "stilt-rig")
	if got := p.Mounts.EnterTicks(rig, 3, item.Ground{Terrain: "hills", River: true}, true); got != 2 {
		t.Fatalf("a stilt rig crossing a river: %d ticks, want 2", got)
	}
	trike := p.Mounts.NewMount("trike-1", "road-trike")
	const n = 30
	for range n {
		p.Mounts.Ridden(trike, item.Ground{Terrain: "plain", Road: true}, true)
	}
	for _, k := range []string{"ridden:any", "ridden:road", "ridden:laden", "ridden:suited"} {
		if got := trike.Record.Get(k); got != n {
			t.Errorf("%s = %d, want %d", k, got, n)
		}
	}
	if len(trike.Offers) == 0 || trike.Offers[0] != "swift" {
		t.Fatalf("a road-ridden mount is offered %v, swift not first", trike.Offers)
	}
}

func TestMaturity(t *testing.T) {
	p := play(t)
	for crafts, want := range map[int64]string{0: "0", 250: "0.1875", 500: "0.25", 5000: "0.25"} {
		if got := p.Growth.Maturity(crafts).String(); got != want {
			t.Errorf("maturity at %d crafts: %s, want %s", crafts, got, want)
		}
	}
}
