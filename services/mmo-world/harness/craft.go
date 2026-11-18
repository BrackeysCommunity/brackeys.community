package harness

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
)

// The Craft run samples tens of thousands of kinds against their budgets
// and pits a search adversary against the sampled top decile (GDD 18.4).
const (
	craftSamples     = 30000
	craftStation     = 4
	craftStrength    = 1.3 // the search's best may reach this many times the sampled p90
	craftMinCell     = 20
	craftComposeOdds = 8 // one sample in this many is an exploit
	craftPatchOdds   = 6 // one shaped sample in this many is patched
)

// sampler draws random recipes the way a curious player might: zero to
// two refinements of raw materials or earlier intermediates, then a
// Fabricate into a slot, sometimes a Patch; and sometimes an exploit.
type sampler struct {
	b         *sheets.Book
	d         *item.Deriver
	pick      *draw.Drawer
	materials []string
	methodsOf map[string][]string
	slots     []string
	refined   []string
	maxIn     int64
	maxQty    int64
}

func newSampler(b *sheets.Book, d *item.Deriver, k keys.Set) *sampler {
	s := &sampler{b: b, d: d, pick: draw.NewDrawer(k.Roll), methodsOf: map[string][]string{},
		maxIn: sheets.IntParam(b.ItemParams, "recipe-max-inputs"), maxQty: sheets.IntParam(b.ItemParams, "input-max-quantity")}
	for _, m := range b.Materials {
		s.materials = append(s.materials, m.ID)
	}
	for _, m := range b.Methods {
		s.methodsOf[m.Process] = append(s.methodsOf[m.Process], m.ID)
	}
	for _, sl := range b.Slots {
		s.slots = append(s.slots, sl.ID)
	}
	return s
}

// one draws sample i: the final kind, or nil when a step was refused.
func (s *sampler) one(i int) *item.Kind {
	st := s.pick.Stream("craft.recipe", draw.Int(int64(i)))
	r := func(m int) int { return int(st.Below(uint64(m))) }
	pool := func() string {
		if len(s.refined) > 0 && r(3) > 0 {
			return s.refined[r(len(s.refined))]
		}
		return s.materials[r(len(s.materials))]
	}
	method := func(p string) string { return s.methodsOf[p][r(len(s.methodsOf[p]))] }
	if r(craftComposeOdds) == 0 {
		rec := item.Recipe{Process: item.Compose, Method: method(item.Compose)}
		for range 2 + r(3) {
			rec.Inputs = append(rec.Inputs, item.Input{Kind: s.materials[r(len(s.materials))], Qty: 1})
		}
		k, err := s.d.Derive(rec, craftStation)
		if err != nil {
			return nil
		}
		return k
	}
	base := pool()
	for range r(3) {
		proc := []string{item.Alloy, item.Alloy, item.Infuse, item.Bind}[r(4)]
		rec := item.Recipe{Process: proc, Method: method(proc), Inputs: []item.Input{{Kind: base, Qty: int64(1 + r(int(s.maxQty)))}}}
		extra := 1
		if proc != item.Infuse {
			extra = 1 + r(int(s.maxIn)-1)
		}
		for range extra {
			rec.Inputs = append(rec.Inputs, item.Input{Kind: pool(), Qty: int64(1 + r(int(s.maxQty)))})
		}
		rec.Inputs = dedupe(rec.Inputs, s.maxQty)
		k, err := s.d.Derive(rec, craftStation)
		if err != nil {
			continue
		}
		if !slices.Contains(s.refined, k.ID) {
			s.refined = append(s.refined, k.ID)
		}
		base = k.ID
	}
	shape := item.Recipe{Process: item.Shape, Method: method(item.Shape), Slot: s.slots[r(len(s.slots))], Inputs: []item.Input{{Kind: base, Qty: 1}}}
	k, err := s.d.Derive(shape, craftStation)
	if err != nil {
		return nil
	}
	if r(craftPatchOdds) == 0 {
		patch := item.Recipe{Process: item.Inscribe, Method: method(item.Inscribe), Inputs: []item.Input{{Kind: k.ID, Qty: 1}, {Kind: s.materials[r(len(s.materials))], Qty: 1}}}
		if pk, err := s.d.Derive(patch, craftStation); err == nil {
			return pk
		}
	}
	return k
}

// CraftRun is the Craft run.
func CraftRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	if n == 0 {
		n = craftSamples
	}
	k := keys.Throwaway("craft-run")
	d := item.NewDeriver(b, k.Quirk)
	s := newSampler(b, d, k)
	start := time.Now()
	var kinds []*item.Kind
	for i := range n {
		if kd := s.one(i); kd != nil {
			kinds = append(kinds, kd)
		}
	}
	elapsed := time.Since(start)

	var doc mdDoc
	p := doc.p
	p("# Craft run")
	p("")
	p("%s recipes sampled, %s kinds made, in %s. Station tier %d. Throwaway key `craft-run`.", comma(int64(n)), comma(int64(len(kinds))), elapsed.Round(time.Millisecond), craftStation)
	p("")

	over, failed, exploits, patched := 0, 0, 0, 0
	traits := map[string]int{}
	states := map[string]int{}
	for _, kd := range kinds {
		if kd.Vec.Total() > d.Budget(kd.Tier) {
			over++
		}
		if kd.Failed {
			failed++
		}
		if kd.Exploit != nil {
			exploits++
			st := kd.Exploit.State
			if st == "" {
				st = "none"
			}
			states[st]++
		}
		if kd.Recipe.Process == item.Inscribe {
			patched++
		}
		for _, t := range kd.Traits {
			traits[t]++
		}
	}
	var missing []string
	for _, t := range b.Traits {
		if traits[t.ID] == 0 {
			missing = append(missing, t.ID)
		}
	}
	p("| Measure | Value |")
	p("| --- | --- |")
	p("| Kinds over their tier budget | %d |", over)
	p("| Failures (nothing useful; salvage) | %s (%.1f%%) |", comma(int64(failed)), pct(failed, len(kinds)))
	p("| Exploits | %s; by state %s |", comma(int64(exploits)), mapList(states))
	p("| Patched gear | %s |", comma(int64(patched)))
	p("| Traits seen | %d of %d; missing: %s |", len(b.Traits)-len(missing), len(b.Traits), strings.Join(missing, ", "))
	p("")

	slots := s.slots
	best, searched := searchBest(b, k, s.methodsOf, slots, craftStation)
	p("## Strength")
	p("")
	p("Search best (sum of the two strongest axes) against the random top decile, per tier and slot. The search derived %s kinds.", comma(int64(searched)))
	p("")
	p("| Tier | Slot | Random kinds | p90 pts | Search best pts | Ratio | Holds |")
	p("| --- | --- | --- | --- | --- | --- | --- |")
	holding, cells := 0, 0
	worst := 0.0
	for _, t := range b.Tiers {
		for _, slot := range slots {
			var peaks []int64
			for _, kd := range kinds {
				if kd.Tier == t.Tier && kd.Slot == slot && !kd.Failed {
					peaks = append(peaks, kd.Vec.TopTwo())
				}
			}
			if len(peaks) < craftMinCell {
				continue
			}
			slices.Sort(peaks)
			p90 := q(peaks, 0.9)
			var bestPts int64
			if c := best[cellKey(t.Tier, slot)]; c != nil {
				bestPts = c.Vec.TopTwo()
			}
			ratio := float64(bestPts) / float64(max(p90, 1))
			ok := ratio <= craftStrength
			cells++
			if ok {
				holding++
			}
			worst = max(worst, ratio)
			p("| tier %d | %s | %s | %d | %d | %.2f | %s |", t.Tier, slot, comma(int64(len(peaks))), p90, bestPts, ratio, holds(ok))
		}
	}
	p("")
	p("Cells holding: %d of %d; worst ratio %.2f.", holding, cells, worst)
	if err := doc.Write(out, "craft.md"); err != nil {
		return nil, err
	}
	return []Measured{
		{Target: "kind-within-budget", Value: fmt.Sprintf("%d of %s over budget", over, comma(int64(len(kinds)))), Holds: over == 0},
		{Target: "top-kinds-near-median", Value: fmt.Sprintf("%d of %d cells; worst %.2f", holding, cells, worst), Holds: holding == cells},
	}, nil
}

// dedupe merges repeated inputs, their quantity capped at maxQty.
func dedupe(in []item.Input, maxQty int64) []item.Input {
	var out []item.Input
	for _, x := range in {
		i := slices.IndexFunc(out, func(y item.Input) bool { return y.Kind == x.Kind })
		if i >= 0 {
			out[i].Qty = min(out[i].Qty+x.Qty, maxQty)
			continue
		}
		out = append(out, x)
	}
	return out
}

type found struct {
	*item.Kind
	d *item.Deriver
}

// searchBest is the craft-strength adversary: it enumerates shallow
// recipes and keeps, per tier and slot, the kind with the strongest axis.
func searchBest(b *sheets.Book, k keys.Set, methodsOf map[string][]string, slots []string, stationTier int64) (map[string]*found, int) {
	d := item.NewDeriver(b, k.Quirk)
	maxQty := sheets.IntParam(b.ItemParams, "input-max-quantity")
	best := map[string]*found{}
	n := 0
	keep := func(base string) {
		for _, slot := range slots {
			for _, m := range methodsOf[item.Shape] {
				kd, err := d.Derive(item.Recipe{Process: item.Shape, Method: m, Slot: slot, Inputs: []item.Input{{Kind: base, Qty: 1}}}, stationTier)
				if err != nil {
					continue
				}
				n++
				key := cellKey(kd.Tier, slot)
				if cur := best[key]; cur == nil || kd.Vec.TopTwo() > cur.Vec.TopTwo() ||
					(kd.Vec.TopTwo() == cur.Vec.TopTwo() && kd.ID < cur.ID) {
					best[key] = &found{kd, d}
				}
			}
		}
	}
	var mats []string
	for _, m := range b.Materials {
		mats = append(mats, m.ID)
		keep(m.ID)
	}
	alloy := func(in []item.Input) {
		for _, m := range methodsOf[item.Alloy] {
			kd, err := d.Derive(item.Recipe{Process: item.Alloy, Method: m, Inputs: in}, stationTier)
			if err != nil {
				continue
			}
			n++
			keep(kd.ID)
		}
	}
	for i := range mats {
		for j := i + 1; j < len(mats); j++ {
			for qi := int64(1); qi <= maxQty; qi++ {
				for qj := int64(1); qj <= maxQty; qj++ {
					alloy([]item.Input{{Kind: mats[i], Qty: qi}, {Kind: mats[j], Qty: qj}})
				}
			}
			for l := j + 1; l < len(mats); l++ {
				for _, qs := range [][3]int64{{1, 1, 1}, {2, 1, 1}, {1, 2, 1}, {1, 1, 2}, {2, 2, 1}, {2, 1, 2}, {1, 2, 2}} {
					alloy([]item.Input{{Kind: mats[i], Qty: qs[0]}, {Kind: mats[j], Qty: qs[1]}, {Kind: mats[l], Qty: qs[2]}})
				}
			}
		}
	}
	return best, n
}
